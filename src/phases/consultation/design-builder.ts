import type {
  MeteringDesign,
  Organization,
  Product,
  Agent,
  TaskTypeDefinition,
} from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";
import {
  TYPE_CUSTOM,
  PICK_DIFFERENT,
  NO_CENTRALIZED,
} from "./questions.js";

type Answers = Record<string, string | string[]>;

function parseCommaSeparated(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolves the customer ID expression. Order of precedence:
 *  1. user picked one of the auto-detected candidates  → use that
 *  2. user typed a custom expression                    → use that
 *  3. nothing useful captured                           → empty string
 */
function resolveCustomerExpression(answers: Answers): string {
  const confirm = answers["customer-confirm"] as string | undefined;
  if (confirm && confirm !== TYPE_CUSTOM) return confirm;

  const custom = (answers["customer-custom"] as string) || "";
  return custom;
}

/**
 * Heuristic for inferring `source` when the user typed a custom expression
 * (or the scan returned no candidates). We look for the tell-tale shape of
 * an api-key lookup so the generated code uses `subscriber.credential`
 * instead of `organizationName`.
 */
function inferSourceFromExpression(expression: string): Organization["source"] {
  if (!expression) return "auth-context";
  const lower = expression.toLowerCase();
  if (
    lower.includes("api-key") ||
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("x-api-key")
  ) {
    return "api-key";
  }
  return "auth-context";
}

function buildOrganization(answers: Answers, scanResult: ScanResult): Organization {
  const expression = resolveCustomerExpression(answers);

  // If the user picked an auto-detected candidate, use the candidate's
  // declared source (the AST walker already classifies auth-context vs
  // api-key per occurrence). Otherwise fall back to a shape-based guess
  // on the typed expression.
  const matchingCandidate = scanResult.customerCandidates.find(
    (c) => c.expression === expression,
  );
  const source: Organization["source"] = matchingCandidate
    ? matchingCandidate.source
    : inferSourceFromExpression(expression);

  return {
    customerIdExpression: expression,
    source,
  };
}

function buildProducts(answers: Answers): Product[] {
  if ((answers.products as string) === "no") return [];
  const names = answers["product-names"] as string | undefined;
  if (!names) return [];
  return parseCommaSeparated(names).map((name) => ({ name }));
}

function buildAgents(answers: Answers): Agent[] {
  if ((answers.agents as string) === "no") return [];
  const names = answers["agent-names"] as string | undefined;
  if (!names) return [];
  return parseCommaSeparated(names).map((name) => ({ name }));
}

/**
 * Derive the per-call-site task-type suggestions used in the manifest.
 * Same logic as manifest-writer.deriveSuggestedTaskType — duplicated here
 * (without an import to avoid a circular dependency) so the metering-design
 * file's `taskTypes` array agrees with the per-call-site suggestions in the
 * call-site manifest. Without this they could disagree (design says "chat",
 * manifest says "process-resume") even though both come from the same scan.
 */
function functionToTaskType(fn: string | undefined, fallback: string): string {
  if (!fn || /^anonymous|^arrow|^<|callback/i.test(fn)) return fallback;
  return fn
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function buildTaskTypes(scanResult: ScanResult): TaskTypeDefinition[] {
  // Prefer enclosingFunction-derived names — they're meaningful and match
  // what the call-sites manifest emits as `suggestedTaskType`. Fall back to
  // the SDK-method operationType (chat/embed/etc) when no enclosing function
  // is available (anonymous arrow, top-level call, etc).
  const uniqueTypes = new Map<string, string>();   // name → description
  for (const site of scanResult.callSites) {
    const taskType = functionToTaskType(site.enclosingFunction, site.operationType);
    if (uniqueTypes.has(taskType)) continue;
    const description = site.enclosingFunction && taskType !== site.operationType
      ? `Derived from ${site.enclosingFunction}() in ${site.filePath}`
      : `AI ${site.operationType} operation`;
    uniqueTypes.set(taskType, description);
  }
  return Array.from(uniqueTypes.entries()).map(([name, description]) => ({
    name,
    description,
  }));
}

interface ResolvedCentralized {
  detected: boolean;
  filePath?: string;
  description?: string;
}

function resolveCentralized(answers: Answers): ResolvedCentralized {
  const choice = answers["centralized-confirm"] as string | undefined;

  if (!choice || choice === NO_CENTRALIZED) return { detected: false };

  if (choice === PICK_DIFFERENT) {
    const path = (answers["centralized-path"] as string) || "";
    return path ? { detected: true, filePath: path } : { detected: false };
  }

  // The choice value is the file path of one of the auto-discovered options.
  return { detected: true, filePath: choice };
}

export interface CliDesignArgs {
  customerIdExpression?: string;
  productNames?: string;
  agentNames?: string;
  centralizedUtility?: string;
}

/**
 * Builds a MeteringDesign from CLI arguments (non-interactive mode).
 * Synthesizes an answers record and calls the standard buildMeteringDesign.
 */
export function buildDesignFromArgs(
  args: CliDesignArgs,
  scanResult: ScanResult,
): MeteringDesign {
  const answers: Answers = {};

  if (args.customerIdExpression) {
    answers["customer-confirm"] = TYPE_CUSTOM;
    answers["customer-custom"] = args.customerIdExpression;
  } else if (scanResult.customerCandidates.length > 0) {
    answers["customer-confirm"] = scanResult.customerCandidates[0]!.expression;
  } else {
    answers["customer-confirm"] = TYPE_CUSTOM;
    answers["customer-custom"] = "";
  }

  if (args.productNames) {
    answers["products"] = "yes-products";
    answers["product-names"] = args.productNames;
  } else {
    answers["products"] = "no";
  }

  if (args.agentNames) {
    answers["agents"] = "yes";
    answers["agent-names"] = args.agentNames;
  } else {
    answers["agents"] = "no";
  }

  if (args.centralizedUtility && args.centralizedUtility !== "none") {
    answers["centralized-confirm"] = args.centralizedUtility;
  } else {
    answers["centralized-confirm"] = NO_CENTRALIZED;
  }

  return buildMeteringDesign(answers, scanResult);
}

export function buildMeteringDesign(
  answers: Answers,
  scanResult: ScanResult,
): MeteringDesign {
  const centralized = resolveCentralized(answers);

  return {
    version: "1.0",
    // trackingGoal isn't asked yet — defaulted for forward compat with v1.x
    // templates that may branch on billing vs internal-allocation modes.
    trackingGoal: "internal-allocation",
    organization: buildOrganization(answers, scanResult),
    products: buildProducts(answers),
    agents: buildAgents(answers),
    taskTypes: buildTaskTypes(scanResult),
    outcomeTracking: false,
    centralizedCallPattern: {
      detected: centralized.detected,
      filePath: centralized.filePath,
      description: centralized.description,
    },
    callSiteCount: scanResult.callSites.length,
    detectedProviders: scanResult.providers.map((p) => p.displayName),
    detectedLanguage: scanResult.language,
  };
}
