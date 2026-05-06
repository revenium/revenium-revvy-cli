/**
 * Writes a machine-readable call-site manifest for AI agents and scripts.
 *
 * The manifest lists every detected AI call site with its location, provider,
 * method, suggested taskType, and a ready-to-paste usage_metadata snippet.
 * This enables agents to programmatically iterate through call sites and
 * apply instrumentation in one pass with zero ambiguity.
 */

import { join } from "path";
import { safeWriteFile } from "../../../utils/fs-helpers.js";
import { coerceCustomerId } from "../../../utils/customer-id-coercion.js";
import type { ScanResult, CallSite } from "../../../types/scan-result.js";
import type { MeteringDesign } from "../../../types/metering-design.js";

export interface ManifestCallSite {
  file: string;
  line: number;
  provider: string;
  method: string;
  suggestedTaskType: string;
  enclosingFunction?: string;
  snippet: string;
  usageMetadataSnippet: string;
}

export interface CallSiteManifest {
  version: "1.0";
  language: string;
  totalCallSites: number;
  customerIdExpression: string | null;
  callSites: ManifestCallSite[];
}

/**
 * Derives a human-meaningful task type from the function/method enclosing
 * the call site. Falls back to the SDK operation type (chat/embed/...) only
 * when no enclosing function is available.
 *
 * Examples:
 *   triageTicket    → "triage-ticket"
 *   draftReply      → "draft-reply"
 *   summarize_text  → "summarize-text"
 *   handleRequest   → "handle-request"
 *   (anonymous)     → fallback to operationType
 */
function deriveSuggestedTaskType(callSite: CallSite): string {
  const fn = callSite.enclosingFunction;
  if (!fn || /^anonymous|^arrow|^<|callback/i.test(fn)) {
    return callSite.operationType;
  }
  // camelCase → kebab-case, snake_case → kebab-case
  return fn
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function buildUsageMetadataSnippet(
  callSite: CallSite,
  design: MeteringDesign,
): string {
  const customerExpr = design.organization.customerIdExpression || "<CUSTOMER_ID>";
  const isPython = design.detectedLanguage === "python";
  const taskType = deriveSuggestedTaskType(callSite);

  if (isPython) {
    // Python: helper takes keyword args. This shape IS valid Python.
    return `create_usage_metadata(customer_id=${customerExpr}, task_type="${taskType}")`;
  }

  // Node/TS: helper takes a single object argument. The previous shape
  // (`createUsageMetadata(customerId: ..., taskType: ...)`) was Swift/Python
  // named-arg syntax — invalid TypeScript. Agents copy this verbatim, so it
  // must compile.
  //
  // organizationName is wire-typed as `string`. If the customer expression
  // looks like it might be numeric, wrap it in String() so the snippet
  // type-checks even when teamId is `number`. Same logic is shared with the
  // in-file reference comment + monorepo TODO + agent guide Step 3.
  return `createUsageMetadata({ customerId: ${coerceCustomerId(customerExpr)}, taskType: "${taskType}" })`;
}

export function buildCallSiteManifest(
  scanResult: ScanResult,
  design: MeteringDesign,
): CallSiteManifest {
  const callSites: ManifestCallSite[] = scanResult.callSites.map((cs) => ({
    file: cs.filePath,
    line: cs.lineNumber,
    provider: cs.provider,
    method: cs.method,
    suggestedTaskType: deriveSuggestedTaskType(cs),
    enclosingFunction: cs.enclosingFunction,
    snippet: cs.snippet,
    usageMetadataSnippet: buildUsageMetadataSnippet(cs, design),
  }));

  return {
    version: "1.0",
    language: scanResult.language,
    totalCallSites: callSites.length,
    customerIdExpression: design.organization.customerIdExpression || null,
    callSites,
  };
}

export function getManifestFilename(language?: string): string {
  return language === "python"
    ? "revenium_call_sites.json"
    : "revenium-call-sites.json";
}

export async function writeCallSiteManifest(
  targetDir: string,
  scanResult: ScanResult,
  design: MeteringDesign,
): Promise<string> {
  const manifest = buildCallSiteManifest(scanResult, design);
  const filename = getManifestFilename(design.detectedLanguage);
  const filePath = join(targetDir, filename);
  await safeWriteFile(filePath, JSON.stringify(manifest, null, 2) + "\n");
  return filePath;
}
