import type { ProviderPattern } from "./node-patterns.js";

export const PYTHON_PATTERNS: ProviderPattern[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    packageNames: ["openai"],
    language: "python",
    callPatterns: [
      { methodChain: "chat.completions.create", operationType: "chat" },
      { methodChain: "completions.create", operationType: "completion" },
      { methodChain: "embeddings.create", operationType: "embed" },
      { methodChain: "images.generate", operationType: "image" },
      { methodChain: "responses.create", operationType: "response" },
      { methodChain: "audio.speech.create", operationType: "audio" },
      { methodChain: "audio.transcriptions.create", operationType: "audio" },
      // Legacy v0 SDK
      { methodChain: "ChatCompletion.create", operationType: "chat" },
      { methodChain: "Completion.create", operationType: "completion" },
    ],
    instrumentationImports: [
      "revenium_middleware.openai",
      "revenium_middleware_openai",
    ],
  },
  {
    provider: "anthropic",
    displayName: "Anthropic",
    packageNames: ["anthropic"],
    language: "python",
    callPatterns: [
      { methodChain: "messages.create", operationType: "chat" },
      { methodChain: "messages.stream", operationType: "chat" },
      { methodChain: "completions.create", operationType: "completion" },
    ],
    instrumentationImports: [
      "revenium_middleware.anthropic",
      "revenium_middleware_anthropic",
    ],
  },
  {
    provider: "google-genai",
    displayName: "Google GenAI",
    packageNames: ["google.genai", "google-genai", "google.generativeai", "google-generativeai"],
    language: "python",
    callPatterns: [
      { methodChain: "models.generate_content", operationType: "chat" },
      { methodChain: "generate_content", operationType: "chat" },
      { methodChain: "generate_content_stream", operationType: "chat" },
      { methodChain: "send_message", operationType: "chat" },
    ],
    instrumentationImports: [
      "revenium_middleware.google",
    ],
  },
  {
    provider: "vertex-ai",
    displayName: "Vertex AI",
    packageNames: ["vertexai", "google.cloud.aiplatform", "google-cloud-aiplatform"],
    language: "python",
    callPatterns: [
      { methodChain: "generate_content", operationType: "chat" },
      { methodChain: "generate_content_async", operationType: "chat" },
      { methodChain: "send_message", operationType: "chat" },
      { methodChain: "predict", operationType: "chat" },
    ],
    instrumentationImports: [
      "revenium_middleware.google",
    ],
  },
  {
    provider: "litellm",
    displayName: "LiteLLM",
    packageNames: ["litellm"],
    language: "python",
    callPatterns: [
      { methodChain: "litellm.completion", operationType: "chat" },
      { methodChain: "litellm.acompletion", operationType: "chat" },
      { methodChain: "completion", operationType: "chat" },
      { methodChain: "acompletion", operationType: "chat" },
      { methodChain: "embedding", operationType: "embed" },
      { methodChain: "image_generation", operationType: "image" },
    ],
    instrumentationImports: [
      "revenium_middleware.litellm",
      "revenium_middleware.litellm.client",
    ],
  },
  {
    provider: "ollama",
    displayName: "Ollama",
    packageNames: ["ollama"],
    language: "python",
    callPatterns: [
      { methodChain: "ollama.chat", operationType: "chat" },
      { methodChain: "ollama.generate", operationType: "chat" },
      { methodChain: "ollama.embeddings", operationType: "embed" },
      { methodChain: "chat", operationType: "chat" },
      { methodChain: "generate", operationType: "chat" },
    ],
    instrumentationImports: [
      "revenium_middleware.ollama",
    ],
  },
  {
    provider: "perplexity",
    displayName: "Perplexity",
    // Perplexity uses the OpenAI client pointed at api.perplexity.ai. Detection
    // requires the Revenium middleware import to disambiguate from real OpenAI
    // calls — leaving this empty prevents false positives in OpenAI files.
    packageNames: [],
    language: "python",
    callPatterns: [],
    instrumentationImports: [
      "revenium_middleware.perplexity",
    ],
  },
  {
    provider: "aws-bedrock",
    displayName: "AWS Bedrock",
    packageNames: ["boto3"],
    language: "python",
    callPatterns: [
      { methodChain: "invoke_model", operationType: "chat" },
      { methodChain: "invoke_model_with_response_stream", operationType: "chat" },
      { methodChain: "converse", operationType: "chat" },
      { methodChain: "converse_stream", operationType: "chat" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "langchain",
    displayName: "LangChain",
    packageNames: ["langchain", "langchain_openai", "langchain_anthropic", "langchain-openai", "langchain-anthropic"],
    language: "python",
    callPatterns: [
      { methodChain: "invoke", operationType: "chat" },
      { methodChain: "ainvoke", operationType: "chat" },
      { methodChain: "stream", operationType: "chat" },
      { methodChain: "astream", operationType: "chat" },
      { methodChain: "batch", operationType: "chat" },
    ],
    instrumentationImports: [],
  },
  {
    provider: "crewai",
    displayName: "CrewAI",
    packageNames: ["crewai"],
    language: "python",
    callPatterns: [
      { methodChain: "kickoff", operationType: "other" },
      { methodChain: "kickoff_async", operationType: "other" },
    ],
    instrumentationImports: [],
  },
];
