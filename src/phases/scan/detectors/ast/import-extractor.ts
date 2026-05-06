/**
 * Lightweight import extraction for Python and Go.
 * Used to filter call-site patterns so we only run a provider's regex on
 * files that actually import that provider.
 */

const PYTHON_IMPORT_BARE_RE = /^\s*import\s+([A-Za-z0-9_.,\s]+?)(?:\s+as\s+\w+)?$/gm;
const PYTHON_IMPORT_FROM_RE =
  /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_.,\s*()]+?)(?:\s+as\s+\w+)?$/gm;

const GO_IMPORT_RE = /"([^"]+)"/g;

/**
 * Extracts every importable name from a Python file. For each import we add:
 *   - the bare module name as written            (`anthropic`, `google`)
 *   - any submodule from `from X import Y`       (adds `X.Y` for each Y)
 *   - the top-level package                       (`google.genai` => `google`)
 *
 * This lets `hasAnyImport` find both:
 *   `from google import genai`     => imports {google, google.genai}
 *   `import google.generativeai`   => imports {google.generativeai, google}
 *   `from openai import OpenAI`    => imports {openai}
 */
export function extractPythonImports(content: string): Set<string> {
  const imports = new Set<string>();

  // `import X` / `import X.Y` / `import X, Y`
  PYTHON_IMPORT_BARE_RE.lastIndex = 0;
  let match;
  while ((match = PYTHON_IMPORT_BARE_RE.exec(content)) !== null) {
    for (const raw of match[1]!.split(",")) {
      const pkg = raw.trim();
      if (!pkg) continue;
      imports.add(pkg);
      const top = pkg.split(".")[0]!;
      if (top && top !== pkg) imports.add(top);
    }
  }

  // `from X import Y, Z`
  PYTHON_IMPORT_FROM_RE.lastIndex = 0;
  while ((match = PYTHON_IMPORT_FROM_RE.exec(content)) !== null) {
    const base = match[1]!;
    imports.add(base);
    const top = base.split(".")[0]!;
    if (top && top !== base) imports.add(top);

    // Add `base.symbol` for each imported symbol — Python allows
    // `from google import genai`, where `genai` is a submodule we want to
    // detect as `google.genai`.
    const names = match[2]!
      .replace(/[()]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "*");
    for (const name of names) {
      imports.add(`${base}.${name}`);
    }
  }

  return imports;
}

/**
 * Extracts every imported package path from a Go file by scanning for
 * `import (...)` blocks and single `import "..."` statements.
 */
export function extractGoImports(content: string): Set<string> {
  const imports = new Set<string>();

  // Find import blocks: `import (` ... `)` and single-line `import "x"`
  const blockRe = /import\s*\(([\s\S]*?)\)/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(content)) !== null) {
    const block = blockMatch[1]!;
    let lineMatch;
    GO_IMPORT_RE.lastIndex = 0;
    while ((lineMatch = GO_IMPORT_RE.exec(block)) !== null) {
      imports.add(lineMatch[1]!);
    }
  }

  const singleRe = /import\s+(?:[A-Za-z0-9_.]+\s+)?"([^"]+)"/g;
  let singleMatch;
  while ((singleMatch = singleRe.exec(content)) !== null) {
    imports.add(singleMatch[1]!);
  }

  return imports;
}

/**
 * Returns true if any of the given package names appears in the import set.
 *
 * For Python we accept the dotted module form ("google.genai") or its
 * hyphenated PyPI form ("google-genai"). We deliberately do NOT collapse to a
 * single top-level segment ("google" alone), because that triggers false
 * positives across unrelated packages that share a top-level namespace
 * (e.g. `google.cloud.aiplatform` vs `google.genai`). Patterns that need
 * top-level matching (e.g. `langchain_openai`) should list every variant in
 * `packageNames` explicitly.
 *
 * An empty `packageNames` array means "no native SDK import identifies this
 * provider" — typically a wrapper-only provider (e.g. Perplexity, which uses
 * the OpenAI client and is only identifiable via its Revenium middleware).
 */
export function hasAnyImport(
  packageNames: string[],
  importedNames: Set<string>,
): boolean {
  if (packageNames.length === 0) return false;
  for (const pkg of packageNames) {
    if (importedNames.has(pkg)) return true;
    const dotted = pkg.replace(/-/g, ".");
    if (importedNames.has(dotted)) return true;
    const hyphenated = pkg.replace(/\./g, "-");
    if (importedNames.has(hyphenated)) return true;
  }
  return false;
}
