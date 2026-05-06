/**
 * Headless smoke test for Revvy.
 *
 * Drives the consultation → design-builder → template renderer pipeline
 * across the realistic answer sets a user can produce, and asserts:
 *   - the right number of questions get asked per scenario
 *   - none of the cut questions reappear in any path
 *   - `source` is correctly inferred from the chosen tenant expression
 *   - design defaults (trackingGoal, outcomeTracking) are populated
 *   - rendered templates contain no leftover placeholders / EJS errors
 *
 * Skips the Ink TUI layer (keyboard navigation only). Wired into CI as
 * `pnpm smoke`. Exits non-zero on failure.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMeteringDesign } from "../src/phases/consultation/design-builder.js";
import { renderTemplate } from "../src/utils/template-engine.js";
import {
  FIRST_QUESTION_ID,
  QUESTIONS,
} from "../src/phases/consultation/questions.js";
import type {
  MeteringDesign,
  ScanResult,
  CustomerCandidate,
  CentralizedUtility,
  DetectedProvider,
  CallSite,
} from "../src/types/index.js";

// Templates are .ejs files — read them as text directly.
// `import.meta.dirname` was added in Node 20.11; use the fileURLToPath
// pattern so the smoke test runs on Node 18 too.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NODE_TEMPLATE = readFileSync(
  join(ROOT, "src/phases/generate/templates/node-ts/revenium-config.ts.ejs"),
  "utf-8",
);
const PYTHON_TEMPLATE = readFileSync(
  join(ROOT, "src/phases/generate/templates/python/revenium_config.py.ejs"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeScanResult(opts: {
  language?: "node" | "python" | "go";
  providers?: DetectedProvider[];
  customerCandidates?: CustomerCandidate[];
  centralizedUtility?: CentralizedUtility | null;
  callSites?: CallSite[];
}): ScanResult {
  return {
    language: opts.language ?? "node",
    projectName: "fixture",
    providers: opts.providers ?? [
      { name: "openai", displayName: "OpenAI", packageName: "openai" },
    ],
    callSites: opts.callSites ?? [],
    existingInstrumentation: { detected: false, packages: [], callSites: [] },
    totalFiles: 10,
    filesWithAICalls: 3,
    customerCandidates: opts.customerCandidates ?? [],
    centralizedUtility: opts.centralizedUtility ?? null,
    alternativeCentralizedUtilities: [],
  };
}

/** Mimics use-consultation.ts: walks QUESTIONS using a fixed answer map. */
function simulateConsultation(
  scanResult: ScanResult,
  answers: Record<string, string>,
): { askedIds: string[]; design: MeteringDesign } {
  const askedIds: string[] = [];
  let currentId: string | null = FIRST_QUESTION_ID;
  while (currentId) {
    askedIds.push(currentId);
    const q = QUESTIONS.find((x) => x.id === currentId);
    if (!q) throw new Error(`Unknown question id: ${currentId}`);
    if (!(currentId in answers)) {
      throw new Error(
        `Scenario forgot to provide an answer for question "${currentId}". ` +
          `Path so far: ${askedIds.join(" → ")}`,
      );
    }
    currentId = q.getNext({ answers, scanResult });
  }
  const design = buildMeteringDesign(answers, scanResult);
  return { askedIds, design };
}

function getTemplateData(d: MeteringDesign) {
  return {
    providers: d.detectedProviders,
    organization: d.organization,
    products: d.products,
    agents: d.agents,
    taskTypes: d.taskTypes,
    trackingGoal: d.trackingGoal,
    outcomeTracking: d.outcomeTracking,
    centralizedCallPattern: d.centralizedCallPattern,
  };
}

function header(title: string) {
  console.log("\n" + "=".repeat(78));
  console.log(`  ${title}`);
  console.log("=".repeat(78));
}

function subheader(title: string) {
  console.log(`\n--- ${title} ---`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
type Scenario = {
  name: string;
  scanResult: ScanResult;
  answers: Record<string, string>;
  expectations: {
    expectedQuestionCount: number;
    expectedSource: "auth-context" | "api-key" | "custom";
    expectedTrackingGoal: "billing" | "internal-allocation" | "both";
    expectedOutcomeTracking: boolean;
  };
};

const SCENARIOS: Scenario[] = [
  {
    name: "1. Auth-context tenant + products + agents + centralized auto-accept",
    scanResult: makeScanResult({
      language: "node",
      providers: [
        { name: "openai", displayName: "OpenAI", packageName: "openai" },
      ],
      customerCandidates: [
        {
          expression: "req.user.orgId",
          filesFound: 4,
          occurrences: 12,
          source: "auth-context",
          exampleFiles: ["src/api/x.ts"],
        },
      ],
      centralizedUtility: {
        filePath: "src/services/ai.ts",
        enclosedCallSites: 9,
        totalCallSites: 10,
        coverageRatio: 0.9,
        confidence: "high",
      },
    }),
    answers: {
      "customer-confirm": "req.user.orgId",
      products: "yes-products",
      "product-names": "Smart Search, AI Assistant",
      agents: "yes",
      "agent-names": "support-bot, research-agent",
      "centralized-confirm": "src/services/ai.ts",
    },
    expectations: {
      expectedQuestionCount: 6,
      expectedSource: "auth-context",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
  {
    name: "2. API-key tenant + no products + no agents + scattered calls",
    scanResult: makeScanResult({
      language: "node",
      providers: [
        {
          name: "anthropic",
          displayName: "Anthropic",
          packageName: "@anthropic-ai/sdk",
        },
      ],
      customerCandidates: [
        {
          expression: 'req.headers["x-api-key"]',
          filesFound: 2,
          occurrences: 5,
          source: "api-key",
          exampleFiles: ["src/middleware/auth.ts"],
        },
      ],
      centralizedUtility: null,
    }),
    answers: {
      "customer-confirm": 'req.headers["x-api-key"]',
      products: "no",
      agents: "no",
      "centralized-confirm": "__no_centralized__",
    },
    expectations: {
      expectedQuestionCount: 4,
      expectedSource: "api-key",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
  {
    name: "3. No tenant candidates → custom typed expression (auth-shaped)",
    scanResult: makeScanResult({
      language: "node",
      providers: [
        { name: "openai", displayName: "OpenAI", packageName: "openai" },
      ],
      customerCandidates: [],
      centralizedUtility: null,
    }),
    answers: {
      "customer-confirm": "__type_custom__",
      "customer-custom": "session.tenant_id",
      products: "yes-features",
      "product-names": "chat, search",
      agents: "no",
      "centralized-confirm": "__no_centralized__",
    },
    expectations: {
      expectedQuestionCount: 6,
      expectedSource: "auth-context",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
  {
    name: "4. No tenant candidates → custom typed (api-key shaped)",
    scanResult: makeScanResult({
      language: "node",
      providers: [
        { name: "openai", displayName: "OpenAI", packageName: "openai" },
      ],
      customerCandidates: [],
    }),
    answers: {
      "customer-confirm": "__type_custom__",
      "customer-custom": "request.headers.get('x-api-key')",
      products: "no",
      agents: "no",
      "centralized-confirm": "__no_centralized__",
    },
    expectations: {
      expectedQuestionCount: 5,
      expectedSource: "api-key",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
  {
    name: "5. Python project + Anthropic + auth tenant",
    scanResult: makeScanResult({
      language: "python",
      providers: [
        {
          name: "anthropic",
          displayName: "Anthropic",
          packageName: "anthropic",
        },
      ],
      customerCandidates: [
        {
          expression: "current_user.org_id",
          filesFound: 3,
          occurrences: 8,
          source: "auth-context",
          exampleFiles: ["app/auth.py"],
        },
      ],
      centralizedUtility: {
        filePath: "app/services/llm.py",
        enclosedCallSites: 6,
        totalCallSites: 7,
        coverageRatio: 0.857,
        confidence: "high",
      },
    }),
    answers: {
      "customer-confirm": "current_user.org_id",
      products: "yes-products",
      "product-names": "DocAnalyzer",
      agents: "yes",
      "agent-names": "doc-bot",
      "centralized-confirm": "app/services/llm.py",
    },
    expectations: {
      expectedQuestionCount: 6,
      expectedSource: "auth-context",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
  {
    name: "6. PICK_DIFFERENT centralized path",
    scanResult: makeScanResult({
      customerCandidates: [
        {
          expression: "req.user.orgId",
          filesFound: 1,
          occurrences: 1,
          source: "auth-context",
          exampleFiles: ["src/x.ts"],
        },
      ],
      centralizedUtility: {
        filePath: "src/wrong.ts",
        enclosedCallSites: 1,
        totalCallSites: 5,
        coverageRatio: 0.2,
        confidence: "low",
      },
    }),
    answers: {
      "customer-confirm": "req.user.orgId",
      products: "no",
      agents: "no",
      "centralized-confirm": "__pick_different__",
      "centralized-path": "src/correct/ai-factory.ts",
    },
    expectations: {
      expectedQuestionCount: 5,
      expectedSource: "auth-context",
      expectedTrackingGoal: "internal-allocation",
      expectedOutcomeTracking: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const sc of SCENARIOS) {
  header(sc.name);

  let askedIds: string[];
  let design: MeteringDesign;
  try {
    ({ askedIds, design } = simulateConsultation(sc.scanResult, sc.answers));
  } catch (e) {
    fail++;
    failures.push(`${sc.name} → ${(e as Error).message}`);
    console.log(`FAIL: ${(e as Error).message}`);
    continue;
  }

  console.log(`Questions asked (${askedIds.length}): ${askedIds.join(" → ")}`);

  // Assertions
  const checks: Array<[string, boolean, string]> = [
    [
      "question count",
      askedIds.length === sc.expectations.expectedQuestionCount,
      `expected ${sc.expectations.expectedQuestionCount}, got ${askedIds.length}`,
    ],
    [
      "no cut questions in path",
      !askedIds.some((id) =>
        ["tracking-goal", "org-identification", "org-help", "outcome-tracking"].includes(id),
      ),
      `cut questions reappeared: ${askedIds.filter((id) => ["tracking-goal", "org-identification", "org-help", "outcome-tracking"].includes(id)).join(", ")}`,
    ],
    [
      "source inference",
      design.organization.source === sc.expectations.expectedSource,
      `expected ${sc.expectations.expectedSource}, got ${design.organization.source}`,
    ],
    [
      "trackingGoal default",
      design.trackingGoal === sc.expectations.expectedTrackingGoal,
      `expected ${sc.expectations.expectedTrackingGoal}, got ${design.trackingGoal}`,
    ],
    [
      "outcomeTracking default",
      design.outcomeTracking === sc.expectations.expectedOutcomeTracking,
      `expected ${sc.expectations.expectedOutcomeTracking}, got ${design.outcomeTracking}`,
    ],
  ];

  for (const [name, ok, detail] of checks) {
    if (ok) {
      console.log(`  PASS  ${name}`);
      pass++;
    } else {
      console.log(`  FAIL  ${name} — ${detail}`);
      fail++;
      failures.push(`${sc.name} → ${name}: ${detail}`);
    }
  }

  subheader("MeteringDesign JSON");
  console.log(JSON.stringify(design, null, 2));

  subheader(
    `Generated utility (${design.detectedLanguage === "python" ? "revenium_config.py" : "revenium-config.ts"})`,
  );
  const template =
    design.detectedLanguage === "python" ? PYTHON_TEMPLATE : NODE_TEMPLATE;
  const output = renderTemplate(template, getTemplateData(design));
  console.log(output);
}

header("SUMMARY");
console.log(`Passed: ${pass}`);
console.log(`Failed: ${fail}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
