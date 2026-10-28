export interface KeyValidationRule {
  adminPrefix?: string;
  pattern?: RegExp;
  requiredJsonKeys?: string[];
  jsonKeyPrefix?: { key: string; prefix: string };
  formatHint: string;
  requiresAdmin: boolean;
}

export const KEY_VALIDATION_RULES: Record<string, KeyValidationRule> = {
  openai: {
    adminPrefix: "sk-admin",
    formatHint:
      "Admin keys start with 'sk-admin'. Service keys (sk-...) have limited billing visibility.",
    requiresAdmin: true,
  },
  anthropic: {
    pattern: /^sk-ant-(admin|api01-)/,
    formatHint:
      "Console admin keys start with 'sk-ant-admin'; Claude Enterprise analytics keys start with 'sk-ant-api01-'. Inference keys are refused by the platform.",
    requiresAdmin: false,
  },
  openrouter: {
    requiredJsonKeys: ["provisioningKey"],
    jsonKeyPrefix: { key: "provisioningKey", prefix: "sk-or-v1-" },
    formatHint:
      'OpenRouter credentials must be JSON with a provisioning key: {"provisioningKey":"sk-or-v1-..."}. A standard inference key is refused — create a provisioning (management) key at openrouter.ai/settings/management-keys.',
    requiresAdmin: false,
  },
  runway: {
    adminPrefix: "key_",
    formatHint: "Runway API keys start with 'key_'.",
    requiresAdmin: false,
  },
  fal: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]+$/i,
    formatHint:
      "fal.ai keys are in format 'uuid:hex' (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxxxxxxxxxx). Use the FULL preset or a key with billing:usage:read, auth:keys:read, account:users:read and models:metrics:read.",
    requiresAdmin: false,
  },
  bedrock: {
    requiredJsonKeys: ["accessKeyId", "secretAccessKey", "region"],
    formatHint:
      'Bedrock credentials must be JSON: {"accessKeyId":"AKIA...","secretAccessKey":"...","region":"us-east-1"}',
    requiresAdmin: false,
  },
  azure: {
    requiredJsonKeys: ["tenantId", "clientId", "clientSecret", "subscriptionId"],
    formatHint:
      'Azure credentials must be JSON: {"tenantId":"...","clientId":"...","clientSecret":"...","subscriptionId":"..."}',
    requiresAdmin: false,
  },
  vertex: {
    requiredJsonKeys: ["type", "project_id", "private_key"],
    formatHint:
      "Vertex AI credentials must be a Google Cloud service account JSON with type, project_id, and private_key fields.",
    requiresAdmin: false,
  },
};

function hasJsonKeys(raw: string, rule: KeyValidationRule): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  const present = (key: string) => typeof obj[key] === "string" && obj[key].trim() !== "";
  if (!(rule.requiredJsonKeys ?? []).every(present)) return false;
  if (rule.jsonKeyPrefix) {
    return String(obj[rule.jsonKeyPrefix.key]).startsWith(rule.jsonKeyPrefix.prefix);
  }
  return true;
}

export interface KeyValidationResult {
  valid: boolean;
  warning?: string;
  error?: string;
}

/**
 * Validates a provider API key client-side before sending to the API.
 * Returns { valid: true } if the key looks correct, or an error/warning.
 */
export function validateProviderKey(
  provider: string,
  key: string,
): KeyValidationResult {
  const trimmed = key.trim();
  if (!trimmed) {
    return { valid: false, error: "API key cannot be empty." };
  }

  const rule = KEY_VALIDATION_RULES[provider];
  if (!rule) {
    return { valid: true };
  }

  if (rule.pattern && !rule.pattern.test(trimmed)) {
    return { valid: false, error: rule.formatHint };
  }

  if (rule.requiredJsonKeys && !hasJsonKeys(trimmed, rule)) {
    return { valid: false, error: rule.formatHint };
  }

  if (rule.adminPrefix && !trimmed.startsWith(rule.adminPrefix)) {
    if (rule.requiresAdmin) {
      return {
        valid: false,
        warning: `This doesn't look like an admin key. ${rule.formatHint}`,
      };
    }
    return { valid: false, error: rule.formatHint };
  }

  return { valid: true };
}
