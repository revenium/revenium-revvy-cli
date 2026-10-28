import { REVENIUM_DOCS_URL } from "../../../constants/api.js";
import { getDesignFilename } from "../../generate/utils/design-writer.js";

/**
 * Per-provider rule snippets — used to build a rules file that mentions ONLY
 * the providers actually detected in the project. Avoids the previous behavior
 * of suggesting `import { openai, createUsageMetadata } …` to a developer
 * working on an Anthropic-only codebase.
 */
const NODE_PROVIDER_PATTERNS: Record<string, string> = {
  "OpenAI": `- **OpenAI**: use the wrapped client from \`revenium-config\` (method-chain API with metadata as 2nd argument).
  \`\`\`ts
  import { openai, createUsageMetadata } from "./revenium-config.js";
  await openai.chat().completions().create(params, createUsageMetadata({ ... }));
  \`\`\``,
  "Azure OpenAI": `- **Azure OpenAI**: use the wrapped client from \`revenium-config\` (same shape as OpenAI).`,
  "Anthropic": `- **Anthropic**: auto-patched via \`@revenium/middleware/anthropic\` — pass \`usageMetadata\` inline on the params object.
  \`\`\`ts
  import "@revenium/middleware/anthropic";
  import Anthropic from "@anthropic-ai/sdk";
  await client.messages.create({ ..., usageMetadata: createUsageMetadata({ ... }) });
  \`\`\``,
  "Google GenAI": `- **Google GenAI**: use the controller pattern from \`revenium-config\` — \`googleAI.createChat([...], "gemini-2.0-flash-001", { ... })\`.`,
  "Google GenAI (legacy)": `- **Google GenAI (legacy)**: use the controller pattern from \`revenium-config\`.`,
  "Vertex AI": `- **Vertex AI**: use the controller pattern from \`revenium-config\` — same shape as Google GenAI.`,
  "Perplexity": `- **Perplexity**: use the wrapped client from \`revenium-config\` — same shape as OpenAI.`,
  "LiteLLM": `- **LiteLLM**: middleware patches global fetch; send Revenium fields as headers on the proxy call.`,
  "fal.ai": `- **fal.ai**: \`import { Initialize, GetClient } from "@revenium/middleware/fal"\` — call \`Initialize()\` once, then \`GetClient().run(endpoint, input, createUsageMetadata({ ... }))\` (metadata is the trailing argument on \`run\` / \`subscribe\` / \`stream\`).`,
};

const PYTHON_PROVIDER_PATTERNS: Record<string, string> = {
  "OpenAI": `- **OpenAI**: \`import revenium_middleware.openai\` once at app startup; pass \`usage_metadata={...}\` to every \`.create()\`.`,
  "Azure OpenAI": `- **Azure OpenAI**: same as OpenAI — \`import revenium_middleware.openai\`.`,
  "Anthropic": `- **Anthropic**: \`import revenium_middleware.anthropic\` once at app startup; pass \`usage_metadata={...}\` on every \`.messages.create()\`.`,
  "Google GenAI": `- **Google GenAI / Vertex**: \`import revenium_middleware.google\` once; pass \`usage_metadata={...}\` to \`.generate_content()\`.`,
  "Google GenAI (legacy)": `- **Google GenAI (legacy)**: \`import revenium_middleware.google\` once.`,
  "Vertex AI": `- **Vertex AI**: \`import revenium_middleware.google\` once.`,
  "Perplexity": `- **Perplexity**: \`import revenium_middleware.perplexity\` once; pass \`usage_metadata={...}\` to \`.create()\`.`,
  "LiteLLM": `- **LiteLLM**: \`import revenium_middleware.litellm.client.middleware\` once; pass \`usage_metadata={...}\` to \`litellm.completion()\`.`,
  "Ollama": `- **Ollama**: \`import revenium_middleware.ollama\` once; pass \`usage_metadata={...}\` to \`ollama.chat()\`.`,
  "fal.ai": `- **fal.ai**: \`import revenium_middleware.fal\` once; pass \`usage_metadata={...}\` to \`fal_client.run()\` / \`subscribe()\` / \`stream()\` / \`submit()\`.`,
};

function buildProviderSection(
  detectedProviders: readonly string[] | undefined,
  patterns: Record<string, string>,
): string {
  if (!detectedProviders || detectedProviders.length === 0) {
    // No detected providers — fall back to a generic line so the file still has
    // something useful (older calls of getEditorRules without providers).
    return "- See your project's `revenium-config` helper for the per-provider call patterns.";
  }
  const lines: string[] = [];
  for (const provider of detectedProviders) {
    const snippet = patterns[provider];
    if (snippet) lines.push(snippet);
  }
  if (lines.length === 0) {
    return "- See your project's `revenium-config` helper for the per-provider call patterns.";
  }
  return lines.join("\n\n");
}

function buildNodeRule(detectedProviders?: readonly string[]): string {
  const designFile = getDesignFilename("node");
  const providerSection = buildProviderSection(detectedProviders, NODE_PROVIDER_PATTERNS);
  return `# Revenium Instrumentation Rules

All AI API calls in this codebase MUST be instrumented with Revenium metering.

## Required
- Every AI SDK call must go through the Revenium middleware
- Every call must include \`usageMetadata\` with at minimum: organizationName, productName, agent, taskType
- Never make raw AI calls without Revenium context

## Provider-specific patterns (only the providers detected in this project)

${providerSection}

## How to instrument a new AI call
1. Import the helper: \`import { createUsageMetadata } from "./revenium-config.js"\` (or the workspace-relative path you placed it at, in a monorepo)
2. Apply the per-provider pattern shown above
3. Ensure \`organizationName\` is sourced from the customer ID in your auth context (the same expression revvy detected during setup); wrap it in \`String()\` if it's a number

## Reference
- Metering design: see ${designFile}
- SDK docs: ${REVENIUM_DOCS_URL}
`;
}

function buildPythonRule(detectedProviders?: readonly string[]): string {
  const designFile = getDesignFilename("python");
  const providerSection = buildProviderSection(detectedProviders, PYTHON_PROVIDER_PATTERNS);
  return `# Revenium Instrumentation Rules

All AI API calls in this codebase MUST be instrumented with Revenium metering.

## Required
- Every AI SDK call must go through the Revenium middleware
- Middleware is activated by importing the corresponding \`revenium_middleware\` module
- Every call should include \`usage_metadata\` with at minimum: organizationName, productName, agent, task_type
- Never make raw AI calls without Revenium context

## Provider-specific patterns (only the providers detected in this project)

${providerSection}

## How to instrument a new AI call
1. Import the helper: \`from revenium_config import create_usage_metadata\`
2. Apply the per-provider pattern shown above
3. Ensure \`organizationName\` is sourced from the customer ID in your auth context

## Reference
- Config helper: see revenium_config.py
- Metering design: see ${designFile}
- SDK docs: ${REVENIUM_DOCS_URL}
`;
}

const GO_PROVIDER_PATTERNS: Record<string, string> = {
  "OpenAI": `- **OpenAI**: \`github.com/revenium/revenium-go-sdk/openai\` — \`if err := Initialize(); err != nil { ... }\`, \`client, err := GetClient()\`, then \`client.Chat().Completions().New(ctx, params)\` with \`ctx := revenium.WithUsageMetadata(ctx, revenium.Context{...})\`.`,
  "OpenAI (sashabaranov)": `- **OpenAI (sashabaranov/go-openai)**: not wrapped by the Revenium Go SDK — migrate the call to the wrapped \`openai-go\` client from \`github.com/revenium/revenium-go-sdk/openai\`.`,
  "Anthropic": `- **Anthropic**: \`github.com/revenium/revenium-go-sdk/anthropic\` — \`client.Messages().CreateMessage(ctx, params)\` with \`ctx := revenium.WithUsageMetadata(ctx, revenium.Context{...})\`. Bedrock is selected automatically when AWS credentials are set.`,
  "AWS Bedrock": `- **AWS Bedrock**: metered through \`github.com/revenium/revenium-go-sdk/anthropic\` (selected automatically when AWS credentials are set) — call \`client.Messages().CreateMessage(ctx, params)\`, not \`bedrockruntime\` directly.`,
  "Google GenAI": `- **Google GenAI**: \`github.com/revenium/revenium-go-sdk/google\` — \`client.Models().GenerateContent(ctx, model, contents, config)\` with \`ctx := revenium.WithUsageMetadata(ctx, revenium.Context{...})\`.`,
  "Vertex AI": `- **Vertex AI**: same module as Google GenAI (\`github.com/revenium/revenium-go-sdk/google\`), selected when \`GOOGLE_CLOUD_PROJECT\` is set.`,
  "Ollama": `- **Ollama**: \`github.com/revenium/revenium-go-sdk/ollama\` — \`client.ChatCompletions(ctx, req)\` with the metadata on \`ctx\`.`,
  "fal.ai": `- **fal.ai**: \`github.com/revenium/revenium-go-sdk/fal\` — \`client.Run(ctx, endpoint, input, revenium.UsageMetadata(revenium.Context{...}))\`.`,
};

function buildGoRule(detectedProviders?: readonly string[]): string {
  const designFile = getDesignFilename("go");
  const providerSection = buildProviderSection(detectedProviders, GO_PROVIDER_PATTERNS);
  return `# Revenium Instrumentation Rules

All AI API calls in this codebase MUST be instrumented with Revenium metering.

## Required
- Every AI SDK call goes through the wrapped client from the matching \`github.com/revenium/revenium-go-sdk/<provider>\` module (\`Initialize()\` once — it returns an error — then \`client, err := GetClient()\` and \`defer client.Close()\`)
- Every call receives a context built with \`revenium.WithUsageMetadata(ctx, revenium.Context{...})\` carrying at minimum: CustomerID, Product, Agent, TaskType
- Never call the upstream provider SDK directly

## Provider-specific patterns (only the providers detected in this project)

${providerSection}

## How to instrument a new AI call
1. Import the helper package: \`revenium "<module>/revenium"\` (the \`revenium/config.go\` revvy generated)
2. Build the context: \`ctx := revenium.WithUsageMetadata(ctx, revenium.Context{CustomerID: ..., TaskType: "..."})\`
3. Make the call on the wrapped client with that \`ctx\`

## Reference
- Config helper: see revenium/config.go
- Metering design: see ${designFile}
- SDK docs: ${REVENIUM_DOCS_URL}
`;
}

export function getEditorRules(
  language: "node" | "python" | "go",
  detectedProviders?: readonly string[],
): string {
  if (language === "python") return buildPythonRule(detectedProviders);
  if (language === "go") return buildGoRule(detectedProviders);
  return buildNodeRule(detectedProviders);
}

