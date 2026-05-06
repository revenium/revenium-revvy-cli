import type { SupportedLanguage } from "../../../constants/languages.js";

export type OperationType =
  | "chat"
  | "embed"
  | "image"
  | "audio"
  | "video"
  | "completion"
  | "response"
  | "tool"
  | "other";

export interface CallPattern {
  /** Dot-separated method chain on the SDK client, e.g. "chat.completions.create" */
  methodChain: string;
  operationType: OperationType;
  /** Human-readable label for reports. Defaults to methodChain. */
  method?: string;
}

export interface ProviderPattern {
  provider: string;
  displayName: string;
  /** SDK package name(s) that, when imported, identify this provider. */
  packageNames: string[];
  language: SupportedLanguage;
  /** Method chains we want to count as AI invocations. */
  callPatterns: CallPattern[];
  /**
   * Revenium middleware import paths/markers. Presence of any of these in a
   * file means that file is already instrumented for this provider.
   */
  instrumentationImports: string[];
}

export const NODE_PATTERNS: ProviderPattern[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    packageNames: ["openai"],
    language: "node",
    callPatterns: [
      // Chat completions — both invocation modes (sync + streaming) plus the
      // newer structured-output `parse` helper. Streaming is the dominant
      // pattern in conversational UIs; missing `.stream` was a P0 silent
      // under-detection bug found in Round 4 testing.
      { methodChain: "chat.completions.create", operationType: "chat" },
      { methodChain: "chat.completions.stream", operationType: "chat" },
      { methodChain: "chat.completions.parse", operationType: "chat" },
      // Revenium-wrapped form: client.chat().completions().create(params, metadata)
      { methodChain: "chat().completions().create", operationType: "chat" },
      { methodChain: "chat().completions().stream", operationType: "chat" },
      // Legacy completions
      { methodChain: "completions.create", operationType: "completion" },
      // Embeddings
      { methodChain: "embeddings.create", operationType: "embed" },
      // Images
      { methodChain: "images.generate", operationType: "image" },
      { methodChain: "images.edit", operationType: "image" },
      { methodChain: "images.createVariation", operationType: "image" },
      // Moderation
      { methodChain: "moderations.create", operationType: "other" },
      // Responses API (gpt-4o reasoning models, agents) — both modes
      { methodChain: "responses.create", operationType: "response" },
      { methodChain: "responses.stream", operationType: "response" },
      // Audio
      { methodChain: "audio.speech.create", operationType: "audio" },
      { methodChain: "audio.transcriptions.create", operationType: "audio" },
      { methodChain: "audio.translations.create", operationType: "audio" },
      // Batch API (offline jobs — billed at half cost; meaningful to track)
      { methodChain: "batches.create", operationType: "other", method: "batches.create (offline batch)" },
    ],
    instrumentationImports: [
      "@revenium/middleware/openai",
      "@revenium/openai", // legacy alias
    ],
  },
  {
    provider: "anthropic",
    displayName: "Anthropic",
    packageNames: ["@anthropic-ai/sdk"],
    language: "node",
    callPatterns: [
      // Messages — sync, streaming, and the newer batches API
      { methodChain: "messages.create", operationType: "chat" },
      { methodChain: "messages.stream", operationType: "chat" },
      { methodChain: "messages.batches.create", operationType: "other", method: "messages.batches.create (offline batch)" },
      // Tool helper used in agent loops
      { methodChain: "messages.countTokens", operationType: "tool" },
      // Legacy completions API (still in use)
      { methodChain: "completions.create", operationType: "completion" },
      { methodChain: "completions.stream", operationType: "completion" },
    ],
    instrumentationImports: [
      "@revenium/middleware/anthropic",
      "@revenium/anthropic", // legacy alias
    ],
  },
  {
    provider: "google-genai",
    displayName: "Google GenAI",
    packageNames: ["@google/genai", "@google/generative-ai"],
    language: "node",
    callPatterns: [
      // Generate content — sync + streaming on both `models.X` and bare-receiver forms.
      { methodChain: "models.generateContent", operationType: "chat" },
      { methodChain: "generateContent", operationType: "chat" },
      { methodChain: "models.generateContentStream", operationType: "chat" },
      { methodChain: "generateContentStream", operationType: "chat" },
      // Embeddings — missing in Round 4 caused RAG pipelines to lose embed-step spend.
      { methodChain: "models.embedContent", operationType: "embed" },
      { methodChain: "embedContent", operationType: "embed" },
      { methodChain: "models.batchEmbedContents", operationType: "embed" },
      { methodChain: "batchEmbedContents", operationType: "embed" },
      // Image generation (Imagen)
      { methodChain: "models.generateImages", operationType: "image" },
      { methodChain: "generateImages", operationType: "image" },
      // Conversational chat session
      { methodChain: "sendMessage", operationType: "chat" },
      { methodChain: "sendMessageStream", operationType: "chat" },
      // Token counting (planning step in many RAG flows)
      { methodChain: "models.countTokens", operationType: "tool" },
      { methodChain: "countTokens", operationType: "tool" },
      // Revenium-wrapped form: controller.createChat(...)
      { methodChain: "createChat", operationType: "chat", method: "createChat (Revenium GoogleGenAIController)" },
    ],
    instrumentationImports: [
      "@revenium/middleware/google/genai",
      "@revenium/middleware/google",
    ],
  },
  {
    provider: "vertex-ai",
    displayName: "Vertex AI",
    packageNames: ["@google-cloud/vertexai"],
    language: "node",
    callPatterns: [
      { methodChain: "models.generateContent", operationType: "chat" },
      { methodChain: "generateContent", operationType: "chat" },
      { methodChain: "models.generateContentStream", operationType: "chat" },
      { methodChain: "generateContentStream", operationType: "chat" },
      // Embeddings (mirrors Google GenAI gap)
      { methodChain: "models.embedContent", operationType: "embed" },
      { methodChain: "embedContent", operationType: "embed" },
      { methodChain: "sendMessage", operationType: "chat" },
      { methodChain: "sendMessageStream", operationType: "chat" },
      { methodChain: "models.countTokens", operationType: "tool" },
      { methodChain: "countTokens", operationType: "tool" },
      { methodChain: "createChat", operationType: "chat", method: "createChat (Revenium VertexAIController)" },
    ],
    instrumentationImports: [
      "@revenium/middleware/google/vertex",
    ],
  },
  {
    provider: "perplexity",
    displayName: "Perplexity",
    // Perplexity uses the OpenAI client pointed at api.perplexity.ai. Detection
    // is via the Revenium middleware import — leaving packageNames empty
    // prevents false positives across every OpenAI/Anthropic file.
    packageNames: [],
    language: "node",
    callPatterns: [],
    instrumentationImports: [
      "@revenium/middleware/perplexity",
    ],
  },
  {
    provider: "azure-openai",
    displayName: "Azure OpenAI",
    packageNames: ["@azure/openai"],
    language: "node",
    callPatterns: [
      { methodChain: "chat.completions.create", operationType: "chat" },
      { methodChain: "chat.completions.stream", operationType: "chat" },
      { methodChain: "completions.create", operationType: "completion" },
      { methodChain: "embeddings.create", operationType: "embed" },
      { methodChain: "images.generate", operationType: "image" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "vercel-ai",
    displayName: "Vercel AI SDK",
    packageNames: ["ai"],
    language: "node",
    callPatterns: [
      // Text + structured output
      { methodChain: "generateText", operationType: "chat" },
      { methodChain: "streamText", operationType: "chat" },
      { methodChain: "generateObject", operationType: "chat" },
      { methodChain: "streamObject", operationType: "chat" },
      // Embeddings
      { methodChain: "embed", operationType: "embed" },
      { methodChain: "embedMany", operationType: "embed" },
      // Image generation (Vercel AI SDK ≥ 4.x)
      { methodChain: "generateImage", operationType: "image" },
      { methodChain: "experimental_generateImage", operationType: "image" },
      // Speech / transcription
      { methodChain: "generateSpeech", operationType: "audio" },
      { methodChain: "experimental_generateSpeech", operationType: "audio" },
      { methodChain: "transcribe", operationType: "audio" },
      { methodChain: "experimental_transcribe", operationType: "audio" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "langchain",
    displayName: "LangChain",
    packageNames: ["@langchain/core", "@langchain/openai", "@langchain/anthropic"],
    language: "node",
    callPatterns: [
      { methodChain: "invoke", operationType: "chat" },
      { methodChain: "stream", operationType: "chat" },
      { methodChain: "batch", operationType: "chat" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "fal-ai",
    displayName: "fal.ai",
    packageNames: ["@fal-ai/client"],
    language: "node",
    callPatterns: [
      { methodChain: "run", operationType: "image" },
      { methodChain: "subscribe", operationType: "image" },
      { methodChain: "stream", operationType: "image" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "aws-bedrock",
    displayName: "AWS Bedrock",
    packageNames: ["@aws-sdk/client-bedrock-runtime"],
    language: "node",
    callPatterns: [
      // Bedrock SDK uses Command pattern: client.send(new InvokeModelCommand(...))
      // We detect by the command class name in the AST (see ast helper).
      { methodChain: "send", operationType: "chat" },
    ],
    instrumentationImports: [],
  },
];
