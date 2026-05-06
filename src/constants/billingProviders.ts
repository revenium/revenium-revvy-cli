export interface BillingProviderInfo {
  value: string;
  label: string;
  credentialType: "api_key" | "json_credentials";
  placeholder: string;
  helpText: string;
}

export const BILLING_PROVIDERS: BillingProviderInfo[] = [
  {
    value: "openai",
    label: "OpenAI",
    credentialType: "api_key",
    placeholder: "sk-admin-...",
    helpText:
      "For full access to usage data, use an admin key (starts with sk-admin). Service keys (sk-...) have limited visibility.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    credentialType: "api_key",
    placeholder: "sk-ant-admin-...",
    helpText:
      "For full access to usage data, use an admin key (starts with sk-ant-admin). Regular keys have limited visibility.",
  },
  {
    value: "bedrock",
    label: "AWS Bedrock",
    credentialType: "json_credentials",
    placeholder: '{"accessKeyId":"AKIA...","secretAccessKey":"...","region":"us-east-1"}',
    helpText:
      "Provide AWS IAM credentials with Cost Explorer access (ce:GetCostAndUsage permission).",
  },
  {
    value: "vertex",
    label: "Google Vertex AI",
    credentialType: "json_credentials",
    placeholder: "Paste your service account JSON here...",
    helpText:
      "Upload your Google Cloud service account JSON. Requires 'BigQuery Data Viewer' and 'BigQuery Job User' roles.",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    credentialType: "json_credentials",
    placeholder: '{"apiKey":"sk-or-v1-..."}',
    helpText:
      'Provide JSON with your OpenRouter API key: {"apiKey":"sk-or-v1-..."}. Get your key from openrouter.ai/keys.',
  },
  {
    value: "litellm",
    label: "LiteLLM",
    credentialType: "json_credentials",
    placeholder: '{"apiKey":"sk-...","baseUrl":"https://your-proxy.com"}',
    helpText:
      "Provide your LiteLLM proxy API key and base URL.",
  },
  {
    value: "runway",
    label: "Runway",
    credentialType: "api_key",
    placeholder: "key_...",
    helpText:
      "Provide your Runway API key. Keys start with 'key_'. Requires $10 minimum credit purchase.",
  },
  {
    value: "fal",
    label: "fal.ai",
    credentialType: "api_key",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxxxxxxxxxx",
    helpText:
      "Provide your fal.ai ADMIN API key. Regular keys cannot access billing data.",
  },
];

export interface ProviderSyncMetadata {
  expectedMinutes: number;
  expectedTimeRange: string;
  historicalSyncMessage: string;
}

export const PROVIDER_SYNC_TIMES: Record<string, ProviderSyncMetadata> = {
  anthropic: {
    expectedMinutes: 5,
    expectedTimeRange: "5 minutes",
    historicalSyncMessage:
      "Anthropic data typically appears within 5 minutes.",
  },
  openai: {
    expectedMinutes: 20,
    expectedTimeRange: "15-30 minutes",
    historicalSyncMessage:
      "OpenAI data typically appears within 15-30 minutes.",
  },
  bedrock: {
    expectedMinutes: 1440,
    expectedTimeRange: "24 hours",
    historicalSyncMessage:
      "AWS Bedrock data typically appears within 24 hours. Check back tomorrow.",
  },
  vertex: {
    expectedMinutes: 480,
    expectedTimeRange: "6-12 hours",
    historicalSyncMessage:
      "Google Vertex AI data can take 6-12 hours to appear. Check back later.",
  },
  openrouter: {
    expectedMinutes: 5,
    expectedTimeRange: "5 minutes",
    historicalSyncMessage:
      "OpenRouter data typically appears within 5 minutes.",
  },
  litellm: {
    expectedMinutes: 5,
    expectedTimeRange: "5 minutes",
    historicalSyncMessage:
      "LiteLLM data typically appears within 5 minutes.",
  },
  runway: {
    expectedMinutes: 10,
    expectedTimeRange: "10 minutes",
    historicalSyncMessage:
      "Runway data typically appears within 10 minutes.",
  },
  fal: {
    expectedMinutes: 10,
    expectedTimeRange: "10 minutes",
    historicalSyncMessage:
      "fal.ai data typically appears within 10 minutes.",
  },
  default: {
    expectedMinutes: 10,
    expectedTimeRange: "5-10 minutes",
    historicalSyncMessage:
      "Your data will typically appear within 5-10 minutes.",
  },
};

export function getProviderSyncMetadata(provider: string): ProviderSyncMetadata {
  return PROVIDER_SYNC_TIMES[provider] ?? PROVIDER_SYNC_TIMES["default"]!;
}
