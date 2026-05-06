import type { SupportedLanguage } from "./languages.js";

/**
 * Native AI provider SDK packages to detect in dependency files.
 * Aligned with the providers shown in the Revenium dashboard's "Choose your
 * stack" flow, plus a few extras we want to flag even when no Revenium
 * middleware exists yet.
 */
export const AI_PROVIDER_PACKAGES: Record<
  SupportedLanguage,
  Record<string, string>
> = {
  node: {
    openai: "OpenAI",
    "@anthropic-ai/sdk": "Anthropic",
    "@google/genai": "Google GenAI",
    "@google/generative-ai": "Google GenAI (legacy)",
    "@google-cloud/vertexai": "Vertex AI",
    "@aws-sdk/client-bedrock-runtime": "AWS Bedrock",
    "@azure/openai": "Azure OpenAI",
    "@langchain/core": "LangChain",
    "@langchain/openai": "LangChain (OpenAI)",
    "@langchain/anthropic": "LangChain (Anthropic)",
    "@fal-ai/client": "fal.ai",
    ai: "Vercel AI SDK",
  },
  python: {
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-genai": "Google GenAI",
    "google-generativeai": "Google GenAI (legacy)",
    "google-cloud-aiplatform": "Vertex AI",
    vertexai: "Vertex AI",
    litellm: "LiteLLM",
    ollama: "Ollama",
    boto3: "AWS Bedrock",
    langchain: "LangChain",
    "langchain-openai": "LangChain (OpenAI)",
    "langchain-anthropic": "LangChain (Anthropic)",
    crewai: "CrewAI",
    "fal-client": "fal.ai",
  },
  go: {
    "github.com/openai/openai-go": "OpenAI",
    "github.com/sashabaranov/go-openai": "OpenAI (sashabaranov)",
    "github.com/anthropics/anthropic-sdk-go": "Anthropic",
    "google.golang.org/genai": "Google GenAI",
    "cloud.google.com/go/vertexai": "Vertex AI",
    "github.com/aws/aws-sdk-go-v2/service/bedrockruntime": "AWS Bedrock",
    "github.com/fal-ai/fal-go": "fal.ai",
  },
};

/**
 * Revenium middleware/SDK packages to detect when checking for existing
 * instrumentation. Matches the canonical packages shipped by the Revenium
 * platform.
 */
export const REVENIUM_SDK_PACKAGES: Record<SupportedLanguage, string[]> = {
  node: ["@revenium/middleware"],
  python: [
    "revenium-python-sdk",
    "revenium-middleware",
    "revenium-middleware-openai",
    "revenium_middleware",
    "revenium_middleware_openai",
  ],
  go: [
    "github.com/revenium/revenium-middleware-openai-go",
    "github.com/revenium/revenium-middleware-anthropic-go",
    "github.com/revenium/revenium-middleware-google-go",
    "github.com/revenium/revenium-middleware-fal-go",
    "github.com/revenium/revenium-middleware-runway-go",
  ],
};
