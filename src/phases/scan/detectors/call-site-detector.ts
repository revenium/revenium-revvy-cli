import { readFile, readdir, stat } from "fs/promises";
import { join, extname, relative, sep } from "path";
import ignoreLib, { type Ignore } from "ignore";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ignore = (ignoreLib as any).default ?? ignoreLib;
import type { CallSite } from "../../../types/scan-result.js";
import type { SupportedLanguage } from "../../../constants/languages.js";
import {
  getPatternsForLanguage,
  type ProviderPattern,
  type CallPattern,
} from "../patterns/index.js";
import { detectNodeCallSites } from "./ast/node-ast.js";
import {
  extractPythonImports,
  extractGoImports,
  hasAnyImport,
} from "./ast/import-extractor.js";

const SOURCE_EXTENSIONS: Record<SupportedLanguage, string[]> = {
  node: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"],
  python: [".py"],
  go: [".go"],
};

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  "vendor",
  ".cache",
  "coverage",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

interface CallSiteDetectorResult {
  callSites: CallSite[];
  totalFiles: number;
  filesWithAICalls: number;
  /** Absolute paths of every source file that was scanned — useful for follow-up discoveries. */
  scannedFiles: string[];
  /**
   * Relative paths of files the AST parser couldn't parse. Surfaced so
   * `revvy check` can diagnose the "instrumentation broke the file" case
   * — a prior pass introduced syntactically invalid code, the scanner
   * silently returned 0 call sites, and the check would otherwise pass.
   */
  parseFailures: string[];
}

/**
 * Builds an `ignore` instance from .gitignore, .revvyignore, and --exclude patterns.
 * Returns null if no patterns are provided (fast path: no filtering needed).
 *
 * Exported so that other detectors (e.g. entry-point-detector) can reuse the
 * same ignore-pattern logic without duplication.
 */
export async function buildIgnoreMatcher(
  targetDir: string,
  excludePatterns?: string[],
): Promise<Ignore | null> {
  const gitignorePath = join(targetDir, ".gitignore");
  const revvyignorePath = join(targetDir, ".revvyignore");

  let gitignoreContent: string | null = null;
  let revvyignoreContent: string | null = null;

  try {
    gitignoreContent = await readFile(gitignorePath, "utf-8");
  } catch {
    // file doesn't exist — that's fine
  }

  try {
    revvyignoreContent = await readFile(revvyignorePath, "utf-8");
  } catch {
    // file doesn't exist — that's fine
  }

  const hasPatterns =
    gitignoreContent !== null ||
    revvyignoreContent !== null ||
    (excludePatterns && excludePatterns.length > 0);

  if (!hasPatterns) return null;

  const ig = ignore();
  if (gitignoreContent) ig.add(gitignoreContent);
  if (revvyignoreContent) ig.add(revvyignoreContent);
  if (excludePatterns?.length) ig.add(excludePatterns);

  return ig;
}

async function getSourceFiles(
  dir: string,
  extensions: string[],
  targetDir?: string,
  ig?: Ignore | null,
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      // Apply ignore filter using relative path from targetDir (forward slashes).
      if (ig && targetDir) {
        const rel = relative(targetDir, fullPath).split(sep).join("/");
        if (ig.ignores(rel)) continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await getSourceFiles(fullPath, extensions, targetDir, ig);
        files.push(...subFiles);
      } else if (extensions.includes(extname(entry.name).toLowerCase())) {
        try {
          const fileStat = await stat(fullPath);
          if (fileStat.size <= MAX_FILE_SIZE) {
            files.push(fullPath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Builds a permissive regex for a method chain. Matches both
 *   `litellm.completion(...)`               (module-style)
 *   `client.messages.create(...)`           (receiver-style)
 *   `client.Chat().Completions().New(...)`  (Go-style chained calls)
 *
 * Uses a single negative lookbehind `(?<!\w)` so we anchor at a word boundary
 * (allows leading `.`, space, `(`, newline; disallows `aclient` matching inside
 * `myaclient`). Substring-overlap removal between competing patterns happens
 * post-hoc in `removeOverlappingMatches`.
 */
function buildMethodRegex(methodChain: string): RegExp {
  const tail = methodChain
    .split(".")
    .map((seg) => seg.replace(/\(\)/g, "\\(\\)"))
    .join("\\.");
  return new RegExp(`(?<!\\w)${tail}\\s*\\(`, "g");
}

interface RegexCallSiteParams {
  filePath: string;
  content: string;
  patterns: ProviderPattern[];
  importsOfFile: Set<string>;
}

interface RawMatch {
  startIndex: number;
  endIndex: number;
  lineNumber: number;
  methodChain: string;
  provider: ProviderPattern;
  callPattern: CallPattern;
}

function regexFindCallSites({
  filePath,
  content,
  patterns,
  importsOfFile,
}: RegexCallSiteParams): CallSite[] {
  const lines = content.split("\n");
  const raw: RawMatch[] = [];

  for (const provider of patterns) {
    // skip provider entirely if its package isn't imported in this file.
    if (!hasAnyImport(provider.packageNames, importsOfFile)) continue;

    for (const cp of provider.callPatterns) {
      const regex = buildMethodRegex(cp.methodChain);
      let match;
      while ((match = regex.exec(content)) !== null) {
        // skip matches inside comments (Python # / Go //)
        const lineStart = content.lastIndexOf("\n", match.index) + 1;
        const linePrefix = content.slice(lineStart, match.index).trimStart();
        if (linePrefix.startsWith("#") || linePrefix.startsWith("//")) continue;

        const lineNumber =
          content.substring(0, match.index).split("\n").length;
        raw.push({
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          lineNumber,
          methodChain: cp.methodChain,
          provider,
          callPattern: cp,
        });
      }
    }
  }

  // Suppress shorter overlapping matches:
  // when `litellm.completion(` matches at idx N (length 19), a separate
  // `completion(` match at idx N+8 (length 11) is contained within the first
  // and represents the same call — drop the inner one. Sort longest-first so
  // the outer match wins.
  const winners: RawMatch[] = [];
  const sorted = [...raw].sort(
    (a, b) =>
      b.endIndex - b.startIndex - (a.endIndex - a.startIndex),
  );

  for (const m of sorted) {
    const isShadowed = winners.some(
      (w) =>
        w.lineNumber === m.lineNumber &&
        m.startIndex >= w.startIndex &&
        m.endIndex <= w.endIndex &&
        // Keep distinct calls on the same line that don't overlap textually.
        m.methodChain !== w.methodChain,
    );
    if (!isShadowed) winners.push(m);
  }

  // Final dedup by (line, methodChain, provider) and produce CallSite records.
  const seen = new Set<string>();
  const sites: CallSite[] = [];
  for (const m of winners) {
    const key = `${filePath}:${m.lineNumber}:${m.provider.provider}:${m.methodChain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push({
      filePath,
      lineNumber: m.lineNumber,
      provider: m.provider.provider,
      method: m.callPattern.method ?? m.callPattern.methodChain,
      operationType: m.callPattern.operationType,
      snippet: (lines[m.lineNumber - 1] || "").trim(),
    });
  }

  return sites;
}

export async function detectCallSites(
  targetDir: string,
  language: SupportedLanguage,
  excludePatterns?: string[],
): Promise<CallSiteDetectorResult> {
  const extensions = SOURCE_EXTENSIONS[language] || [];
  const ig = await buildIgnoreMatcher(targetDir, excludePatterns);
  const sourceFiles = await getSourceFiles(targetDir, extensions, targetDir, ig);

  const allCallSites: CallSite[] = [];
  const filesWithCalls = new Set<string>();
  const parseFailures: string[] = [];
  const patterns = getPatternsForLanguage(language);

  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const relativePath = relative(targetDir, filePath);

      let sites: CallSite[];

      if (language === "node") {
        // AST-based for accuracy + provider attribution via imports.
        const result = detectNodeCallSites(relativePath, content);
        sites = result.callSites;
        if (result.parseFailed) {
          parseFailures.push(relativePath);
        }
      } else {
        // Import-aware regex for Python and Go.
        const importsOfFile =
          language === "python"
            ? extractPythonImports(content)
            : extractGoImports(content);
        sites = regexFindCallSites({
          filePath: relativePath,
          content,
          patterns,
          importsOfFile,
        });
      }

      if (sites.length > 0) {
        allCallSites.push(...sites);
        filesWithCalls.add(relativePath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return {
    callSites: allCallSites,
    totalFiles: sourceFiles.length,
    filesWithAICalls: filesWithCalls.size,
    scannedFiles: sourceFiles,
    parseFailures,
  };
}

// Re-export for testing / inspection
export { buildMethodRegex };
export type { CallPattern };

/**
 * Returns the set of AI provider package names that are actually imported
 * somewhere in the project's source files.
 *
 * For Node, we use a lightweight regex check on import/require statements
 * rather than the full Babel AST, since we only need presence — not binding
 * attribution. For Python and Go we reuse the existing import extractors.
 *
 * The returned set contains raw package name strings (e.g. "ai", "openai",
 * "@anthropic-ai/sdk") as they appear in the patterns' packageNames arrays.
 */
export async function detectImportedProviderPackages(
  targetDir: string,
  language: SupportedLanguage,
  excludePatterns?: string[],
): Promise<Set<string>> {
  const extensions = SOURCE_EXTENSIONS[language] || [];
  const ig = await buildIgnoreMatcher(targetDir, excludePatterns);
  const sourceFiles = await getSourceFiles(targetDir, extensions, targetDir, ig);
  const patterns = getPatternsForLanguage(language);

  // Build a flat list of all packageNames we want to detect, deduped.
  const allPackageNames = new Set<string>();
  for (const pattern of patterns) {
    for (const pkg of pattern.packageNames) {
      allPackageNames.add(pkg);
    }
  }

  if (allPackageNames.size === 0) return new Set();

  const imported = new Set<string>();

  for (const filePath of sourceFiles) {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    if (language === "node") {
      // Lightweight regex: match ES import and require() statements.
      // We look for the package name as a quoted string literal.
      for (const pkg of allPackageNames) {
        if (imported.has(pkg)) continue; // already found, skip remaining files check
        // Escape special regex chars in package name (e.g. "@", "/", "-")
        const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match: import ... from 'pkg' / import ... from "pkg"
        //        require('pkg') / require("pkg")
        // Also match sub-path imports like 'pkg/foo' which still count as the root package
        const re = new RegExp(`(?:from|require\\s*\\()\\s*["']${escaped}(?:[/"']|["'])`, "m");
        if (re.test(content)) {
          imported.add(pkg);
        }
      }
    } else if (language === "python") {
      const fileImports = extractPythonImports(content);
      for (const pkg of allPackageNames) {
        if (imported.has(pkg)) continue;
        if (hasAnyImport([pkg], fileImports)) {
          imported.add(pkg);
        }
      }
    } else if (language === "go") {
      const fileImports = extractGoImports(content);
      for (const pkg of allPackageNames) {
        if (imported.has(pkg)) continue;
        if (hasAnyImport([pkg], fileImports)) {
          imported.add(pkg);
        }
      }
    }

    // Early exit: if all packages found, no need to scan more files
    if (imported.size === allPackageNames.size) break;
  }

  return imported;
}
