/**
 * Python-specific transform helpers.
 * Import insertion, usage_metadata injection, and comment block generation.
 */

import type { MeteringDesign } from "../base-transform.js";
import { pythonValue } from "../base-transform.js";
import { getDesignFilename } from "../../../generate/utils/design-writer.js";
import { pickAgentForFile, pickJobNamePlaceholder } from "../shared-helpers.js";

// Re-export shared utilities that Python transforms need
export type { TransformContext, TransformResult } from "../base-transform.js";
export { hasImport } from "../base-transform.js";

// ── Python import helpers ───────────────────────────────────────────

/**
 * Finds the last import/from line in Python source and returns the index of
 * the final line of the last import statement (including multi-line
 * `from X import (\n  A,\n  B,\n)` forms).
 * Returns -1 if no imports found.
 */
export function findLastPythonImportIndex(lines: string[]): number {
  let lastImportIndex = -1;
  let insideMultilineImport = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Strip Python comments before checking for parens
    const codePart = line.replace(/#.*$/, "");

    if (insideMultilineImport) {
      // Still inside a multi-line import — keep scanning until closing paren
      lastImportIndex = i;
      if (codePart.includes(")")) {
        insideMultilineImport = false;
      }
      continue;
    }

    if (line.startsWith("import ") || line.startsWith("from ")) {
      lastImportIndex = i;
      // Check if this opens a multi-line import: has '(' but no matching ')'
      if (codePart.includes("(") && !codePart.includes(")")) {
        insideMultilineImport = true;
      }
    } else if (lastImportIndex > -1 && line !== "") {
      break;
    }
  }
  return lastImportIndex;
}

/**
 * Inserts a Python import line after the last existing import.
 */
export function insertPythonImport(content: string, importLine: string): string {
  const lines = content.split("\n");
  const idx = findLastPythonImportIndex(lines);
  if (idx >= 0) {
    lines.splice(idx + 1, 0, importLine, "");
  } else {
    lines.unshift(importLine, "");
  }
  return lines.join("\n");
}

// ── Python usage_metadata builder ───────────────────────────────────

/**
 * Builds the usage_metadata dict literal string for Python.
 */
export function buildPythonUsageMetadata(
  design: MeteringDesign,
  indent: string = "        "
): string {
  const fields: string[] = [];

  if (design.organization.source === "auth-context") {
    fields.push(
      `${indent}    "organizationName": "",  # TODO: wire to ${design.organization.customerIdExpression} (your customer ID)`
    );
  } else if (design.organization.source === "api-key") {
    fields.push(
      `${indent}    "subscriber": {"id": ""},  # TODO: wire to your API key identifier`
    );
  } else {
    fields.push(
      `${indent}    "organizationName": "",  # TODO: wire to ${design.organization.customerIdExpression} (your customer ID)`
    );
  }

  if (design.products.length > 0) {
    const val = design.products[0]!.name;
    fields.push(`${indent}    "productName": ${pythonValue(val)},`);
  }

  if (design.agents.length > 0) {
    const val = design.agents[0]!.name;
    fields.push(`${indent}    "agent": ${pythonValue(val)},`);
  }

  return `${indent}usage_metadata={\n${fields.join("\n")}\n${indent}},`;
}

// ── Python call-site injection ──────────────────────────────────────

/**
 * Injects `usage_metadata` into every Python call that matches `callPattern`.
 * Finds the matching closing paren and inserts the metadata block before it.
 *
 * Returns { content, patchCount } — the caller can use patchCount to build
 * change descriptions. Does NOT modify calls that already have usage_metadata.
 */
export function injectPythonUsageMetadata(
  content: string,
  callPattern: RegExp,
  design: MeteringDesign,
  searchChunkSize: number = 800,
): { content: string; patchCount: number } {
  let result = content;
  let patchCount = 0;

  let createMatch: RegExpExecArray | null;
  const patches: Array<{ index: number }> = [];

  while ((createMatch = callPattern.exec(result)) !== null) {
    const searchStart = createMatch.index;

    const lineStart = result.lastIndexOf("\n", searchStart) + 1;
    const linePrefix = result.slice(lineStart, searchStart).trimStart();
    if (linePrefix.startsWith("#")) continue;

    const nextChunk = result.slice(searchStart, searchStart + searchChunkSize);
    if (
      nextChunk.includes("usage_metadata") ||
      nextChunk.includes("usageMetadata")
    ) {
      continue;
    }
    const parenIndex = searchStart + createMatch[0].length - 1;
    patches.push({ index: parenIndex });
  }

  for (const patch of patches.reverse()) {
    let parenCount = 1;
    let i = patch.index + 1;
    while (i < result.length && parenCount > 0) {
      if (result[i] === "(") parenCount++;
      if (result[i] === ")") parenCount--;
      i++;
    }

    if (parenCount === 0) {
      const closingParenIndex = i - 1;
      const lineStart = result.lastIndexOf("\n", closingParenIndex) + 1;
      const closingLine = result.slice(lineStart, closingParenIndex);
      const baseIndent = closingLine.match(/^(\s*)/)?.[1] || "    ";

      const metaBlock = `\n${buildPythonUsageMetadata(design, baseIndent + "    ")}\n${baseIndent}`;

      const beforeClose = result.slice(0, closingParenIndex).trimEnd();
      const needsComma =
        !beforeClose.endsWith(",") && !beforeClose.endsWith("(");

      const insertion = needsComma ? `,${metaBlock}` : metaBlock;

      result =
        result.slice(0, closingParenIndex) +
        insertion +
        result.slice(closingParenIndex);
      patchCount++;
    }
  }

  return { content: result, patchCount };
}

// ── Provider-specific Python comment blocks ─────────────────────────

const PYTHON_CALL_TEMPLATES: Record<string, string> = {
  openai: `#   response = client.chat.completions.create(
#       model="gpt-4o-mini",
#       messages=[...],
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
  anthropic: `#   message = client.messages.create(
#       model="claude-3-5-sonnet-20241022",
#       max_tokens=1024,
#       messages=[...],
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
  ollama: `#   response = ollama.chat(
#       model="qwen2.5:7b",
#       messages=[...],
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
  litellm: `#   response = litellm.completion(
#       model="openai/gpt-4o-mini",
#       messages=[...],
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
  perplexity: `#   response = client.chat.completions.create(
#       model="sonar-pro",
#       messages=[...],
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
  "google-genai": `#   response = client.models.generate_content(
#       model="gemini-2.0-flash-001",
#       contents="...",
#       usage_metadata=metadata  # <-- pass metadata here
#   )`,
};

const PYTHON_FOOTER = [
  `# ────────────────────────────────────────────────────────────────`,
  `# → Wire it in: copy the usage_metadata block above into each call`,
  `#   below (Step 6 of the agent guide = basic). Then do Step 7 to design`,
  `#   task_type/trace_id/Job IDs that unlock per-workflow and per-outcome`,
  `#   analytics (= the AI Outcomes feature). Revvy intentionally leaves`,
  `#   call-site edits to you — see .claude/revvy-agent.md.`,
].join("\n");

/**
 * Inserts a Python import line after the last existing import, then collapses
 * any triple-or-more consecutive newlines to two (= one blank line). This
 * prevents a double blank line when the source already has a blank line between
 * imports and the first non-import statement.
 */
export function insertPythonBlock(content: string, importLine: string): string {
  const inserted = insertPythonImport(content, importLine);
  return inserted.replace(/\n{3,}/g, "\n\n");
}

// pickAgentForFile, pickJobNamePlaceholder, normalizeForMatch → shared-helpers.ts

/**
 * Builds a commented reference block showing how to add usage_metadata
 * for a specific Python provider. Placed after the middleware import.
 * Values from the user's design are inlined (Change 1 + Change 4).
 *
 * @param filePath - optional source file path, used for agent name matching (A11)
 */
export function buildPythonCommentBlock(
  design: MeteringDesign,
  provider: string,
  filePath?: string,
): string {
  const orgExpr = design.organization.customerIdExpression || '"your_org_id"';
  const productExpr = design.products.length > 0 ? design.products[0]!.name : "";
  const agentMatch = pickAgentForFile(design.agents, filePath);
  const jobNamePlaceholder = pickJobNamePlaceholder(design.agents);

  const metadataFields: string[] = [];
  metadataFields.push(`#     "organizationName": ${orgExpr},  # from --customer-id-expression`);
  if (productExpr) {
    metadataFields.push(`#     "productName": ${pythonValue(productExpr)},`);
  } else {
    metadataFields.push(`#     # "productName": "...",  # optional, not provided`);
  }
  if (agentMatch && !agentMatch.guessed) {
    metadataFields.push(`#     "agent": ${pythonValue(agentMatch.name)},`);
  } else if (agentMatch) {
    metadataFields.push(`#     # "agent": ${pythonValue(agentMatch.name)},  # guessed from filename — verify and uncomment`);
  } else {
    metadataFields.push(`#     # "agent": "...",        # name of the agent making this call`);
  }
  metadataFields.push(`#     # "task_type": "...",                      # workflow category — see Step 7 of agent guide`);
  metadataFields.push(`#     # "trace_id": "...",                       # shared ID across multi-call workflows — see Step 7`);
  metadataFields.push(`#     # "agentic_job_id": "support-ticket-123",  # tied to a business outcome (AI Outcomes) — see Step 7`);
  metadataFields.push(`#     # "agentic_job_name": ${jobNamePlaceholder},  # human-readable Job name`);

  const callExample = PYTHON_CALL_TEMPLATES[provider] ?? PYTHON_CALL_TEMPLATES.openai!;

  const lines = [
    `# ── Revenium: usage_metadata reference ──────────────────────────────`,
    `# The middleware import above activates basic metering (tokens, model, cost).`,
    `# To add business context (org, product, agent), pass usage_metadata to your AI calls:`,
    `#`,
    `# metadata = {`,
    ...metadataFields,
    `# }`,
    `#`,
    callExample,
    `#`,
    `# See ${getDesignFilename(design.detectedLanguage)} for your full metering configuration.`,
    PYTHON_FOOTER,
  ];

  return lines.join("\n");
}
