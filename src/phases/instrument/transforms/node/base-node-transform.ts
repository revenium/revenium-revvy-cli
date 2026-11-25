/**
 * Node/TypeScript-specific transform helpers.
 * Provider-specific comment blocks showing Revenium middleware usage patterns.
 */

import type { MeteringDesign } from "../base-transform.js";
import { nodeValue, insertBlockAtLine, findImportSectionEnd } from "../base-transform.js";
import { getDesignFilename } from "../../../generate/utils/design-writer.js";
import { configHelperFileName, helperIdentityParameter, nodeHelperImportSpecifier } from "../../../generate/config-helper.js";
import { pickAgentForFile, pickJobNamePlaceholder } from "../shared-helpers.js";
import { coerceCustomerId } from "../../../../utils/customer-id-coercion.js";
import { posix } from "path";

// Re-export shared utilities that Node transforms need
export type { TransformContext, TransformResult } from "../base-transform.js";
export { hasImport } from "../base-transform.js";

/**
 * Builds the usageMetadata object literal string for Node/TS.
 */
export function buildNodeUsageMetadata(
  design: MeteringDesign,
  indent: string = "    "
): string {
  const fields: string[] = [];

  if (design.organization.source === "auth-context") {
    fields.push(
      `${indent}  organizationName: "", // TODO: wire to ${design.organization.customerIdExpression} (your customer ID)`
    );
  } else if (design.organization.source === "api-key") {
    fields.push(
      `${indent}  subscriber: { id: "" }, // TODO: wire to your API key identifier`
    );
  } else {
    fields.push(
      `${indent}  organizationName: "", // TODO: wire to ${design.organization.customerIdExpression} (your customer ID)`
    );
  }

  if (design.products.length > 0) {
    const val = design.products[0]!.name;
    fields.push(`${indent}  productName: ${nodeValue(val)},`);
  }

  if (design.agents.length > 0) {
    const val = design.agents[0]!.name;
    fields.push(`${indent}  agent: ${nodeValue(val)},`);
  }

  return `${indent}usageMetadata: {\n${fields.join("\n")}\n${indent}},`;
}

// ── Provider-specific Node/TS comment blocks ────────────────────────

export const NODE_REFERENCE_HEADER = `// ── Revenium: middleware usage reference ──────────────────────────`;

interface WrapperClient {
  displayName: string;
  middlewareSubpath: string;
  /** Variable the examples call the wrapped client through. */
  clientName: string;
  /** Lines that give the developer the wrapped client, as seen from `filePath`. */
  obtainClient: (filePath?: string) => string[];
  /** Calls the wrapped client offers, each taking the metadata as its second argument. */
  calls: string[];
  exampleModel: string;
}

// The generated helper initializes and exports only the OpenAI client: the
// scan never lists Perplexity as a provider (it rides on the openai package),
// so a Perplexity file gets the client straight from its middleware.
export const WRAPPER_CLIENTS = {
  openai: {
    displayName: "OpenAI",
    middlewareSubpath: "@revenium/middleware/openai",
    clientName: "openai",
    obtainClient: (filePath) => [
      `import { openai } from "${generatedHelperImportPath(filePath)}";  // the helper calls Initialize() and GetClient() once`,
    ],
    calls: ["chat().completions().create", "embeddings().create", "responses().create"],
    exampleModel: "gpt-4o-mini",
  },
  perplexity: {
    displayName: "Perplexity",
    middlewareSubpath: "@revenium/middleware/perplexity",
    clientName: "perplexity",
    obtainClient: () => [
      `import { Initialize, GetClient } from "@revenium/middleware/perplexity";`,
      `Initialize();  // once per process, at startup`,
      `const perplexity = GetClient();`,
    ],
    calls: ["chat().completions().create"],
    exampleModel: "sonar-pro",
  },
} satisfies Record<string, WrapperClient>;

export type WrapperClientProvider = keyof typeof WRAPPER_CLIENTS;

function isWrapperClientProvider(provider: string): provider is WrapperClientProvider {
  return provider in WRAPPER_CLIENTS;
}

const GENERATED_HELPER_MODULE = configHelperFileName("node").replace(/\.ts$/, "");

/** Whether an import/require specifier names the generated helper module. */
export function isGeneratedHelperSpecifier(specifier: string): boolean {
  return posix.basename(specifier).replace(/\.[cm]?[jt]sx?$/, "") === posix.basename(GENERATED_HELPER_MODULE);
}

/** Import specifier of the generated helper as seen from `filePath`. */
export function generatedHelperImportPath(filePath?: string): string {
  return nodeHelperImportSpecifier(filePath ?? configHelperFileName("node"));
}

// pickAgentForFile, pickJobNamePlaceholder, normalizeForMatch → shared-helpers.ts

/**
 * Builds the inline metadata fields for the reference comment block.
 * Renders the customer's actual values from their design, with optional
 * lines commented out when no value was provided.
 *
 * @param filePath - optional source file path used for agent name matching (A11)
 */
function buildNodeMetadataCommentLines(
  design: MeteringDesign,
  linePrefix: string = "//       ",
  filePath?: string,
): string[] {
  // Apply String() coercion when the expression looks numeric (e.g. ends in
  // .teamId) — same heuristic shared with the call-sites manifest, monorepo
  // TODO, and agent-guide Step 3. Without this, the in-file reference would
  // contradict the manifest and produce a TS error if the agent copy-pasted.
  const orgExpr = design.organization.customerIdExpression
    ? coerceCustomerId(design.organization.customerIdExpression)
    : '"your-org"';
  const lines: string[] = [];

  lines.push(`${linePrefix}organizationName: ${orgExpr},          // from --customer-id-expression`);

  if (design.products.length > 0) {
    const val = design.products[0]!.name;
    lines.push(`${linePrefix}productName: ${nodeValue(val)},`);
  } else {
    lines.push(`${linePrefix}// productName: "...",                    // optional, not provided`);
  }

  const agentMatch = pickAgentForFile(design.agents, filePath);
  if (agentMatch && !agentMatch.guessed) {
    lines.push(`${linePrefix}agent: ${nodeValue(agentMatch.name)},`);
  } else if (agentMatch) {
    lines.push(`${linePrefix}// agent: ${nodeValue(agentMatch.name)},          // guessed from filename — verify and uncomment`);
  } else {
    lines.push(`${linePrefix}// agent: "...",                          // name of the agent making this call`);
  }

  const jobNamePlaceholder = pickJobNamePlaceholder(design.agents);
  lines.push(`${linePrefix}// taskType: "...",                       // workflow category — see Step 7 of agent guide`);
  lines.push(`${linePrefix}// traceId: "...",                        // shared ID across multi-call workflows — see Step 7`);
  lines.push(`${linePrefix}// agenticJobId: "support-ticket-123",     // tied to a business outcome (AI Outcomes) — see Step 7`);
  lines.push(`${linePrefix}// agenticJobName: ${jobNamePlaceholder},  // human-readable Job name`);

  return lines;
}

/**
 * Returns the per-provider call-site example lines, with usageMetadata
 * inlined from the user's actual design values.
 */
function buildNodeCallExample(design: MeteringDesign, provider: string, filePath?: string): string {
  const metaLines = buildNodeMetadataCommentLines(design, "//       ", filePath);

  switch (provider) {
    case "openai":
    case "perplexity": {
      const client = WRAPPER_CLIENTS[provider];
      return [
        `// Usage with Revenium ${client.displayName} middleware (a client wrapper: it does not patch \`new OpenAI()\`):`,
        `//`,
        ...client.obtainClient(filePath).map((line) => `//   ${line}`),
        `//`,
        `//   const metadata = {`,
        ...metaLines,
        `//   };`,
        `//`,
        `//   const response = await ${client.clientName}.chat().completions().create(`,
        `//     { model: "${client.exampleModel}", messages: [...] },`,
        `//     metadata,  // second argument, not a field of the params`,
        `//   );`,
        ...(provider === "openai"
          ? [`//   const embedding = await openai.embeddings().create({ model: "text-embedding-3-small", input }, metadata);`]
          : []),
      ].join("\n");
    }

    case "google-genai":
      return [
        `// Usage with Revenium Google GenAI middleware (meters your own client on import):`,
        `//`,
        `//   import "@revenium/middleware/google/genai";  // load before the first Gemini call,`,
        `//   // the same way the app loads @google/genai (require(...) if it uses require)`,
        `//`,
        `//   const response = await ai.models.generateContent({`,
        `//     model: "gemini-2.0-flash-001",`,
        `//     contents: "Your prompt here",`,
        `//     usageMetadata: {`,
        ...metaLines,
        `//     },`,
        `//   });`,
        `//`,
        `//   // Chats take usageMetadata once, in ai.chats.create({ model, usageMetadata }).`,
        `//   // Remove any trackGoogleUsageAsync() call, or each request is recorded twice.`,
      ].join("\n");

    case "google-genai-controller":
      return [
        `// Usage with Revenium Google GenAI middleware (controller pattern):`,
        `//`,
        `//   import { GoogleGenAIController } from "@revenium/middleware/google/genai";`,
        `//   const controller = new GoogleGenAIController();`,
        `//`,
        `//   const response = await controller.createChat(`,
        `//     ["Your prompt here"],`,
        `//     "gemini-2.0-flash-001",`,
        `//     {  // optional metadata`,
        ...metaLines,
        `//     }`,
        `//   );`,
      ].join("\n");

    case "vertex-ai":
      return [
        `// Usage with Revenium Vertex AI middleware (controller pattern):`,
        `//`,
        `//   import { VertexAIController } from "@revenium/middleware/google/vertex";`,
        `//   const controller = new VertexAIController();`,
        `//`,
        `//   const response = await controller.createChat(`,
        `//     ["Your prompt here"],`,
        `//     "gemini-2.0-flash-001",`,
        `//     {  // optional metadata`,
        ...metaLines,
        `//     }`,
        `//   );`,
      ].join("\n");

    case "anthropic":
    default:
      return [
        `// Usage with Revenium Anthropic middleware (auto-patches on import):`,
        `//`,
        `//   import "@revenium/middleware/anthropic";`,
        `//   import Anthropic from "@anthropic-ai/sdk";`,
        `//   const client = new Anthropic();`,
        `//`,
        `//   const response = await client.messages.create({`,
        `//     model: "claude-3-5-sonnet-20241022",`,
        `//     messages: [...],`,
        `//     usageMetadata: {`,
        ...metaLines,
        `//     },`,
        `//   });`,
      ].join("\n");
  }
}

function buildNodeFooter(design: MeteringDesign, provider: string, filePath: string | undefined): string {
  const identity = helperIdentityParameter(design);
  const passMetadata = isWrapperClientProvider(provider)
    ? [
        `//   2. Call the wrapped client and pass the metadata as the second argument:`,
        `//        .create(params, createUsageMetadata({ ${identity}: ..., taskType: "..." }))`,
      ]
    : [
        `//   2. At each .create() call below, pass the metadata:`,
        `//        usageMetadata: createUsageMetadata({ ${identity}: ..., taskType: "..." })`,
      ];
  return [
    `// ────────────────────────────────────────────────────────────────`,
    `// → Wire it in (recommended):`,
    `//   1. Add the helper import at the top of this file (or its workspace`,
    `//      equivalent in a monorepo — see revenium-monorepo-todo.md if present):`,
    `//        import { createUsageMetadata } from "${generatedHelperImportPath(filePath)}";`,
    ...passMetadata,
    `//   3. The literal metadata block above is shown for reference only`,
    `//      — using the helper keeps every call site consistent and lets you`,
    `//      change shared fields in one place.`,
    `//`,
    `// → Then do Step 7 (AI Outcomes) to design taskType/traceId/Job IDs`,
    `//   that unlock per-workflow + per-outcome analytics. See .claude/revvy-agent.md.`,
  ].join("\n");
}

function buildNodeIntro(provider: string): string[] {
  if (isWrapperClientProvider(provider)) {
    return [
      `// ${WRAPPER_CLIENTS[provider].displayName} calls are metered only when they go through the Revenium`,
      `// wrapped client: a client made with \`new OpenAI()\` is not metered, even with`,
      `// the middleware installed. Each TODO(revenium) below marks one to replace.`,
    ];
  }
  return [
    `// The import above activates metering. See the pattern below to add`,
    `// business context (org, product, agent) to your AI calls.`,
  ];
}

/**
 * Builds a commented reference block for Node/TS showing how to use the
 * Revenium middleware for a specific provider. Placed after imports.
 * Values from the user's design are inlined.
 *
 * @param filePath - optional source file path, used for agent name matching
 *   and for the relative path to the generated helper
 */
export function buildNodeCommentBlock(
  design: MeteringDesign,
  provider: string,
  filePath?: string,
): string {
  const lines = [
    NODE_REFERENCE_HEADER,
    ...buildNodeIntro(provider),
    `//`,
    buildNodeCallExample(design, provider, filePath),
    `//`,
    `// See ${getDesignFilename(design.detectedLanguage)} for your full metering configuration.`,
    buildNodeFooter(design, provider, filePath),
  ];

  return lines.join("\n");
}

/** Inserts the Revenium import (if any) + comment block after the file's imports. */
export function insertNodeBlock(
  content: string,
  importLine: string | null,
  commentBlock: string,
): string {
  const lines = content.split("\n");
  const block = [...(importLine ? [importLine] : []), commentBlock];
  return insertBlockAtLine(lines, findImportSectionEnd(lines), block).join("\n");
}
