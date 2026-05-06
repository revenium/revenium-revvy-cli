import { readFile, readdir, stat } from "fs/promises";
import { join, extname, relative } from "path";
import type { ExistingInstrumentation, CallSite } from "../../../types/scan-result.js";
import type { SupportedLanguage } from "../../../constants/languages.js";
import { REVENIUM_SDK_PACKAGES } from "../../../constants/detection.js";
import { getPatternsForLanguage } from "../patterns/index.js";
import { detectNodeCallSites } from "./ast/node-ast.js";

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
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

async function getSourceFiles(
  dir: string,
  extensions: string[],
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await getSourceFiles(fullPath, extensions)));
      } else if (extensions.includes(extname(entry.name).toLowerCase())) {
        try {
          const fileStat = await stat(fullPath);
          if (fileStat.size <= MAX_FILE_SIZE) {
            files.push(fullPath);
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // Skip inaccessible dirs
  }

  return files;
}

async function detectInDependencyFiles(
  targetDir: string,
  language: SupportedLanguage,
): Promise<string[]> {
  const foundPackages: string[] = [];
  const sdkPackages = REVENIUM_SDK_PACKAGES[language];

  if (language === "node") {
    try {
      const content = await readFile(
        join(targetDir, "package.json"),
        "utf-8",
      );
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      for (const sdkPkg of sdkPackages) {
        if (allDeps[sdkPkg]) {
          foundPackages.push(sdkPkg);
        }
      }
    } catch {
      // No package.json
    }
  }

  if (language === "python") {
    for (const file of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
      try {
        const content = await readFile(join(targetDir, file), "utf-8");
        for (const sdkPkg of sdkPackages) {
          // Match with extras: "revenium-python-sdk[openai]" still contains "revenium-python-sdk"
          if (content.includes(sdkPkg)) {
            if (!foundPackages.includes(sdkPkg)) foundPackages.push(sdkPkg);
          }
        }
      } catch {
        // File not found
      }
    }
  }

  if (language === "go") {
    try {
      const content = await readFile(join(targetDir, "go.mod"), "utf-8");
      for (const sdkPkg of sdkPackages) {
        if (content.includes(sdkPkg)) {
          foundPackages.push(sdkPkg);
        }
      }
    } catch {
      // No go.mod
    }
  }

  return foundPackages;
}

/**
 * Find Revenium-middleware imports in source files. For node we use the AST
 * walker (already records reveniumImports as a side-effect of call-site
 * detection); for python/go we do a simple regex over the file contents.
 */
async function findInstrumentationCallSitesInFile(
  filePath: string,
  relativePath: string,
  language: SupportedLanguage,
): Promise<CallSite[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  if (language === "node") {
    const result = detectNodeCallSites(relativePath, content);
    return result.reveniumImports.map((imp) => {
      const lines = content.split("\n");
      return {
        filePath: relativePath,
        lineNumber: imp.lineNumber,
        provider: providerFromImport(imp.importPath),
        method: "revenium-instrumentation",
        operationType: "other",
        snippet: (lines[imp.lineNumber - 1] || "").trim(),
      };
    });
  }

  // Python / Go: scan provider-defined instrumentation imports as substrings
  const sites: CallSite[] = [];
  const lines = content.split("\n");
  const patterns = getPatternsForLanguage(language);
  const seen = new Set<string>();

  for (const provider of patterns) {
    for (const marker of provider.instrumentationImports) {
      if (!marker) continue;
      const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "g");
      let match;
      while ((match = re.exec(content)) !== null) {
        const lineNumber =
          content.substring(0, match.index).split("\n").length;
        const key = `${relativePath}:${lineNumber}:${provider.provider}`;
        if (seen.has(key)) continue;
        seen.add(key);

        sites.push({
          filePath: relativePath,
          lineNumber,
          provider: provider.provider,
          method: "revenium-instrumentation",
          operationType: "other",
          snippet: (lines[lineNumber - 1] || "").trim(),
        });
      }
    }
  }

  return sites;
}

function providerFromImport(importPath: string): string {
  // "@revenium/middleware/openai" => "openai"
  // "@revenium/middleware/google/genai" => "google-genai"
  // "@revenium/middleware/google/vertex" => "vertex-ai"
  // "@revenium/middleware/perplexity" => "perplexity"
  // "@revenium/middleware/anthropic" => "anthropic"
  const parts = importPath.split("/");
  const tail = parts.slice(2).join("/"); // strip "@revenium/middleware"
  if (!tail) return "unknown";

  if (tail === "openai") return "openai";
  if (tail === "anthropic") return "anthropic";
  if (tail === "perplexity") return "perplexity";
  if (tail === "google/genai" || tail === "google") return "google-genai";
  if (tail === "google/vertex") return "vertex-ai";
  return tail.replace(/\//g, "-");
}

export async function detectExistingInstrumentation(
  targetDir: string,
  language: SupportedLanguage,
): Promise<ExistingInstrumentation> {
  const packages = await detectInDependencyFiles(targetDir, language);

  const extensions = SOURCE_EXTENSIONS[language] || [];
  const sourceFiles = await getSourceFiles(targetDir, extensions);

  const instrumentationCallSites: CallSite[] = [];

  for (const filePath of sourceFiles) {
    const relativePath = relative(targetDir, filePath);
    const sites = await findInstrumentationCallSitesInFile(
      filePath,
      relativePath,
      language,
    );
    instrumentationCallSites.push(...sites);
  }

  return {
    detected: packages.length > 0 || instrumentationCallSites.length > 0,
    packages,
    callSites: instrumentationCallSites,
  };
}
