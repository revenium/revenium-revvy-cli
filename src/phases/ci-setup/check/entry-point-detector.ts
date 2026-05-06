import { readdir, readFile, stat, lstat } from "fs/promises";
import { join, relative, sep } from "path";
import { buildIgnoreMatcher } from "../../scan/detectors/call-site-detector.js";
import { detectImportedProviderPackages } from "../../scan/detectors/call-site-detector.js";
import type { CallSite } from "../../../types/scan-result.js";
import type { SupportedLanguage } from "../../../constants/languages.js";

/** Manifest filenames that signal a separate entry-point root, in priority order. */
const MANIFEST_FILES = [
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "package.json",
] as const;

type ManifestFile = (typeof MANIFEST_FILES)[number];

/** Directories to skip when walking for manifests or middleware imports. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  "vendor",
  ".cache",
  "coverage",
  ".next",
  ".nuxt",
]);

/** Source file extensions worth scanning for middleware imports. */
const SOURCE_EXTENSIONS = new Set([
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
]);

/**
 * Regex patterns that indicate a Revenium middleware import exists in a file.
 *
 * Python:
 *   - `import revenium_middleware...`
 *   - `from revenium_middleware...`
 *
 * Node/TS — covers static, lazy/dynamic, and CommonJS forms because real
 * codebases use all three (e.g. tsx ESM/CJS-cycle workarounds use lazy
 * `import("@revenium/middleware/...")`):
 *   - `import "@revenium/middleware..."` / `from "@revenium/middleware..."`
 *   - `import("@revenium/middleware...")` / `await import("@revenium/middleware...")`
 *   - `require("@revenium/middleware...")`
 */
const MIDDLEWARE_PATTERNS = [
  /import\s+revenium_middleware/,
  /from\s+revenium_middleware/,
  /import\s+["']@revenium\/middleware/,
  /from\s+["']@revenium\/middleware/,
  /import\s*\(\s*["']@revenium\/middleware/,    // dynamic / lazy import
  /require\s*\(\s*["']@revenium\/middleware/,   // CommonJS bare require
];

export interface EntryPointWarning {
  /** Relative path of the subdirectory from targetDir (e.g. "Claude-Eng-v2") */
  subdir: string;
  /** The manifest filename found (e.g. "requirements.txt") */
  manifestFile: string;
}

export interface DetectMultiEntryPointOptions {
  /** Patterns to exclude (--exclude flag, .gitignore, .revvyignore are also applied). */
  excludePatterns?: string[];
  /**
   * Call sites already detected for the project (relative paths from targetDir).
   * Used for Fix 7: only warn if the subdir has AI activity.
   */
  callSites?: CallSite[];
  /**
   * Language of the project. Required for the provider-import check (Fix 7 option b).
   * If omitted, the provider-import fallback is skipped.
   */
  language?: SupportedLanguage;
}

/**
 * Returns true if the given absolute file path contains a Revenium middleware import.
 */
async function fileHasMiddlewareImport(filePath: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return false;
  }
  return MIDDLEWARE_PATTERNS.some((re) => re.test(content));
}

/**
 * Recursively walks `dir`, returning true as soon as any source file contains
 * a Revenium middleware import. Skips IGNORE_DIRS and symlinks to avoid cycles.
 */
async function subtreeHasMiddlewareImport(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) continue; // skip symlinks to avoid cycles

    if (entry.isDirectory()) {
      if (await subtreeHasMiddlewareImport(fullPath)) return true;
    } else if (entry.isFile()) {
      const ext = entry.name.lastIndexOf(".") >= 0
        ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
        : "";
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      if (await fileHasMiddlewareImport(fullPath)) return true;
    }
  }

  return false;
}

/**
 * Walk `targetDir` one level at a time, finding immediate and nested
 * subdirectories (excluding the root) that contain a package manifest file.
 *
 * We walk all depths but skip IGNORE_DIRS. For each subdirectory that has a
 * manifest, we record the first (highest-priority) manifest found.
 */
async function findManifestSubdirs(
  targetDir: string,
): Promise<Array<{ absPath: string; relPath: string; manifestFile: ManifestFile }>> {
  const results: Array<{ absPath: string; relPath: string; manifestFile: ManifestFile }> = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;

      const fullPath = join(dir, entry.name);

      // Skip symlinked directories to avoid cycles
      try {
        const linkStat = await lstat(fullPath);
        if (linkStat.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      const relPath = relative(targetDir, fullPath);

      // Check if this subdir has any manifest file (in priority order)
      let foundManifest: ManifestFile | null = null;
      for (const manifest of MANIFEST_FILES) {
        try {
          await stat(join(fullPath, manifest));
          foundManifest = manifest;
          break; // take the highest-priority one
        } catch {
          // not found, try next
        }
      }

      if (foundManifest !== null) {
        results.push({ absPath: fullPath, relPath, manifestFile: foundManifest });
      }

      // Continue walking into this subdir regardless of manifest presence
      await walk(fullPath);
    }
  }

  await walk(targetDir);
  return results;
}

/**
 * Returns true if any of the provided call sites reside within the given subdir.
 *
 * `callSites` carry relative paths from targetDir; `subdirRelPath` is the
 * relative path of the subdir (also from targetDir, forward-slash normalized).
 */
function subdirHasCallSites(callSites: CallSite[], subdirRelPath: string): boolean {
  // Normalize to forward slashes for consistent prefix matching across platforms.
  const prefix = subdirRelPath.split(sep).join("/") + "/";
  return callSites.some((cs) => {
    const normalized = cs.filePath.split(sep).join("/");
    return normalized.startsWith(prefix) || normalized === subdirRelPath.split(sep).join("/");
  });
}

/**
 * Detect subdirectories that look like separate entry points (contain a package
 * manifest) but have no Revenium middleware import anywhere in their subtree.
 *
 * These are heuristic warnings — they do not affect pass/fail status.
 *
 * Fix 6: Applies exclude patterns, .gitignore, and .revvyignore when deciding
 * which manifest subdirs to consider, so users can silence spurious warnings.
 *
 * Fix 7: Only emits a warning for a subdir if the subdir's subtree contains
 * at least one detected AI call site OR at least one provider package import.
 * Subdirs with no AI activity (build tools, docs, etc.) are silently skipped.
 */
export async function detectMultiEntryPointWarnings(
  targetDir: string,
  options?: DetectMultiEntryPointOptions,
): Promise<EntryPointWarning[]> {
  const { excludePatterns, callSites, language } = options ?? {};

  // Fix 6: build ignore matcher from .gitignore + .revvyignore + --exclude
  const ig = await buildIgnoreMatcher(targetDir, excludePatterns);

  const candidates = await findManifestSubdirs(targetDir);

  const warnings: EntryPointWarning[] = [];

  await Promise.allSettled(
    candidates.map(async ({ absPath, relPath, manifestFile }) => {
      // Fix 6: filter out ignored subdirs before emitting any warning
      if (ig) {
        // The `ignore` package expects forward-slash relative paths from targetDir.
        const forwardSlashRel = relPath.split(sep).join("/");
        // Three checks cover all common gitignore patterns:
        //   "Claude-Eng-v2"    → ig.ignores("Claude-Eng-v2") === true
        //   "Claude-Eng-v2/"   → ig.ignores("Claude-Eng-v2/_sentinel") === true
        //   "Claude-Eng-v2/**" → ig.ignores("Claude-Eng-v2/_sentinel") === true
        //
        // Using a sentinel child path catches glob patterns like `dir/**` that
        // match children but not the directory path itself, which is the most
        // common form users write in .revvyignore.
        if (
          ig.ignores(forwardSlashRel) ||
          ig.ignores(forwardSlashRel + "/_revvy_sentinel")
        ) {
          return; // suppressed by ignore patterns
        }
      }

      // Fix 7: skip subdirs with no AI activity
      const hasAiCallSites = callSites !== undefined && subdirHasCallSites(callSites, relPath);

      let hasProviderImports = false;
      if (!hasAiCallSites && language !== undefined) {
        // Run a targeted provider-import scan on the subdir's own tree.
        const imported = await detectImportedProviderPackages(absPath, language);
        hasProviderImports = imported.size > 0;
      }

      if (!hasAiCallSites && !hasProviderImports) {
        return; // no AI activity in this subtree — skip silently
      }

      // Check whether the subdir's subtree has the Revenium middleware import.
      const hasCoverage = await subtreeHasMiddlewareImport(absPath);
      if (!hasCoverage) {
        warnings.push({ subdir: relPath, manifestFile });
      }
    }),
  );

  // Sort for deterministic output
  warnings.sort((a, b) => a.subdir.localeCompare(b.subdir));

  return warnings;
}
