/**
 * Validate a value before persisting it to a customer's `.env` file.
 *
 * Returns the value unchanged if it's safe to write, or null if it should be
 * dropped. Two protections:
 *   1. Rejects newlines and other control chars that could inject extra .env lines.
 *   2. Rejects values that don't parse as a valid http(s) URL — prevents silently
 *      directing customer traffic at a non-http scheme or malformed endpoint.
 */
import { REVENIUM_API_BASE_URL } from "../constants/api.js";
import { generateEnvContent } from "../phases/instrument/instrumenter.js";

/**
 * Builds the full `.env` content for Revenium: API key line + optional base URL line.
 *
 * If `REVENIUM_METERING_BASE_URL` is set in the current process env AND differs from
 * the production default, it's included so the target app hits the same environment
 * (dev/staging) without the developer re-exporting the var manually.
 */
export function buildEnvContent(apiKey: string): string {
  const validatedBaseUrl = validateBaseUrlForEnv(process.env["REVENIUM_METERING_BASE_URL"]);
  const baseUrlLine =
    validatedBaseUrl && validatedBaseUrl !== REVENIUM_API_BASE_URL
      ? `REVENIUM_METERING_BASE_URL=${validatedBaseUrl}\n`
      : "";
  return generateEnvContent(apiKey) + baseUrlLine;
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
