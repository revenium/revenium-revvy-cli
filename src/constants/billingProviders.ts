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
      "Console accounts: an admin key (starts with sk-ant-admin). Claude Enterprise: an analytics key (starts with sk-ant-api01-) with read:analytics and read:spend_limits. Regular inference keys are refused.",
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
    value: "azure",
    label: "Azure OpenAI",
    credentialType: "json_credentials",
    placeholder: '{"tenantId":"...","clientId":"...","clientSecret":"...","subscriptionId":"..."}',
    helpText:
      "Provide an Entra ID service principal with Cost Management Reader on the subscription: tenantId, clientId, clientSecret and subscriptionId.",
  },
  {
    value: "vertex",
    label: "Google (Vertex AI)",
    credentialType: "json_credentials",
    placeholder: "Paste your service account JSON here...",
    helpText:
      'Paste the service account JSON key and add "billing_dataset": "<dataset>" naming the BigQuery dataset your standard usage cost export writes to (without it Revenium looks for "billing_export"). The service account needs BigQuery Data Viewer on that dataset and BigQuery Job User on its project, and the Cloud Billing API must be enabled.',
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    credentialType: "json_credentials",
    placeholder: '{"provisioningKey":"sk-or-v1-..."}',
    helpText:
      'Provide JSON with an OpenRouter provisioning key: {"provisioningKey":"sk-or-v1-..."}. OpenRouter serves cost data only to a provisioning (management) key — create one at openrouter.ai/settings/management-keys; a standard inference key is refused.',
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
      "Provide a fal.ai key created with the FULL preset, or a custom key with billing:usage:read, auth:keys:read, account:users:read and models:metrics:read. A legacy ADMIN key also works; a BILLING-only key syncs spend but reports 0 requests.",
  },
  {
    value: "openai_enterprise",
    label: "ChatGPT Enterprise",
    credentialType: "json_credentials",
    placeholder: '{"adminKey":"sk-admin-...","workspaceId":"12345678-1234-1234-1234-123456789012"}',
    helpText:
      "A workspace owner or admin creates an admin key in the OpenAI Admin Console (admin.openai.com, Credentials → Admin keys) for this workspace, with Custom permissions and \"Enterprise analytics usage\" set to Read. An OpenAI API Platform admin key is refused. One connection per workspace.",
  },
  {
    value: "cursor",
    label: "Cursor",
    credentialType: "api_key",
    placeholder: "Cursor team API key",
    helpText:
      "A Cursor team admin creates an API key with team usage read access at cursor.com/dashboard → Settings → Team → API Keys. Revenium reads the team's billed spend.",
  },
  {
    value: "github_copilot",
    label: "GitHub Copilot",
    credentialType: "json_credentials",
    placeholder: '{"token":"github_pat_...","orgName":"your-github-org"}',
    helpText:
      'Provide JSON with a fine-grained token whose resource owner is your organization, with "Organization Copilot metrics" and "Administration" read-only, plus the organization name.',
  },
];

export interface ProviderSyncMetadata {
  expectedMinutes: number;
  expectedTimeRange: string;
  historicalSyncMessage: string;
}

export const DAILY_REFRESH_NOTE =
  "After the initial backfill, provider spend refreshes once a day at midnight UTC.";

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
      "Google Cloud billing export data can take 6-12 hours to appear. Check back later.",
  },
  azure: {
    expectedMinutes: 960,
    expectedTimeRange: "8-24 hours",
    historicalSyncMessage:
      "Azure cost data typically appears within 8-24 hours (up to 72 hours on pay-as-you-go). Check back tomorrow.",
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
  cursor: {
    expectedMinutes: 10,
    expectedTimeRange: "10 minutes",
    historicalSyncMessage:
      "Cursor usage is read every 5 minutes; the first figures typically appear within 10 minutes.",
  },
  github_copilot: {
    expectedMinutes: 1440,
    expectedTimeRange: "24 hours",
    historicalSyncMessage:
      "GitHub publishes Copilot usage about a day late and Revenium refreshes it once daily, so today's numbers appear tomorrow.",
  },
  openai_enterprise: {
    expectedMinutes: 1440,
    expectedTimeRange: "24 hours",
    historicalSyncMessage:
      "ChatGPT Enterprise reports usage by day, so data can take up to 24 hours to appear.",
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
