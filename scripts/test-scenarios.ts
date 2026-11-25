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
import { readFileSync, mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMeteringDesign, buildDesignFromArgs } from "../src/phases/consultation/design-builder.js";
import { renderTemplate } from "../src/utils/template-engine.js";
import { validateProviderKey } from "../src/constants/validation.js";
import { transformNodeGoogleGenAI } from "../src/phases/instrument/transforms/node/google-genai-transform.js";
import { transformNodeOpenAI } from "../src/phases/instrument/transforms/node/openai-transform.js";
import { transformNodeAnthropic } from "../src/phases/instrument/transforms/node/anthropic-transform.js";
import { transformNodePerplexity } from "../src/phases/instrument/transforms/node/perplexity-transform.js";
import { transformPythonOpenAI } from "../src/phases/instrument/transforms/python/openai-transform.js";
import { transformPythonAnthropic } from "../src/phases/instrument/transforms/python/anthropic-transform.js";
import { runCheck } from "../src/phases/ci-setup/check/runCheck.js";
import { describeMeteringStatus } from "../src/phases/ci-setup/check/metering-status.js";
import { buildEnvContent, mergeEnvContent, meteringEnvVars, writeMeteringEnv } from "../src/utils/env-helpers.js";
import { appendIgnoreEntries, missingIgnoreEntries, REVVY_IGNORED_ENTRIES } from "../src/utils/gitignore.js";
import {
  describeGeneratedGroup,
  planGeneratedWrite,
  writeGeneratedFile,
  type GeneratedFileResult,
} from "../src/utils/generated-file.js";
import { hasNothingToSetUp } from "../src/phases/scan/no-ai-calls.js";
import { buildModifiedFilesManifest } from "../src/phases/generate/utils/modified-files-writer.js";
import { buildNodeCommentBlock } from "../src/phases/instrument/transforms/node/base-node-transform.js";
import { renderConfigHelper, nodeHelperImportSpecifier } from "../src/phases/generate/config-helper.js";
import { buildCallSiteManifest } from "../src/phases/generate/utils/manifest-writer.js";
import { getEditorRules } from "../src/phases/ci-setup/templates/editorRules.js";
import { goCallCarriesUsageMetadata } from "../src/phases/ci-setup/check/go-usage-metadata.js";
import { bareIdentifierNotice } from "../src/utils/customer-id-notice.js";
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

header("Billing-provider credential checks");

const UUID = "12345678-1234-1234-1234-123456789012";
const CREDENTIAL_CASES: Array<[provider: string, key: string, accepted: boolean]> = [
  ["openai_enterprise", JSON.stringify({ adminKey: "sk-admin-abc", workspaceId: UUID }), true],
  ["openai_enterprise", JSON.stringify({ adminKey: "sk-abc", workspaceId: UUID }), false],
  ["openai_enterprise", JSON.stringify({ adminKey: "sk-admin-abc", workspaceId: "not-a-uuid" }), false],
  ["openai_enterprise", JSON.stringify({ adminKey: "sk-admin-abc" }), false],
  ["openai_enterprise", "sk-admin-abc", false],
  ["cursor", "a".repeat(16), true],
  ["cursor", "a".repeat(15), false],
  ["cursor", "aaaaaaaa aaaaaaaa", false],
  ["github_copilot", JSON.stringify({ token: "github_pat_x", orgName: "acme" }), true],
  ["github_copilot", JSON.stringify({ token: "github_pat_x" }), false],
  ["openrouter", JSON.stringify({ provisioningKey: "sk-or-v1-x" }), true],
  ["openrouter", JSON.stringify({ provisioningKey: "sk-x" }), false],
];

for (const [provider, key, accepted] of CREDENTIAL_CASES) {
  const name = `${provider} ${accepted ? "accepts" : "rejects"} ${key.slice(0, 48)}`;
  if (validateProviderKey(provider, key).valid === accepted) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    fail++;
    failures.push(`credential check → ${name}`);
  }
}

header("Node Google GenAI transform");

const GEMINI_DESIGN = simulateConsultation(SCENARIOS[0]!.scanResult, SCENARIOS[0]!.answers).design;
const geminiCtx = { design: GEMINI_DESIGN, filePath: "src/chat.ts" };
const SIDE_EFFECT_LINE = /^import "@revenium\/middleware\/google\/genai";/m;
const OLD_CONTROLLER_LINE = `import { GoogleGenAIController } from "@revenium/middleware/google/genai"; // Revenium: controller wrapper for Google GenAI`;
const GEMINI_CASES: Array<[name: string, source: string, check: (out: string) => boolean]> = [
  [
    "compact @google/genai import gets the side-effect import",
    `import{GoogleGenAI}from"@google/genai";\nconst ai = new GoogleGenAI({});\n`,
    (out) => SIDE_EFFECT_LINE.test(out) && !out.includes("{ GoogleGenAIController }"),
  ],
  [
    "require('@google/genai') gets a side-effect require, never an ESM import",
    `const { GoogleGenAI } = require("@google/genai");\n`,
    (out) => /^require\("@revenium\/middleware\/google\/genai"\);/m.test(out) && !/^import "@revenium\/middleware\/google\/genai";/m.test(out),
  ],
  [
    "@google/genai/node gets the side-effect import",
    `import { GoogleGenAI } from "@google/genai/node";\n`,
    (out) => SIDE_EFFECT_LINE.test(out),
  ],
  [
    "@google/generative-ai keeps the controller import",
    `import { GoogleGenerativeAI } from "@google/generative-ai";\n`,
    (out) => out.includes("{ GoogleGenAIController }") && !SIDE_EFFECT_LINE.test(out),
  ],
  [
    "an earlier run's unused controller import is upgraded",
    `import { GoogleGenAI } from "@google/genai";\n${OLD_CONTROLLER_LINE}\nconst ai = new GoogleGenAI({});\n`,
    (out) => SIDE_EFFECT_LINE.test(out) && !out.includes("{ GoogleGenAIController }"),
  ],
  [
    "an earlier run's import and controller reference block are both replaced",
    `import { GoogleGenAI } from "@google/genai";\n${OLD_CONTROLLER_LINE}\n// ── Revenium: middleware usage reference ──────────────────────────\n// Usage with Revenium Google GenAI middleware (controller pattern):\n//   const controller = new GoogleGenAIController();\n// ────────────────────────────────────────────────────────────────\nconst mime = "image/*"; const url = "https://x";\nconst ai = new GoogleGenAI({});\n`,
    (out) => SIDE_EFFECT_LINE.test(out) && !out.includes("GoogleGenAIController") && out.includes("usageMetadata") && out.includes('"image/*"'),
  ],
  [
    "an aliased controller keeps its import",
    `import { GoogleGenAI } from "@google/genai";\n${OLD_CONTROLLER_LINE}\nconst Controller = GoogleGenAIController;\nnew Controller();\n`,
    (out) => out.includes("{ GoogleGenAIController }") && !/^import "@revenium\/middleware\/google\/genai";/m.test(out),
  ],
  [
    "createRequire in an ES module: the middleware require follows the local require definition",
    `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { GoogleGenAI } = require("@google/genai");\n`,
    (out) => {
      const lines = out.split("\n");
      const defined = lines.findIndex((l) => l.startsWith("const require ="));
      const mw = lines.findIndex((l) => l.startsWith('require("@revenium/middleware/google/genai");'));
      return defined >= 0 && mw > defined;
    },
  ],
  [
    "a multi-line require in CommonJS puts the middleware require at the top, outside any expression",
    `const sdk = {\n  genai: require(\n    "@google/genai"\n  ),\n};\n`,
    (out) => /^require\("@revenium\/middleware\/google\/genai"\);/m.test(out) && out.indexOf('require("@revenium') < out.indexOf("const sdk"),
  ],
  [
    "a controller the app actually uses is left alone",
    `import { GoogleGenAI } from "@google/genai";\n${OLD_CONTROLLER_LINE}\nconst c = new GoogleGenAIController();\n`,
    (out) => out.includes("{ GoogleGenAIController }") && !SIDE_EFFECT_LINE.test(out),
  ],
];

for (const [name, source, check] of GEMINI_CASES) {
  if (check(transformNodeGoogleGenAI(source, geminiCtx).content)) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    fail++;
    failures.push(`google transform → ${name}`);
  }
}

function record(section: string, name: string, ok: boolean): void {
  check(section, name, ok);
}

function runChecks(section: string, cases: Array<[name: string, ok: boolean]>) {
  for (const [name, ok] of cases) {
    if (ok) {
      console.log(`  PASS  ${name}`);
      pass++;
    } else {
      console.log(`  FAIL  ${name}`);
      fail++;
      failures.push(`${section} → ${name}`);
    }
  }
}

header(".env writer");

const KEY = "rev_mk_test";
const DEV_URL = "https://api.dev.hcapp.io";
const devVars = meteringEnvVars(KEY, DEV_URL);
const prodVars = meteringEnvVars(KEY, "https://api.revenium.ai/");
const freshDev = mergeEnvContent(null, devVars);
const userEnv = "DATABASE_URL=postgres://x\nexport REVENIUM_METERING_API_KEY=rev_mk_old\nOPENAI_API_KEY=sk-1\n";
const updatedUser = mergeEnvContent(userEnv, devVars);
const staleBaseUrl = mergeEnvContent(`REVENIUM_METERING_API_KEY=${KEY}\nREVENIUM_METERING_BASE_URL=${DEV_URL}\nFOO=bar\n`, prodVars);
const alreadyCurrent = mergeEnvContent(freshDev.content, devVars);
const noTrailingNewline = mergeEnvContent("FOO=bar", devVars);
const duplicateBaseUrls = mergeEnvContent(`REVENIUM_METERING_BASE_URL=${DEV_URL}\nFOO=bar\nREVENIUM_METERING_BASE_URL=https://api.qa.hcapp.io\n`, prodVars);
const duplicateKeys = mergeEnvContent(`REVENIUM_METERING_API_KEY=rev_mk_a\nFOO=bar\nREVENIUM_METERING_API_KEY=rev_mk_b\n`, devVars);
const emptyKey = mergeEnvContent(userEnv, meteringEnvVars("", undefined));
const unverifiedProd = mergeEnvContent(`REVENIUM_METERING_BASE_URL=${DEV_URL}\n`, meteringEnvVars(KEY, undefined, { keyVerified: false }));
const invalidUrl = mergeEnvContent(`REVENIUM_METERING_BASE_URL=${DEV_URL}\n`, meteringEnvVars(KEY, "not a url"));
const envDir = mkdtempSync(join(tmpdir(), "revvy-smoke-env-"));
const envMissing = await writeMeteringEnv(envDir, undefined, undefined);
const envCreated = await writeMeteringEnv(envDir, KEY, DEV_URL);
const envUpdated = await writeMeteringEnv(envDir, "rev_mk_new", DEV_URL);

runChecks(".env writer", [
  ["a non-default base URL is written beside the key", freshDev.content === `# Revenium Metering (added by Revvy)\nREVENIUM_METERING_API_KEY=${KEY}\nREVENIUM_METERING_BASE_URL=${DEV_URL}\n`],
  ["the production URL (with trailing slash) is not written", !mergeEnvContent(null, prodVars).content.includes("BASE_URL")],
  ["a rejected base URL is not written", !buildEnvContent(KEY, "javascript:alert(1)").includes("BASE_URL")],
  ["the dry-run preview carries the dev base URL", buildEnvContent(KEY, DEV_URL).includes(`REVENIUM_METERING_BASE_URL=${DEV_URL}`)],
  ["other variables survive an update", updatedUser.content.includes("DATABASE_URL=postgres://x") && updatedUser.content.includes("OPENAI_API_KEY=sk-1")],
  ["an existing key line is replaced in place, keeping export", updatedUser.content.includes(`export REVENIUM_METERING_API_KEY=${KEY}\nOPENAI_API_KEY`) && !updatedUser.content.includes("rev_mk_old")],
  ["a missing base URL is appended", updatedUser.content.endsWith(`REVENIUM_METERING_BASE_URL=${DEV_URL}\n`)],
  ["a stale base URL is removed when the run targets production", !staleBaseUrl.content.includes("BASE_URL") && staleBaseUrl.content.includes("FOO=bar") && staleBaseUrl.changes.some((c) => c.action === "removed" && c.key === "REVENIUM_METERING_BASE_URL")],
  ["every duplicate base URL is removed when the run targets production", !duplicateBaseUrls.content.includes("BASE_URL") && duplicateBaseUrls.content.startsWith("FOO=bar\n")],
  ["duplicate key lines collapse to one line holding the new key", duplicateKeys.content.startsWith(`REVENIUM_METERING_API_KEY=${KEY}\nFOO=bar\n`) && !duplicateKeys.content.includes("rev_mk_b")],
  ["an unverified production run keeps an existing base URL", unverifiedProd.content.includes(DEV_URL) && !unverifiedProd.changes.some((c) => c.key === "REVENIUM_METERING_BASE_URL")],
  ["an invalid base URL keeps an existing base URL", invalidUrl.content.includes(DEV_URL) && !invalidUrl.changes.some((c) => c.key === "REVENIUM_METERING_BASE_URL")],
  ["an up-to-date .env reports no changes", alreadyCurrent.changes.length === 0 && alreadyCurrent.content === freshDev.content],
  ["appending to a file without a trailing newline keeps the last line intact", noTrailingNewline.content.startsWith("FOO=bar\n\n# Revenium")],
  ["an empty API key leaves the existing key alone", emptyKey.content.includes("export REVENIUM_METERING_API_KEY=rev_mk_old") && !emptyKey.changes.some((c) => c.key === "REVENIUM_METERING_API_KEY")],
  ["a write with nothing to set does not report .env as created", !envMissing.created && envMissing.changes.length === 0],
  ["a first write creates .env without a backup", envCreated.created && !envCreated.backupFile],
  ["the .env backup is no more readable than .env", (statSync(join(envDir, ".env.revvy-backup")).mode & 0o777) === (statSync(join(envDir, ".env")).mode & 0o777)],
  ["changing an existing .env backs it up first", !envUpdated.created && envUpdated.backupFile === ".env.revvy-backup"
    && readFileSync(join(envDir, ".env.revvy-backup"), "utf-8").includes(`REVENIUM_METERING_API_KEY=${KEY}`)
    && readFileSync(join(envDir, ".env"), "utf-8").includes("REVENIUM_METERING_API_KEY=rev_mk_new")],
  ["the preview block keeps a placeholder when no key is given", buildEnvContent("").includes("REVENIUM_METERING_API_KEY=your_api_key_here")],
]);

header(".gitignore update");

runChecks(".gitignore update", [
  ["no .gitignore → both entries missing", missingIgnoreEntries(null, REVVY_IGNORED_ENTRIES).length === 2],
  ["exact entries cover both", missingIgnoreEntries(".env\n*.revvy-backup\n", REVVY_IGNORED_ENTRIES).length === 0],
  [".env* covers .env", missingIgnoreEntries(".env*\n", [".env"]).length === 0],
  ["a root-anchored pattern does not count as covering every directory", missingIgnoreEntries("/.env\n/*.revvy-backup\n", REVVY_IGNORED_ENTRIES).length === 2],
  ["an anchored negation still un-ignores", missingIgnoreEntries(".env\n!/.env\n", [".env"]).length === 1],
  ["**/.env covers .env", missingIgnoreEntries("**/.env\n", [".env"]).length === 0],
  [".env.local does not cover .env", missingIgnoreEntries(".env.local\n", [".env"]).length === 1],
  ["a later negation un-ignores .env", missingIgnoreEntries(".env*\n!.env\n", [".env"]).length === 1],
  ["a comment or a nested path does not count", missingIgnoreEntries("# .env\nconfig/.env\n", [".env"]).length === 1],
  ["a broader backup glob covers *.revvy-backup", missingIgnoreEntries("*-backup\n", ["*.revvy-backup"]).length === 0],
  ["an exception for a concrete backup name means backups are not covered", missingIgnoreEntries(".env\n*.revvy-backup\n!/.env.revvy-backup\n", REVVY_IGNORED_ENTRIES).includes("*.revvy-backup")],
  ["appending keeps existing content and adds a labelled block", appendIgnoreEntries("node_modules", [".env"]) === "node_modules\n\n# Revenium (added by Revvy)\n.env\n"],
  ["a fresh .gitignore holds only the block", appendIgnoreEntries(null, [".env", "*.revvy-backup"]) === "# Revenium (added by Revvy)\n.env\n*.revvy-backup\n"],
]);

header("Generated-file writes");

const genDir = mkdtempSync(join(tmpdir(), "revvy-smoke-"));
const created = await writeGeneratedFile(genDir, "src/revenium-config.ts", "v1\n");
const unchanged = await writeGeneratedFile(genDir, "src/revenium-config.ts", "v1\n");
writeFileSync(join(genDir, "src/revenium-config.ts"), "v1\n// my edit\n");
const updated = await writeGeneratedFile(genDir, "src/revenium-config.ts", "v1\n");
const helperAfterUpdate = readFileSync(join(genDir, "src/revenium-config.ts"), "utf-8");
const updatedAgain = await writeGeneratedFile(genDir, "src/revenium-config.ts", "v2\n");
writeFileSync(join(genDir, "src/revenium-config.ts"), "v1\n// my edit\n");
const sameEditAgain = await writeGeneratedFile(genDir, "src/revenium-config.ts", "v2\n");
const groupResult = (outcome: GeneratedFileResult["outcome"]): GeneratedFileResult => ({ file: "f", outcome });

runChecks("generated-file writes", [
  ["missing file → created", planGeneratedWrite(null, "x") === "created"],
  ["identical content → unchanged", planGeneratedWrite("x", "x") === "unchanged"],
  ["different content → updated", planGeneratedWrite("x", "y") === "updated"],
  ["first write creates the file and its directory", created.outcome === "created" && !created.backupFile],
  ["a re-run with the same content is unchanged and leaves no backup", unchanged.outcome === "unchanged" && !unchanged.backupFile],
  ["an edited helper is backed up before it is replaced", updated.outcome === "updated" && updated.backupFile === "src/revenium-config.ts.revvy-backup"
    && readFileSync(join(genDir, "src/revenium-config.ts.revvy-backup"), "utf-8").includes("// my edit")
    && helperAfterUpdate === "v1\n"],
  ["a later update keeps the earlier backup and saves to the next free name", updatedAgain.backupFile === "src/revenium-config.ts.1.revvy-backup"
    && readFileSync(join(genDir, "src/revenium-config.ts.revvy-backup"), "utf-8").includes("// my edit")
    && readFileSync(join(genDir, "src/revenium-config.ts.1.revvy-backup"), "utf-8") === "v1\n"],
  ["content already held by a backup reuses it instead of adding another", sameEditAgain.backupFile === "src/revenium-config.ts.revvy-backup"],
  ["a created + unchanged group is not reported as Updated", describeGeneratedGroup("rules", [groupResult("created"), groupResult("unchanged")]) === "Wrote rules (1 created, 1 unchanged)"],
  ["a uniform group uses its single verb", describeGeneratedGroup("rules", [groupResult("unchanged"), groupResult("unchanged")]) === "Unchanged rules"],
]);

header("Modified-files manifest");

const envRewrite = buildModifiedFilesManifest({
  instrumentResult: { filesModified: 0, totalChanges: 0, changes: [] } as unknown as Parameters<typeof buildModifiedFilesManifest>[0]["instrumentResult"],
  language: "node",
  envCreated: false,
  envWrite: { content: "", created: false, changes: [{ action: "updated", key: "REVENIUM_METERING_API_KEY" }, { action: "removed", key: "REVENIUM_METERING_BASE_URL" }], backupFile: ".env.revvy-backup" },
});
runChecks("modified-files manifest", [
  ["an in-place .env rewrite is recorded with its changes and backup", JSON.stringify(envRewrite.modifiedFiles) === JSON.stringify([{ file: ".env", changes: ["Updated REVENIUM_METERING_API_KEY", "Removed REVENIUM_METERING_BASE_URL", "Previous version saved to .env.revvy-backup"] }])],
]);

header("Nothing to set up");

runChecks("nothing to set up", [
  ["no call sites → nothing to set up", hasNothingToSetUp(makeScanResult({ callSites: [], providers: [] }))],
  ["SDK dependency but no call sites → nothing to set up", hasNothingToSetUp(makeScanResult({ callSites: [] }))],
  ["a call site → something to set up", !hasNothingToSetUp(makeScanResult({
    callSites: [{ filePath: "src/a.ts", lineNumber: 1, provider: "openai", method: "chat.completions.create", operationType: "chat", snippet: "" } as CallSite],
  }))],
]);
function check(section: string, name: string, ok: boolean): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    fail++;
    failures.push(`${section} → ${name}`);
  }
}

header("Node client-wrapper transforms (OpenAI, Perplexity)");

const wrapperCtx = { design: GEMINI_DESIGN, filePath: "src/routes/summarize.ts" };
const RAW_OPENAI = `import OpenAI from "openai";\n\nconst openai = new OpenAI();\n\nexport async function run() {\n  return openai.chat.completions.create({ model: "gpt-4o-mini", messages: [] });\n}\n`;
const LEGACY_OPENAI_IMPORT = `import { Initialize as InitializeRevenium, GetClient as GetReveniumOpenAI } from "@revenium/middleware/openai";`;
const codeLines = (out: string) => out.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const lineBefore = (out: string, marker: string) => {
  const lines = out.split("\n");
  return lines[lines.findIndex((l) => l.includes(marker)) - 1] ?? "";
};
const WRAPPER_CASES: Array<[name: string, run: () => boolean]> = [
  [
    "OpenAI: no import, no Initialize(), nothing for noUnusedLocals to reject",
    () => {
      const code = codeLines(transformNodeOpenAI(RAW_OPENAI, wrapperCtx).content);
      return !code.includes("@revenium/middleware") && !code.includes("Initialize") && !code.includes("GetClient");
    },
  ],
  [
    "OpenAI: a TODO(revenium) sits right above `new OpenAI()` and names the helper relative to the file",
    () => {
      const out = transformNodeOpenAI(RAW_OPENAI, wrapperCtx).content;
      const todoStart = out.split("\n").findIndex((l) => l.startsWith("// TODO(revenium): this OpenAI client is not metered"));
      return todoStart >= 0 && lineBefore(out, "const openai = new OpenAI();").startsWith("//") &&
        out.includes(`import { openai } from "../revenium-config.js"`) && out.includes("openai.chat().completions().create(params, metadata)");
    },
  ],
  [
    "OpenAI: the wrapped-client reference block is added, also after another provider's block names the helper",
    () => {
      const withAnthropic = `import Anthropic from "@anthropic-ai/sdk";\n${RAW_OPENAI}`;
      const out = transformNodeOpenAI(transformNodeAnthropic(withAnthropic, wrapperCtx).content, wrapperCtx).content;
      return out.includes("Usage with Revenium OpenAI middleware") && transformNodeOpenAI(RAW_OPENAI, wrapperCtx).content.includes("Usage with Revenium OpenAI middleware");
    },
  ],
  [
    "OpenAI: a helper import that only appears in a comment does not drop an earlier release's Initialize()",
    () => {
      const src = `import OpenAI from "openai";\n${LEGACY_OPENAI_IMPORT}\nInitializeRevenium();\n//        import { createUsageMetadata } from "./revenium-config.js";\nconst openai = new OpenAI();\n`;
      return transformNodeOpenAI(src, wrapperCtx).content.includes("\nInitializeRevenium();\n");
    },
  ],
  [
    "OpenAI: a second run changes nothing",
    () => {
      const once = transformNodeOpenAI(RAW_OPENAI, wrapperCtx).content;
      return !transformNodeOpenAI(once, wrapperCtx).modified;
    },
  ],
  [
    "OpenAI: an aliased default import and AzureOpenAI are both marked, each once",
    () => {
      const src = `import Client, { AzureOpenAI } from "openai";\nconst a = new Client();\nconst b = new AzureOpenAI({});\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return (out.match(/^\s*\/\/ TODO\(revenium\):/gm) ?? []).length === 2;
    },
  ],
  [
    "OpenAI: an already-refactored file (wrapped client from the helper) is left alone",
    () => {
      const src = `import { openai } from "../revenium-config.js";\nexport const run = () => openai.chat().completions().create({ model: "m", messages: [] }, {});\n`;
      return !transformNodeOpenAI(src, wrapperCtx).modified;
    },
  ],
  [
    "OpenAI: an earlier release's import loses the unused GetClient binding, keeps Initialize",
    () => {
      const src = `import OpenAI from "openai";\n${LEGACY_OPENAI_IMPORT}\nInitializeRevenium();\nconst openai = new OpenAI();\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return out.includes(`import { Initialize as InitializeRevenium } from "@revenium/middleware/openai";`) &&
        !out.includes("GetReveniumOpenAI") && out.includes("InitializeRevenium();");
    },
  ],
  [
    "OpenAI: with the helper imported, the earlier release's second Initialize() goes too",
    () => {
      const src = `${LEGACY_OPENAI_IMPORT}\nimport { openai } from "./revenium-config.js";\nInitializeRevenium();\nexport const run = () => openai.chat().completions().create({ model: "m", messages: [] }, {});\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return !out.includes("@revenium/middleware/openai") && !out.includes("InitializeRevenium");
    },
  ],
  [
    "OpenAI: a type-only helper import does not count, so the only Initialize() stays",
    () => {
      const typeOnly = [
        `import type { UsageMetadataContext } from "./revenium-config.js";`,
        `import { type UsageMetadataContext } from "./revenium-config.js";`,
      ];
      return typeOnly.every((helperImport) => {
        const src = `${LEGACY_OPENAI_IMPORT}\n${helperImport}\nInitializeRevenium();\nconst client = GetReveniumOpenAI();\nexport const run = (m: UsageMetadataContext) => client.chat().completions().create({ model: "m", messages: [] }, m);\n`;
        return transformNodeOpenAI(src, wrapperCtx).content.includes("\nInitializeRevenium();\n");
      });
    },
  ],
  [
    "Perplexity: same treatment, pointing at GetClient() from its own middleware (the helper exports no perplexity client)",
    () => {
      const src = `import OpenAI from "openai";\nconst client = new OpenAI({ baseURL: "https://api.perplexity.ai" });\n`;
      const out = transformNodePerplexity(src, wrapperCtx).content;
      return !codeLines(out).includes("@revenium/middleware") && !out.includes("import { perplexity }") &&
        out.includes(`import { Initialize, GetClient } from "@revenium/middleware/perplexity";`) &&
        lineBefore(out, "const client = new OpenAI(").startsWith("//");
    },
  ],
  [
    "a prompt string that mentions `new OpenAI(` is left byte-for-byte unchanged",
    () => {
      const prompt = "const prompt = `Explain this code:\nconst c = new OpenAI();\nthen summarize`;";
      const out = transformNodeOpenAI(`import OpenAI from "openai";\n${prompt}\nconst openai = new OpenAI();\n`, wrapperCtx).content;
      return out.includes(prompt) && (out.match(/^\s*\/\/ TODO\(revenium\):/gm) ?? []).length === 1;
    },
  ],
  [
    "named-alias and require() constructions are marked",
    () => {
      const named = transformNodeOpenAI(`import { OpenAI as Client } from "openai";\nconst c = new Client();\n`, wrapperCtx).content;
      const required = transformNodeOpenAI(`const OpenAI = require("openai");\nconst c = new OpenAI.OpenAI();\nconst d = new OpenAI();\n`, wrapperCtx).content;
      return lineBefore(named, "const c = new Client();").startsWith("//") &&
        (required.match(/^\s*\/\/ TODO\(revenium\):/gm) ?? []).length === 2;
    },
  ],
  [
    "a construction inside JSX gets its TODO above the statement, not in rendered text",
    () => {
      const src = `import OpenAI from "openai";\nexport const App = () => (\n  <div>\n    <Chat client={new OpenAI()} />\n  </div>\n);\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return lineBefore(out, "export const App = () => (").startsWith("//") && out.includes("  <div>\n    <Chat client={new OpenAI()} />");
    },
  ],
  [
    "OpenAI and Perplexity clients in one file each get their own TODO",
    () => {
      const src = `import OpenAI from "openai";\nconst gpt = new OpenAI();\nconst pplx = new OpenAI({ baseURL: "https://api.perplexity.ai" });\n`;
      const out = transformNodePerplexity(src, wrapperCtx).content;
      const gptTodo = out.split("const gpt =")[0]!.split("\n").reverse().find((l) => l.includes("TODO(revenium)")) ?? "";
      const pplxBlock = out.split("const pplx =")[0]!.split("const gpt =")[1] ?? "";
      return gptTodo.includes("OpenAI client") && pplxBlock.includes("Perplexity client") &&
        pplxBlock.includes(`from "@revenium/middleware/perplexity"`) && !pplxBlock.includes("perplexity.embeddings()");
    },
  ],
  [
    "a Prettier-formatted earlier-release import with single quotes is still cleaned up",
    () => {
      const src = `import OpenAI from 'openai';\nimport {\n  Initialize as InitializeRevenium,\n  GetClient as GetReveniumOpenAI,\n} from '@revenium/middleware/openai';\nInitializeRevenium();\nconst openai = new OpenAI();\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return out.includes(`import { Initialize as InitializeRevenium } from '@revenium/middleware/openai';`) && !out.includes("GetReveniumOpenAI");
    },
  ],
  [
    "removing an earlier release's unused import still leaves the usage reference",
    () => {
      const src = `${LEGACY_OPENAI_IMPORT}\nexport const x = 1;\n`;
      const out = transformNodeOpenAI(src, wrapperCtx).content;
      return !out.includes("@revenium/middleware/openai\";") && out.includes("Usage with Revenium OpenAI middleware");
    },
  ],
  [
    "a file that does not parse is left unchanged",
    () => !transformNodeOpenAI(`import OpenAI from "openai";\nconst openai = new OpenAI(;\n`, wrapperCtx).modified,
  ],
];
for (const [name, run] of WRAPPER_CASES) record("node wrapper transform", name, run());

header("Python transforms");

const pyCtx = { design: GEMINI_DESIGN, filePath: "app/main.py" };
const RAW_PY = `import openai\nimport anthropic\n\nclient = openai.OpenAI()\n\n\nclass Request:\n    text: str\n\n\ndef handler():\n    return client.chat.completions.create(model="m", messages=[])\n`;
const index = (out: string, needle: string) => out.indexOf(needle);
const PY_CASES: Array<[name: string, run: () => boolean]> = [
  [
    "PEP 8: the two blank lines before a top-level class and def survive",
    () => {
      const out = transformPythonOpenAI(RAW_PY, pyCtx).content;
      return out.includes("\n\n\nclass Request:") && out.includes("\n\n\ndef handler():");
    },
  ],
  [
    ".env is loaded before the first middleware import",
    () => {
      const out = transformPythonOpenAI(RAW_PY, pyCtx).content;
      return index(out, "load_dotenv()") > 0 && index(out, "load_dotenv()") < index(out, "import revenium_middleware.openai");
    },
  ],
  [
    "a second provider's import lands after the one .env bootstrap",
    () => {
      const out = transformPythonAnthropic(transformPythonOpenAI(RAW_PY, pyCtx).content, pyCtx).content;
      return (out.match(/load_dotenv\(\)/g) ?? []).length === 1 &&
        index(out, "import revenium_middleware.anthropic") > index(out, "load_dotenv()");
    },
  ],
  [
    "a file an earlier release instrumented gets the .env bootstrap on rerun",
    () => {
      const src = `import openai\nimport revenium_middleware.openai  # Revenium: auto-patches OpenAI SDK on import\n\nclient = openai.OpenAI()\n`;
      const result = transformPythonOpenAI(src, pyCtx);
      return result.modified && index(result.content, "load_dotenv()") < index(result.content, "import revenium_middleware.openai");
    },
  ],
  [
    "a file that already loads .env before the middleware import is left alone",
    () => {
      const src = `from dotenv import load_dotenv\nload_dotenv()\nimport revenium_middleware.openai\nimport openai\n\nclient = openai.OpenAI()\n`;
      return !transformPythonOpenAI(src, pyCtx).modified;
    },
  ],
  [
    "a load_dotenv() the app runs after revvy's import still gets the bootstrap ahead of it",
    () => {
      const src = `import openai\nfrom dotenv import load_dotenv\n\nload_dotenv()\nclient = openai.OpenAI()\n`;
      const out = transformPythonOpenAI(src, pyCtx).content;
      const bootstrap = index(out, "    load_dotenv()");
      return bootstrap >= 0 && bootstrap < index(out, "import revenium_middleware.openai");
    },
  ],
  [
    "a load_dotenv() inside a function does not stand in for the bootstrap",
    () => {
      const src = `from dotenv import load_dotenv\n\n\ndef configure():\n    load_dotenv()\n\n\nimport revenium_middleware.openai\nimport openai\n`;
      const out = transformPythonOpenAI(src, pyCtx).content;
      const bootstrap = index(out, "try:  # Revenium");
      return bootstrap >= 0 && bootstrap < index(out, "import revenium_middleware.openai");
    },
  ],
  [
    "a commented-out middleware import is not taken as instrumented",
    () => {
      const src = `import openai\n# import revenium_middleware.openai\n\nclient = openai.OpenAI()\n`;
      return /^import revenium_middleware\.openai/m.test(transformPythonOpenAI(src, pyCtx).content);
    },
  ],
  [
    "a second run changes nothing",
    () => !transformPythonOpenAI(transformPythonOpenAI(RAW_PY, pyCtx).content, pyCtx).modified,
  ],
];
for (const [name, run] of PY_CASES) record("python transform", name, run());

header("revvy check: what counts as metered");

async function checkFixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "revvy-smoke-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  try {
    return await runCheck(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NODE_PKG = JSON.stringify({ dependencies: { openai: "^5.0.0", "@revenium/middleware": "^2.1.0" } });
const NODE_HELPER = `import { Initialize, GetClient } from "@revenium/middleware/openai";\nInitialize();\nexport const openai = GetClient();\n`;
const PY_REQS = "openai\nrevenium-python-sdk[openai]\n";
const PY_HELPER = `import revenium_middleware.openai  # noqa: F401  — auto-patches OpenAI SDK on import\n`;
const PY_RAW_CALL = `import openai\n\nclient = openai.OpenAI()\n\n\ndef run():\n    return client.chat.completions.create(model="m", messages=[])\n`;

const CHECK_CASES: Array<[name: string, files: Record<string, string>, expect: (r: Awaited<ReturnType<typeof runCheck>>) => boolean]> = [
  [
    "Node: a raw OpenAI client is not metered even with the middleware imported in the file",
    {
      "package.json": NODE_PKG,
      "src/chat.ts": `import OpenAI from "openai";\nimport { Initialize } from "@revenium/middleware/openai";\nInitialize();\nconst c = new OpenAI();\nexport const run = () => c.chat.completions.create({ model: "m", messages: [] });\n`,
    },
    (r) => !r.passed && r.unwrapped.length === 1 && r.unwrapped[0]!.reason === "provider-sdk-client",
  ],
  [
    "Node: a raw embeddings call is not metered",
    {
      "package.json": NODE_PKG,
      "src/revenium-config.ts": NODE_HELPER,
      "src/embed.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.embeddings.create({ model: "m", input: "x" });\n`,
    },
    (r) => !r.passed && r.unwrapped[0]?.reason === "provider-sdk-client",
  ],
  [
    "Node: calls on the helper's wrapped client are metered",
    {
      "package.json": NODE_PKG,
      "src/revenium-config.ts": NODE_HELPER,
      "src/chat.ts": `import { openai } from "./revenium-config.js";\nexport const a = () => openai.chat().completions().create({ model: "m", messages: [] }, {});\nexport const b = () => openai.embeddings().create({ model: "m", input: "x" }, {});\n`,
    },
    (r) => r.passed && r.wrappedCount === 2,
  ],
  [
    "Python: a middleware import only in the never-imported revenium_config.py meters nothing",
    { "requirements.txt": PY_REQS, "revenium_config.py": PY_HELPER, "app/worker.py": PY_RAW_CALL },
    (r) => !r.passed && r.unwrapped.length === 1 && r.unwrapped[0]!.suggestion.includes("no module imports revenium_config"),
  ],
  [
    "Python: importing revenium_config anywhere activates its patch for every file",
    {
      "requirements.txt": PY_REQS,
      "revenium_config.py": PY_HELPER,
      "app/main.py": "import revenium_config  # noqa: F401\n",
      "app/worker.py": PY_RAW_CALL,
    },
    (r) => r.passed && r.wrappedCount === 1,
  ],
  [
    "Python: one direct middleware import covers a raw call in another module (process-wide)",
    {
      "requirements.txt": PY_REQS,
      "app/main.py": "import revenium_middleware.openai  # Revenium: auto-patches OpenAI SDK on import\n",
      "app/worker.py": PY_RAW_CALL,
    },
    (r) => r.passed,
  ],
  [
    "Node: without @revenium/middleware installed, a raw client is told to install it",
    {
      "package.json": JSON.stringify({ dependencies: { openai: "^5.0.0" } }),
      "src/chat.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.chat.completions.create({ model: "m", messages: [] });\n`,
    },
    (r) => !r.passed && r.unwrapped[0]?.reason === "no-middleware" && r.unwrapped[0].suggestion.startsWith("Install @revenium/middleware"),
  ],
  [
    "Node: an endpoint the wrapped client lacks is reported as not meterable, not as a refactor",
    {
      "package.json": NODE_PKG,
      "src/revenium-config.ts": NODE_HELPER,
      "src/mod.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.moderations.create({ input: "x" });\n`,
    },
    (r) => !r.passed && r.unwrapped[0]?.reason === "no-wrapped-equivalent",
  ],
  [
    "Python: the legacy revenium_middleware_litellm package counts for LiteLLM",
    {
      "requirements.txt": "litellm\nrevenium-python-sdk[litellm]\n",
      "app/main.py": `import revenium_middleware_litellm\nimport litellm\n\n\ndef run():\n    return litellm.completion(model="m", messages=[])\n`,
    },
    (r) => r.passed && r.totalCallSites === 1,
  ],
  [
    "Python: the Perplexity middleware covers a client pointed at Perplexity, not a plain OpenAI one",
    {
      "requirements.txt": "openai\nrevenium-python-sdk[perplexity]\n",
      "app/main.py": `import revenium_middleware.perplexity\nfrom openai import OpenAI\n\npplx = OpenAI(base_url="https://api.perplexity.ai")\ngpt = OpenAI()\n\n\ndef run():\n    a = pplx.chat.completions.create(model="sonar", messages=[])\n    b = gpt.chat.completions.create(model="m", messages=[])\n    return a, b\n`,
    },
    (r) => !r.passed && r.wrappedCount === 1 && r.unwrapped.length === 1 && r.unwrapped[0]!.snippet.startsWith("b = gpt."),
  ],
  [
    "Python: a middleware import that is commented out does not count",
    { "requirements.txt": PY_REQS, "app/worker.py": `# import revenium_middleware.openai\n${PY_RAW_CALL}` },
    (r) => !r.passed && r.unwrapped[0]?.reason === "no-middleware",
  ],
];

for (const [name, files, expect] of CHECK_CASES) {
  record("revvy check", name, expect(await checkFixture(files)));
}

header("Closing metering summary");

const rawNode = await checkFixture({
  "package.json": NODE_PKG,
  "src/revenium-config.ts": NODE_HELPER,
  "src/chat.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.chat.completions.create({ model: "m", messages: [] });\n`,
});
const rawSummary = describeMeteringStatus(rawNode, false).map((l) => l.text).join("\n");
record("summary", "a raw-client Node project is told metering is NOT active and where to refactor",
  rawSummary.includes("NOT active") && rawSummary.includes("src/chat.ts:3") && rawSummary.includes("TODO(revenium)") && !rawSummary.includes("no automatic transform"));
const meteredPython = await checkFixture({ "requirements.txt": PY_REQS, "app/main.py": `import revenium_middleware.openai\n${PY_RAW_CALL}` });
record("summary", "an already-instrumented Python project is reported as metered",
  describeMeteringStatus(meteredPython, false)[0]!.text.includes("Basic metering active"));
const brokenNode = await checkFixture({
  "package.json": NODE_PKG,
  "src/revenium-config.ts": NODE_HELPER,
  "src/chat.ts": `import { openai } from "./revenium-config.js";\nexport const run = () => openai.chat().completions().create({ model: "m" }, {}\n`,
  "revenium-call-sites.json": JSON.stringify({ callSites: [{ file: "src/chat.ts" }] }),
});
const brokenSummary = describeMeteringStatus(brokenNode, false).map((l) => l.text).join("\n");
record("summary", "a file that no longer parses never yields 'Basic metering active'",
  !brokenNode.passed && !brokenSummary.includes("Basic metering active") && brokenSummary.includes("src/chat.ts (does not parse)"));
const noCalls = await checkFixture({ "package.json": NODE_PKG, "src/index.ts": "export const x = 1;\n" });
record("summary", "a project with no AI calls is told nothing is metered",
  describeMeteringStatus(noCalls, false)[0]!.text.includes("Nothing is being metered"));
const ignored = await checkFixture({
  "package.json": NODE_PKG,
  ".reveniumrc": JSON.stringify({ ignore: ["src/legacy.ts"] }),
  "src/revenium-config.ts": NODE_HELPER,
  "src/chat.ts": `import { openai } from "./revenium-config.js";\nexport const run = () => openai.chat().completions().create({ model: "m", messages: [] }, {});\n`,
  "src/legacy.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.chat.completions.create({ model: "m", messages: [] });\n`,
});
const ignoredSummary = describeMeteringStatus(ignored, false).map((l) => l.text).join("\n");
const allExcluded = await checkFixture({
  "package.json": NODE_PKG,
  ".reveniumrc": JSON.stringify({ skipProviders: ["openai"] }),
  "src/revenium-config.ts": NODE_HELPER,
  "src/chat.ts": `import OpenAI from "openai";\nconst c = new OpenAI();\nexport const run = () => c.chat.completions.create({ model: "m", messages: [] });\n`,
});
record("summary", "a project whose every call is excluded by .reveniumrc is not called metered",
  describeMeteringStatus(allExcluded, false)[0]!.text.includes("Nothing is being metered"));
record("summary", "calls excluded by .reveniumrc are not counted as metered",
  ignored.excludedCount === 1 && ignoredSummary.includes("1 AI call go") && ignoredSummary.includes("1 call excluded by .reveniumrc"));
header("Generated helpers carry job type, job version and environment");

const HELPER_DESIGN = simulateConsultation(SCENARIOS[0]!.scanResult, SCENARIOS[0]!.answers).design;
const helperFor = (language: "node" | "python" | "go") =>
  renderConfigHelper({ ...HELPER_DESIGN, detectedLanguage: language });
const nodeHelper = helperFor("node");
const pythonHelper = helperFor("python");
const goHelper = helperFor("go");
const HELPER_CASES: Array<[name: string, ok: boolean]> = [
  ["Node maps agenticJobType", /agenticJobType\?: string;/.test(nodeHelper) && nodeHelper.includes("agenticJobType: context.agenticJobType")],
  ["Node maps agenticJobVersion", nodeHelper.includes("agenticJobVersion: context.agenticJobVersion")],
  ["Node maps environment", nodeHelper.includes("environment: context.environment")],
  ["Node per-agent factories accept the same context", nodeHelper.includes('Omit<UsageMetadataContext, "agent">')],
  ["Python sends agentic_job_type", pythonHelper.includes('metadata["agentic_job_type"] = agentic_job_type')],
  ["Python sends agentic_job_version", pythonHelper.includes('metadata["agentic_job_version"] = agentic_job_version')],
  ["Python sends environment", pythonHelper.includes('metadata["environment"] = environment')],
  ["Python adds the new keywords after the existing ones", pythonHelper.indexOf("subagent_type: Optional") < pythonHelper.indexOf("agentic_job_type: Optional")],
  ["Go sets agenticJobType", goHelper.includes('set("agenticJobType", c.AgenticJobType)')],
  ["Go sets agenticJobVersion", goHelper.includes('set("agenticJobVersion", c.AgenticJobVersion)')],
  ["Go sets environment", goHelper.includes('set("environment", c.Environment)')],
  ["Go declares the constants snippets reference", goHelper.includes('ProductSmartSearch = "Smart Search"') && goHelper.includes('AgentSupportBot = "support-bot"')],
];
for (const [name, ok] of HELPER_CASES) check("helpers", name, ok);

header("Call-site manifest snippets");

const snippetFor = (language: "node" | "python" | "go", filePath: string, agentNames = "support-bot", productNames = "Smart Search") => {
  const design = buildDesignFromArgs(
    { customerIdExpression: "orgID", productNames, agentNames },
    makeScanResult({ language }),
  );
  const site: CallSite = { filePath, lineNumber: 1, provider: "openai", method: "Chat().Completions().New", operationType: "chat", snippet: "" };
  return buildCallSiteManifest(makeScanResult({ language, callSites: [site] }), design).callSites[0]!;
};
const nodeSite = snippetFor("node", "src/routes/summarize.ts");
const pythonSite = snippetFor("python", "app/main.py");
const goSite = snippetFor("go", "main.go");
const unmatchedSite = snippetFor("node", "src/routes/summarize.ts", "billing-bot, research-agent");
const SNIPPET_CASES: Array<[name: string, ok: boolean]> = [
  ["Node snippet carries product and agent", nodeSite.usageMetadataSnippet === 'createUsageMetadata({ customerId: orgID, product: "Smart Search", agent: "support-bot", taskType: "chat" })'],
  ["Python snippet carries product and agent", pythonSite.usageMetadataSnippet === 'create_usage_metadata(customer_id=orgID, product="Smart Search", agent="support-bot", task_type="chat")'],
  ["Go snippet is Go against the generated helper", goSite.usageMetadataSnippet === 'revenium.WithUsageMetadata(ctx, revenium.Context{CustomerID: orgID, Product: revenium.ProductSmartSearch, Agent: revenium.AgentSupportBot, TaskType: "chat"})'],
  ["an unmatched agent stays out of the snippet and is offered for confirmation", !unmatchedSite.usageMetadataSnippet.includes("agent:") && unmatchedSite.unconfirmedAgent === "billing-bot"],
  ["an upper-case product name stays a Node string literal", snippetFor("node", "src/a.ts", "support-bot", "CRM").usageMetadataSnippet.includes('product: "CRM"')],
  ["an upper-case agent name stays a Python string literal", snippetFor("python", "app/a.py", "SUPPORT_BOT").usageMetadataSnippet.includes('agent="SUPPORT_BOT"')],
  ["a product given as code stays code", snippetFor("node", "src/a.ts", "support-bot", "req.body.productName").usageMetadataSnippet.includes("product: req.body.productName")],
];
for (const [name, ok] of SNIPPET_CASES) check("snippets", name, ok);

header("Helper import path from the instrumented file");

const IMPORT_CASES: Array<[from: string, expected: string]> = [
  ["src/server.ts", "./revenium-config.js"],
  ["src/routes/summarize.ts", "../revenium-config.js"],
  ["index.ts", "./src/revenium-config.js"],
];
for (const [from, expected] of IMPORT_CASES) {
  check("import path", `${from} imports ${expected}`, nodeHelperImportSpecifier(from) === expected);
}
check(
  "import path",
  "the in-file comment of a nested file names the relative import",
  buildNodeCommentBlock(HELPER_DESIGN, "openai", "src/routes/summarize.ts").includes('from "../revenium-config.js"'),
);
check(
  "import path",
  "the in-file comment of an api-key project passes apiKey, as the helper requires",
  buildNodeCommentBlock({ ...HELPER_DESIGN, organization: { ...HELPER_DESIGN.organization, source: "api-key" } }, "openai", "src/a.ts").includes("createUsageMetadata({ apiKey: ..."),
);
check(
  "import path",
  "editor rules name the helper's location instead of a fixed ./ path",
  getEditorRules("node", ["OpenAI"]).includes("`src/revenium-config.ts`") && !getEditorRules("node", ["OpenAI"]).includes('from "./revenium-config.js"'),
);

header("Go check recognises metadata carried on the context");

const GO_SOURCE = `package main

func withMeta(client *reveniumopenai.ReveniumOpenAI) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := revenium.WithUsageMetadata(r.Context(), revenium.Context{
			CustomerID: orgID,
		})
		resp, err := client.Chat().Completions().New(ctx, openai.ChatCompletionNewParams{})
		_ = resp
	}
}

func inline(ctx context.Context) {
	client.Chat().Completions().New(core.WithUsageMetadata(ctx, map[string]interface{}{"organizationName": "a"}), params)
}

func without(ctx context.Context) {
	client.Chat().Completions().New(ctx, params)
}

func comparedOnly(ctx context.Context) {
	if ctx == revenium.WithUsageMetadata(nil, revenium.Context{}) {
	}
	client.Chat().Completions().New(ctx, params)
}
`;
const goCallAt = (lineNumber: number): CallSite => ({ filePath: "main.go", lineNumber, provider: "openai", method: "Chat().Completions().New", operationType: "chat", snippet: "" });
const GO_LINES = GO_SOURCE.split("\n");
const lineOf = (fn: string) => GO_LINES.findIndex((l, i) => l.includes("Completions().New(") && GO_LINES.slice(0, i).reverse().find((x) => x.startsWith("func "))?.includes(fn)) + 1;
/** Checks the call on the line marked `// target` in a single-function Go source. */
const goTarget = (body: string): boolean => {
  const source = `package main\n\n${body}\n`;
  const line = source.split("\n").findIndex((l) => l.includes("// target")) + 1;
  return goCallCarriesUsageMetadata(source, goCallAt(line));
};
const GO_CHECK_CASES: Array<[name: string, ok: boolean]> = [
  ["ctx assigned from revenium.WithUsageMetadata in the enclosing function", goCallCarriesUsageMetadata(GO_SOURCE, goCallAt(lineOf("withMeta")))],
  ["core.WithUsageMetadata passed inline as ctx", goCallCarriesUsageMetadata(GO_SOURCE, goCallAt(lineOf("inline")))],
  ["a plain ctx is still reported", !goCallCarriesUsageMetadata(GO_SOURCE, goCallAt(lineOf("without")))],
  ["a comparison is not an assignment", !goCallCarriesUsageMetadata(GO_SOURCE, goCallAt(lineOf("comparedOnly")))],
  [
    "an apostrophe in a comment inside the call does not hide the metadata",
    goTarget(`func f(r *http.Request) {
	ctx := revenium.WithUsageMetadata(r.Context(), revenium.Context{})
	resp, err := client.Chat().Completions().New(ctx, openai.ChatCompletionNewParams{ // target
		// Use the caller's model
		Model: model,
	})
}`),
  ],
  [
    "an assignment whose WithUsageMetadata starts on the next line",
    goTarget(`func f(r *http.Request) {
	ctx :=
		revenium.WithUsageMetadata(r.Context(), revenium.Context{})
	client.Chat().Completions().New(ctx, params) // target
}`),
  ],
  [
    "ctx replaced after the metadata assignment is reported",
    !goTarget(`func f(r *http.Request) {
	ctx := revenium.WithUsageMetadata(r.Context(), revenium.Context{})
	ctx = r.Context()
	client.Chat().Completions().New(ctx, params) // target
}`),
  ],
  [
    "a sibling handler's metadata does not count for an unwired handler",
    !goTarget(`func main() {
	http.HandleFunc("/a", func(w http.ResponseWriter, r *http.Request) {
		ctx := revenium.WithUsageMetadata(r.Context(), revenium.Context{})
		client.Chat().Completions().New(ctx, params)
	})
	http.HandleFunc("/b", func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		client.Chat().Completions().New(ctx, params) // target
	})
}`),
  ],
  [
    "a closure parameter named ctx shadows an outer metadata ctx",
    !goTarget(`func main() {
	ctx := revenium.WithUsageMetadata(context.Background(), revenium.Context{})
	_ = ctx
	run(func(ctx context.Context) error {
		client.Chat().Completions().New(ctx, params) // target
		return nil
	})
}`),
  ],
  [
    "ctx, cancel := context.WithTimeout(revenium.WithUsageMetadata(...), d)",
    goTarget(`func f(r *http.Request) {
	ctx, cancel := context.WithTimeout(revenium.WithUsageMetadata(r.Context(), revenium.Context{}), time.Second)
	defer cancel()
	client.Chat().Completions().New(ctx, params) // target
}`),
  ],
  [
    "a timeout derived from the metadata ctx keeps it",
    goTarget(`func f(r *http.Request) {
	ctx := revenium.WithUsageMetadata(r.Context(), revenium.Context{})
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	client.Chat().Completions().New(ctx, params) // target
}`),
  ],
];
for (const [name, ok] of GO_CHECK_CASES) check("go check", name, ok);

header("Bare customer-id identifier notice");

const nodeNotice = bareIdentifierNotice("orgID", "node") ?? "";
const goNotice = bareIdentifierNotice("orgID", "go") ?? "";
const pythonNotice = bareIdentifierNotice("org_id", "python") ?? "";
check("notice", "Node still suggests a qualified request expression", nodeNotice.includes("req.user.orgID"));
check("notice", "Go treats a bare identifier as a local, without JavaScript suggestions", goNotice.includes("Go variable") && !goNotice.includes("req.user"));
check("notice", "Python gets no JavaScript suggestion", pythonNotice.includes("Python variable") && !pythonNotice.includes("req.user"));
check("notice", "a qualified expression gets no notice", bareIdentifierNotice("req.user.orgId", "node") === null);

header("SUMMARY");
console.log(`Passed: ${pass}`);
console.log(`Failed: ${fail}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
