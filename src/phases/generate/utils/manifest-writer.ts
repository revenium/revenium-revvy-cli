/**
 * Writes a machine-readable call-site manifest for AI agents and scripts.
 *
 * The manifest lists every detected AI call site with its location, provider,
 * method, suggested taskType, and a ready-to-paste usage_metadata snippet.
 * This enables agents to programmatically iterate through call sites and
 * apply instrumentation in one pass with zero ambiguity.
 */

import { writeGeneratedFile, type GeneratedFileResult } from "../../../utils/generated-file.js";
import { coerceCustomerId } from "../../../utils/customer-id-coercion.js";
import { pickAgentForFile } from "../../instrument/transforms/shared-helpers.js";
import { helperIdentityParameter } from "../config-helper.js";
import { goHelperIdentifiers } from "./go-identifiers.js";
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
  /**
   * Set when several agents were declared and none matched this file's name:
   * the snippet leaves `agent` out, and this is the first-declared agent to
   * confirm before adding it.
   */
  unconfirmedAgent?: string;
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

/** The helper arguments one call site should pass, before language syntax. */
interface SnippetValues {
  identityParameter: string;
  identity: string;
  product?: string;
  agent?: string;
  unconfirmedAgent?: string;
  taskType: string;
}

function resolveSnippetValues(callSite: CallSite, design: MeteringDesign): SnippetValues {
  const agentMatch = pickAgentForFile(design.agents, callSite.filePath);
  return {
    identityParameter: helperIdentityParameter(design),
    identity: design.organization.customerIdExpression || "<CUSTOMER_ID>",
    product: design.products[0]?.name,
    agent: agentMatch && !agentMatch.guessed ? agentMatch.name : undefined,
    unconfirmedAgent: agentMatch?.guessed ? agentMatch.name : undefined,
    taskType: deriveSuggestedTaskType(callSite),
  };
}

/**
 * A product or agent name as the helpers declare it: a string literal, so
 * `--product-names CRM` stays `"CRM"`. Only a name that is visibly code
 * (property access, index or call, e.g. `req.body.productName`) stays bare.
 */
function declaredName(name: string): string {
  return /[.[\]()]/.test(name) ? name : JSON.stringify(name);
}

function nodeSnippet(v: SnippetValues): string {
  const identity = v.identityParameter === "customerId" ? coerceCustomerId(v.identity) : v.identity;
  const fields = [`${v.identityParameter}: ${identity}`];
  if (v.product) fields.push(`product: ${declaredName(v.product)}`);
  if (v.agent) fields.push(`agent: ${declaredName(v.agent)}`);
  fields.push(`taskType: "${v.taskType}"`);
  return `createUsageMetadata({ ${fields.join(", ")} })`;
}

function pythonSnippet(v: SnippetValues): string {
  const args = [`${v.identityParameter}=${v.identity}`];
  if (v.product) args.push(`product=${declaredName(v.product)}`);
  if (v.agent) args.push(`agent=${declaredName(v.agent)}`);
  args.push(`task_type="${v.taskType}"`);
  return `create_usage_metadata(${args.join(", ")})`;
}

function goSnippet(v: SnippetValues, design: MeteringDesign): string {
  const idents = goHelperIdentifiers(design);
  const fields = [`${v.identityParameter}: ${v.identity}`];
  if (v.product) fields.push(`Product: revenium.${idents.products.get(v.product)}`);
  if (v.agent) fields.push(`Agent: revenium.${idents.agents.get(v.agent)}`);
  fields.push(`TaskType: "${v.taskType}"`);
  return `revenium.WithUsageMetadata(ctx, revenium.Context{${fields.join(", ")}})`;
}

/**
 * The expression an agent pastes at the call site, in the project's language
 * and against the generated helper's API: the Node/Python metadata argument,
 * or the Go context to pass as the call's ctx.
 */
function buildUsageMetadataSnippet(values: SnippetValues, design: MeteringDesign): string {
  if (design.detectedLanguage === "python") return pythonSnippet(values);
  if (design.detectedLanguage === "go") return goSnippet(values, design);
  return nodeSnippet(values);
}

export function buildCallSiteManifest(
  scanResult: ScanResult,
  design: MeteringDesign,
): CallSiteManifest {
  const callSites: ManifestCallSite[] = scanResult.callSites.map((cs) => {
    const values = resolveSnippetValues(cs, design);
    return {
      file: cs.filePath,
      line: cs.lineNumber,
      provider: cs.provider,
      method: cs.method,
      suggestedTaskType: values.taskType,
      enclosingFunction: cs.enclosingFunction,
      snippet: cs.snippet,
      usageMetadataSnippet: buildUsageMetadataSnippet(values, design),
      unconfirmedAgent: values.unconfirmedAgent,
    };
  });

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
): Promise<GeneratedFileResult> {
  const manifest = buildCallSiteManifest(scanResult, design);
  const content = JSON.stringify(manifest, null, 2) + "\n";
  return writeGeneratedFile(targetDir, getManifestFilename(design.detectedLanguage), content);
}
