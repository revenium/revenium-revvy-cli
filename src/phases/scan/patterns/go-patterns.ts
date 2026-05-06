import type { ProviderPattern } from "./node-patterns.js";

export const GO_PATTERNS: ProviderPattern[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    packageNames: [
      "github.com/openai/openai-go",
      "github.com/openai/openai-go/v3",
      "github.com/sashabaranov/go-openai",
    ],
    language: "go",
    callPatterns: [
      // openai/openai-go: client.Chat().Completions().New(ctx, params)
      { methodChain: "Chat().Completions().New", operationType: "chat" },
      { methodChain: "Embeddings().New", operationType: "embed" },
      { methodChain: "Images().Generate", operationType: "image" },
      // sashabaranov/go-openai
      { methodChain: "CreateChatCompletion", operationType: "chat" },
      { methodChain: "CreateChatCompletionStream", operationType: "chat" },
      { methodChain: "CreateCompletion", operationType: "completion" },
      { methodChain: "CreateEmbeddings", operationType: "embed" },
      { methodChain: "CreateImage", operationType: "image" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-openai-go",
    ],
  },
  {
    provider: "anthropic",
    displayName: "Anthropic",
    packageNames: ["github.com/anthropics/anthropic-sdk-go"],
    language: "go",
    callPatterns: [
      { methodChain: "Messages().CreateMessage", operationType: "chat" },
      { methodChain: "Messages().New", operationType: "chat" },
      { methodChain: "Messages().Stream", operationType: "chat" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-anthropic-go",
    ],
  },
  {
    provider: "google-genai",
    displayName: "Google GenAI",
    packageNames: ["google.golang.org/genai"],
    language: "go",
    callPatterns: [
      { methodChain: "Models().GenerateContent", operationType: "chat" },
      { methodChain: "Models().GenerateContentStream", operationType: "chat" },
      { methodChain: "Chats().Create", operationType: "chat" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-google-go",
    ],
  },
  {
    provider: "vertex-ai",
    displayName: "Vertex AI",
    packageNames: ["cloud.google.com/go/vertexai"],
    language: "go",
    callPatterns: [
      { methodChain: "GenerateContent", operationType: "chat" },
      { methodChain: "GenerateContentStream", operationType: "chat" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-google-go",
    ],
  },
  {
    provider: "fal-ai",
    displayName: "fal.ai",
    packageNames: ["github.com/fal-ai/fal-go"],
    language: "go",
    callPatterns: [
      { methodChain: "GenerateImage", operationType: "image" },
      { methodChain: "Run", operationType: "image" },
      { methodChain: "Subscribe", operationType: "image" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-fal-go",
    ],
  },
  {
    provider: "runway-ml",
    displayName: "Runway ML",
    packageNames: ["github.com/runway-ai/sdk-go", "github.com/runwayml/sdk-go"],
    language: "go",
    callPatterns: [
      { methodChain: "ImageToVideo", operationType: "video" },
      { methodChain: "TextToVideo", operationType: "video" },
    ],
    instrumentationImports: [
      "github.com/revenium/revenium-middleware-runway-go",
    ],
  },
  {
    provider: "aws-bedrock",
    displayName: "AWS Bedrock",
    packageNames: ["github.com/aws/aws-sdk-go-v2/service/bedrockruntime"],
    language: "go",
    callPatterns: [
      { methodChain: "InvokeModel", operationType: "chat" },
      { methodChain: "InvokeModelWithResponseStream", operationType: "chat" },
      { methodChain: "Converse", operationType: "chat" },
      { methodChain: "ConverseStream", operationType: "chat" },
    ],
    instrumentationImports: [],
  },
];
