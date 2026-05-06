/**
 * Base types and shared utilities for code transforms.
 * Language-specific helpers live in node/base-node-transform.ts
 * and python/base-python-transform.ts.
 */

import type { MeteringDesign } from "../../../types/metering-design.js";

export type { MeteringDesign };

export interface TransformContext {
  /** The metering design from the consultation phase */
  design: MeteringDesign;
  /** Path to the generated utility file (relative to project root) */
  utilityImportPath: string;
  /** Source file being instrumented (relative to project root). Used by transforms to
   *  pick the agent name whose label best matches the file name. Optional for backward
   *  compatibility with callers that haven't been updated yet. */
  filePath?: string;
}

export interface TransformResult {
  /** The modified file content */
  content: string;
  /** Whether any changes were made */
  modified: boolean;
  /** Human-readable description of changes */
  changes: string[];
}

/**
 * Counts the net depth contribution of a code line for a given pair of
 * delimiters, ignoring occurrences inside string literals and comments.
 *
 * Used by insertAfterImports to track whether a multi-line import block is
 * still open (e.g. `import {` followed by member names on subsequent lines,
 * closed by `}` later — TypeScript style — or `from x import (` ... `)` —
 * Python style).
 */
function netDelimiterDepth(line: string, open: string, close: string): number {
  let depth = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;

    // Skip JS/TS line comments
    if (c === "/" && line[i + 1] === "/") return depth;
    // Skip Python line comments
    if (c === "#") return depth;
    // Skip JS/TS block comments inline (best-effort — won't span lines but
    // most imports won't have block comments inside them anyway)
    if (c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) return depth;
      i = end + 2;
      continue;
    }
    // Skip string literals (single-line — multi-line template literals in
    // import lines would be highly unusual)
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < line.length) {
        if (line[i] === "\\") { i += 2; continue; }
        if (line[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  return depth;
}

/**
 * Inserts a line after the last import statement in the file.
 * Works for both Node/TS (`import { ... } from "x"`, including multi-line
 * brace blocks) and Python (`from x import (Y, Z)` parenthesised blocks).
 *
 * Tracks unbalanced `{`/`}` AND `(`/`)` so the insertion point is always
 * AFTER the closing token of any multi-line import block — never inside it.
 */
export function insertAfterImports(
  content: string,
  linesToInsert: string
): string {
  const lines = content.split("\n");
  let lastImportIndex = -1;
  let braceDepth = 0;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Inside an open multi-line import block — keep extending lastImportIndex
    // until both delimiter counts return to zero.
    if (braceDepth > 0 || parenDepth > 0) {
      lastImportIndex = i;
      braceDepth += netDelimiterDepth(raw, "{", "}");
      parenDepth += netDelimiterDepth(raw, "(", ")");
      continue;
    }

    const isImportLine =
      trimmed.startsWith("import ") ||
      trimmed.startsWith("import{") ||
      trimmed.startsWith("from ") ||
      trimmed.includes("require(") ||
      trimmed.startsWith("import(");

    if (isImportLine) {
      lastImportIndex = i;
      braceDepth += netDelimiterDepth(raw, "{", "}");
      parenDepth += netDelimiterDepth(raw, "(", ")");
    } else if (
      lastImportIndex > -1 &&
      trimmed !== "" &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*")
    ) {
      break;
    }
  }

  const insertAt = lastImportIndex + 1;
  lines.splice(insertAt, 0, linesToInsert);
  return lines.join("\n");
}

/**
 * Checks if a file already contains a specific import or string.
 */
export function hasImport(content: string, importStr: string): boolean {
  return content.includes(importStr);
}

/**
 * Heuristic: does this value look like a code expression (variable reference)
 * rather than a plain literal string?
 *
 * Expressions: req.user.orgId, config.PRODUCT_NAME, agent.name, AGENT_NAME, items[0]
 * Literals: Smart Search, support-bot, support_bot, AI Assistant, my-product
 */
export function isExpression(value: string): boolean {
  // Property access, array access, or function calls
  if (/[.[\]()]/.test(value)) return true;
  // CONSTANT_CASE (e.g., AGENT_NAME, CONFIG_VALUE) — at least 2 chars
  if (/^[A-Z][A-Z0-9_]+$/.test(value)) return true;
  // Simple identifiers like support_bot, myAgent are treated as literal names, not code
  return false;
}

/** Formats a value for Node/TS: unquoted if expression, quoted if literal. */
export function nodeValue(value: string): string {
  return isExpression(value) ? value : `"${value}"`;
}

/** Formats a value for Python: unquoted if expression, quoted if literal. */
export function pythonValue(value: string): string {
  return isExpression(value) ? value : `"${value}"`;
}
