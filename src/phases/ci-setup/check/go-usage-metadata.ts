import { readFile } from "fs/promises";
import { join } from "path";
import { buildMethodRegex } from "../../scan/detectors/call-site-detector.js";
import type { CallSite } from "../../../types/scan-result.js";

const BUILDS_METADATA = /\b(?:WithUsageMetadata|UsageMetadata)\s*\(/;
const GO_IDENTIFIER = /^[A-Za-z_]\w*$/;
const TOP_LEVEL_FUNC = /^func\b/gm;

const blank = (text: string): string => text.replace(/[^\n]/g, " ");

/**
 * The source with comments and the contents of string and rune literals
 * replaced by spaces. Offsets and line breaks are kept, so every scan below
 * sees only code and an apostrophe in `// don't` cannot open a literal.
 */
function codeOnly(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : next === "/" ? end : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && (c === "`" || source[j] !== "\n")) {
        j += source[j] === "\\" && c !== "`" ? 2 : 1;
      }
      out += c + blank(source.slice(i + 1, j)) + (source[j] ?? "");
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const OPENERS = "([{";
const CLOSERS = ")]}";

function depthDelta(c: string): number {
  if (OPENERS.includes(c)) return 1;
  if (CLOSERS.includes(c)) return -1;
  return 0;
}

function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += depthDelta(code[i]!);
    if (depth === 0) return i;
  }
  return -1;
}

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    depth += depthDelta(args[i]!);
    if (args[i] === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts;
}

function findCall(code: string, site: CallSite): { start: number; args: string[] } | null {
  const regex = buildMethodRegex(site.method);
  regex.lastIndex = code.split("\n").slice(0, site.lineNumber - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const match = regex.exec(code);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = closingParen(code, open);
  return close < 0 ? null : { start: match.index, args: splitTopLevelArgs(code.slice(open + 1, close)) };
}

/**
 * gofmt puts every top-level `func` at column 0, so the last one before the
 * call starts the function whose body can declare the call's ctx.
 */
function enclosingFunctionStart(code: string, callStart: number): number {
  let start = 0;
  for (const match of code.matchAll(TOP_LEVEL_FUNC)) {
    if (match.index >= callStart) break;
    start = match.index;
  }
  return start;
}

/** Whether a declaration at `from` is still visible at the end of `body`: no block it sits in closes before then. */
function inScopeAtEnd(body: string, from: number): boolean {
  let depth = 0;
  for (let i = from; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth < 0) return false;
  }
  return true;
}

/** The right-hand side of an assignment, which may start on the line after the `=`. */
function rightHandSide(body: string, from: number): string {
  let i = from;
  while (i < body.length && /\s/.test(body[i]!)) i++;
  let depth = 0;
  const start = i;
  for (; i < body.length; i++) {
    const c = body[i]!;
    if (depth === 0 && (c === "\n" || c === ";")) break;
    depth += depthDelta(c);
  }
  return body.slice(start, i);
}

interface CtxDeclaration {
  at: number;
  scopeFrom: number;
  carriesMetadata: boolean;
  derivesFromItself: boolean;
}

function ctxDeclarations(body: string, ctxName: string): CtxDeclaration[] {
  const declarations: CtxDeclaration[] = [];
  const assignment = new RegExp(`(?<![\\w.])(?:[A-Za-z_]\\w*\\s*,\\s*)*${ctxName}(?:\\s*,\\s*[A-Za-z_]\\w*)*\\s*:?=(?!=)`, "g");
  const ownName = new RegExp(`\\b${ctxName}\\b`);
  for (const match of body.matchAll(assignment)) {
    const rhs = rightHandSide(body, match.index + match[0].length);
    declarations.push({
      at: match.index,
      scopeFrom: match.index,
      carriesMetadata: BUILDS_METADATA.test(rhs),
      derivesFromItself: ownName.test(rhs),
    });
  }
  const parameter = new RegExp(`[(,]\\s*${ctxName}(?:\\s*,\\s*[A-Za-z_]\\w*)*\\s+[\\w.*[]`);
  for (const match of body.matchAll(/\bfunc\b/g)) {
    const bodyOpen = body.indexOf("{", match.index);
    if (bodyOpen < 0 || !parameter.test(body.slice(match.index, bodyOpen))) continue;
    declarations.push({ at: match.index, scopeFrom: bodyOpen + 1, carriesMetadata: false, derivesFromItself: false });
  }
  return declarations.sort((a, b) => b.at - a.at);
}

/**
 * Follows the ctx variable back through the declarations visible at the call:
 * the nearest one decides, except that `ctx, cancel := context.WithTimeout(ctx, d)`
 * keeps whatever the earlier ctx carried.
 */
function ctxCarriesMetadata(body: string, ctxName: string): boolean {
  for (const declaration of ctxDeclarations(body, ctxName)) {
    if (!inScopeAtEnd(body, declaration.scopeFrom)) continue;
    if (declaration.carriesMetadata) return true;
    if (!declaration.derivesFromItself) return false;
  }
  return false;
}

/**
 * Whether a Go AI call carries usage metadata: either an argument builds it
 * inline (`revenium.WithUsageMetadata(ctx, ...)` as ctx, or fal's trailing
 * `revenium.UsageMetadata(...)`), or the ctx variable it receives holds a
 * context built by WithUsageMetadata where the call reads it.
 */
export function goCallCarriesUsageMetadata(source: string, site: CallSite): boolean {
  const code = codeOnly(source);
  const call = findCall(code, site);
  if (!call) return false;
  if (call.args.some((arg) => BUILDS_METADATA.test(arg))) return true;
  const ctxName = call.args[0] ?? "";
  if (!GO_IDENTIFIER.test(ctxName)) return false;
  return ctxCarriesMetadata(code.slice(enclosingFunctionStart(code, call.start), call.start), ctxName);
}

export async function countGoCallsWithUsageMetadata(targetDir: string, sites: CallSite[]): Promise<number> {
  const sources = new Map<string, string | null>();
  let count = 0;
  for (const site of sites) {
    if (!sources.has(site.filePath)) {
      sources.set(site.filePath, await readFile(join(targetDir, site.filePath), "utf-8").catch(() => null));
    }
    const source = sources.get(site.filePath);
    if (source != null && goCallCarriesUsageMetadata(source, site)) count++;
  }
  return count;
}
