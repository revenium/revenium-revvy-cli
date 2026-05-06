/**
 * Node/TypeScript-specific transform helpers.
 * Provider-specific comment blocks showing Revenium middleware usage patterns.
 */

import type { MeteringDesign } from "../base-transform.js";
import { nodeValue, insertAfterImports } from "../base-transform.js";
import { getDesignFilename } from "../../../generate/utils/design-writer.js";
import { pickAgentForFile, pickJobNamePlaceholder } from "../shared-helpers.js";
import { coerceCustomerId } from "../../../../utils/customer-id-coercion.js";

// Re-export shared utilities that Node transforms need
export type { TransformContext, TransformResult } from "../base-transform.js";
export { insertAfterImports, hasImport } from "../base-transform.js";

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
      return [
        `// Usage with Revenium OpenAI middleware (client wrapper pattern):`,
        `//`,
        `//   import { Initialize, GetClient } from "@revenium/middleware/openai";`,
        `//   Initialize();`,
        `//   const client = GetClient();`,
        `//`,
        `//   const metadata = {`,
        ...metaLines,
        `//   };`,
        `//`,
        `//   const response = await client.chat().completions().create(params, metadata);`,
      ].join("\n");

    case "perplexity":
      return [
        `// Usage with Revenium Perplexity middleware (client wrapper pattern):`,
        `//`,
        `//   import { Initialize, GetClient } from "@revenium/middleware/perplexity";`,
        `//   Initialize();`,
        `//   const client = GetClient();`,
        `//`,
        `//   const metadata = {`,
        ...metaLines,
        `//   };`,
        `//`,
        `//   const response = await client.chat().completions().create(`,
        `//     { model: "sonar-pro", messages: [...] },`,
        `//     metadata`,
        `//   );`,
      ].join("\n");

    case "google-genai":
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

const NODE_FOOTER = [
  `// ────────────────────────────────────────────────────────────────`,
  `// → Wire it in (recommended):`,
  `//   1. Add the helper import at the top of this file (or its workspace`,
  `//      equivalent in a monorepo — see revenium-monorepo-todo.md if present):`,
  `//        import { createUsageMetadata } from "./revenium-config.js";`,
  `//   2. At each .create() call below, pass the metadata:`,
  `//        usageMetadata: createUsageMetadata({ customerId: ..., taskType: "..." })`,
  `//   3. The literal usageMetadata block above is shown for reference only`,
  `//      — using the helper keeps every call site consistent and lets you`,
  `//      change shared fields in one place.`,
  `//`,
  `// → Then do Step 7 (AI Outcomes) to design taskType/traceId/Job IDs`,
  `//   that unlock per-workflow + per-outcome analytics. See .claude/revvy-agent.md.`,
].join("\n");

/**
 * Builds a commented reference block for Node/TS showing how to use the
 * Revenium middleware for a specific provider. Placed after imports.
 * Values from the user's design are inlined (Change 1 + Change 4).
 *
 * @param filePath - optional source file path, used for agent name matching (A11)
 */
export function buildNodeCommentBlock(
  design: MeteringDesign,
  provider: string,
  filePath?: string,
): string {
  const example = buildNodeCallExample(design, provider, filePath);

  const lines = [
    `// ── Revenium: middleware usage reference ──────────────────────────`,
    `// The import above activates metering. See the pattern below to add`,
    `// business context (org, product, agent) to your AI calls.`,
    `//`,
    example,
    `//`,
    `// See ${getDesignFilename(design.detectedLanguage)} for your full metering configuration.`,
    NODE_FOOTER,
  ];

  return lines.join("\n");
}

/**
 * Inserts the Revenium import + comment block after existing imports, then
 * collapses any triple-or-more consecutive newlines down to two (= one blank
 * line). This prevents a double blank line when the source already has a blank
 * line between the last import and the first non-import statement.
 */
export function insertNodeBlock(
  content: string,
  importLine: string,
  commentBlock: string,
): string {
  const inserted = insertAfterImports(
    content,
    `\n${importLine}\n${commentBlock}\n`,
  );
  return inserted.replace(/\n{3,}/g, "\n\n");
}
