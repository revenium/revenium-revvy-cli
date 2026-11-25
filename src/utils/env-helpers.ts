import { join } from "path";
import { writeFile } from "fs/promises";
import { ENV_VARS, REVENIUM_API_BASE_URL } from "../constants/api.js";
import { safeReadFile } from "./fs-helpers.js";
import { backUpFile } from "./generated-file.js";

/**
 * Each managed key maps to the value it must hold, or null when its lines must
 * be removed. Keys left out of the record are not touched.
 */
export type MeteringEnvVars = Record<string, string | null>;

export interface EnvChange {
  action: "added" | "updated" | "removed";
  key: string;
}

export interface EnvMergeResult {
  content: string;
  /** Empty when nothing changed. */
  changes: EnvChange[];
}

export interface EnvWriteResult extends EnvMergeResult {
  /** True only when this call wrote a `.env` that did not exist before. */
  created: boolean;
  backupFile?: string;
}

export type BaseUrlTarget =
  | { kind: "default" }
  | { kind: "custom"; url: string }
  | { kind: "invalid" };

export interface MeteringEnvOptions {
  /**
   * False when the key could not be checked against the API. A stale
   * REVENIUM_METERING_BASE_URL is then kept, since nothing confirmed the key
   * belongs to production.
   */
  keyVerified: boolean;
}

const ENV_BLOCK_HEADER = "# Revenium Metering (added by Revvy)";
const API_KEY_PLACEHOLDER = "your_api_key_here";

export function resolveBaseUrlTarget(baseUrl: string | undefined): BaseUrlTarget {
  if (!baseUrl) return { kind: "default" };
  const validated = validateBaseUrlForEnv(baseUrl);
  if (!validated) return { kind: "invalid" };
  const url = validated.replace(/\/+$/, "");
  return url === REVENIUM_API_BASE_URL ? { kind: "default" } : { kind: "custom", url };
}

export function meteringEnvVars(
  apiKey: string | undefined,
  baseUrl: string | undefined,
  { keyVerified }: MeteringEnvOptions = { keyVerified: true },
): MeteringEnvVars {
  const vars: MeteringEnvVars = apiKey ? { [ENV_VARS.API_KEY]: apiKey } : {};
  const target = resolveBaseUrlTarget(baseUrl);
  if (target.kind === "custom") vars[ENV_VARS.BASE_URL] = target.url;
  if (target.kind === "default" && keyVerified) vars[ENV_VARS.BASE_URL] = null;
  return vars;
}

/** The Revenium block for a fresh `.env`, used for previews and the monorepo TODO. */
export function buildEnvContent(apiKey: string, baseUrl?: string): string {
  return mergeEnvContent(null, meteringEnvVars(apiKey || API_KEY_PLACEHOLDER, baseUrl)).content;
}

function envLinePattern(key: string): RegExp {
  return new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
}

/**
 * Sets the managed keys in a `.env` body. A key with a value keeps one line
 * (the first assignment, rewritten in place) and loses any later duplicates,
 * because dotenv loaders let the last assignment win. A null key loses every
 * assignment. Keys not yet present are appended in a Revenium block, and every
 * other line is left untouched.
 */
export function mergeEnvContent(existing: string | null, vars: MeteringEnvVars): EnvMergeResult {
  let lines = existing === null || existing === "" ? [] : existing.replace(/\n$/, "").split("\n");
  const changes: EnvChange[] = [];
  const missing: Array<[key: string, value: string]> = [];

  for (const [key, value] of Object.entries(vars)) {
    const pattern = envLinePattern(key);
    const matches = lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));
    if (matches.length === 0) {
      if (value !== null) missing.push([key, value]);
      continue;
    }
    if (value === null) {
      lines = lines.filter((_, index) => !matches.includes(index));
      changes.push({ action: "removed", key });
      continue;
    }
    const [first, ...duplicates] = matches;
    const exportPrefix = pattern.exec(lines[first!]!)?.[1] ?? "";
    const replacement = `${exportPrefix}${key}=${value}`;
    if (lines[first!] !== replacement || duplicates.length > 0) {
      lines[first!] = replacement;
      lines = lines.filter((_, index) => !duplicates.includes(index));
      changes.push({ action: "updated", key });
    }
  }

  if (missing.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(ENV_BLOCK_HEADER, ...missing.map(([key, value]) => `${key}=${value}`));
    changes.push(...missing.map(([key]) => ({ action: "added" as const, key })));
  }

  return { content: lines.length > 0 ? lines.join("\n") + "\n" : "", changes };
}

/**
 * Writes the metering keys to `<targetDir>/.env`. An existing `.env` that has
 * to change is first copied to a `.revvy-backup`, so a replaced key can be
 * recovered.
 */
export async function writeMeteringEnv(
  targetDir: string,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  options?: MeteringEnvOptions,
): Promise<EnvWriteResult> {
  const envPath = join(targetDir, ".env");
  const existing = await safeReadFile(envPath);
  const merged = mergeEnvContent(existing, meteringEnvVars(apiKey, baseUrl, options));
  if (merged.changes.length === 0) return { ...merged, created: false };

  const backupFile = existing === null ? undefined : await backUpFile(targetDir, ".env", existing);
  await writeFile(envPath, merged.content, "utf-8");
  return { ...merged, created: existing === null, backupFile };
}

export function describeEnvWrite(result: EnvWriteResult): string {
  if (result.changes.length === 0) return ".env already up to date";
  if (result.created) return `Created .env with ${result.changes.map((c) => c.key).join(", ")}`;
  const changes = result.changes.map((c) => `${c.action} ${c.key}`).join(", ");
  const backup = result.backupFile ? ` — previous version saved to ${result.backupFile}` : "";
  return `Updated .env (${changes})${backup}`;
}

export function validateBaseUrlForEnv(value: string | undefined): string | null {
  if (!value) return null;
  if (/[\r\n\0]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}
