export interface KeyValidationRule {
  adminPrefix?: string;
  pattern?: RegExp;
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
    adminPrefix: "sk-ant-admin",
    formatHint:
      "Admin keys start with 'sk-ant-admin'. Regular keys have limited billing visibility.",
    requiresAdmin: true,
  },
  openrouter: {
    pattern: /^\{[\s\S]*"apiKey"[\s\S]*\}$/,
    formatHint:
      'OpenRouter credentials must be JSON with an "apiKey" field: {"apiKey":"sk-or-v1-..."}',
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
      "fal.ai admin keys are in format 'uuid:hex' (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxxxxxxxxxx).",
    requiresAdmin: true,
  },
  bedrock: {
    pattern: /^\{[\s\S]*"accessKeyId"[\s\S]*"secretAccessKey"[\s\S]*"region"[\s\S]*\}$/,
    formatHint:
      'Bedrock credentials must be JSON: {"accessKeyId":"AKIA...","secretAccessKey":"...","region":"us-east-1"}',
    requiresAdmin: false,
  },
  vertex: {
    pattern: /^\{[\s\S]*"type"[\s\S]*"project_id"[\s\S]*"private_key"[\s\S]*\}$/,
    formatHint:
      "Vertex AI credentials must be a Google Cloud service account JSON with type, project_id, and private_key fields.",
    requiresAdmin: false,
  },
};

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
