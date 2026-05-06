/**
 * Feature flags to enable/disable Revvy modules.
 *
 * Flip these to control which flows are available to the user.
 * When only one module is enabled Revvy skips the routing
 * question and goes straight to that flow.
 */
export const FEATURE_FLAGS = {
  /** Step 6 — connect billing provider API keys (OpenAI, Anthropic, etc.) */
  BILLING_PROVIDERS: true,

  /** v0.1 flow — scan codebase, metering design, generate config, instrument */
  CODEBASE_INSTRUMENTATION: true,

  // ── CI & guardrails modules ──────────────────────────────────────────

  /** GitHub Actions workflow that runs `revvy check` on every PR */
  CI_GITHUB_ACTIONS: true,

  /** Editor rules for AI coding tools (.cursor/rules, .claude/rules) */
  CI_EDITOR_RULES: true,

  /** Detect 3P code review tools (CodeRabbit, Greptile) and suggest config */
  CI_3P_AGENT_DETECTION: true,

  // ── Python provider transforms ───────────────────────────────────────

  TRANSFORM_PYTHON_OPENAI: true,
  TRANSFORM_PYTHON_ANTHROPIC: true,
  TRANSFORM_PYTHON_OLLAMA: true,
  TRANSFORM_PYTHON_LITELLM: true,
  TRANSFORM_PYTHON_PERPLEXITY: true,
  TRANSFORM_PYTHON_GOOGLE_GENAI: true,

  // ── Node provider transforms ─────────────────────────────────────────

  TRANSFORM_NODE_OPENAI: true,
  TRANSFORM_NODE_ANTHROPIC: true,
  TRANSFORM_NODE_GOOGLE_GENAI: true,
  TRANSFORM_NODE_VERTEX_AI: true,
  TRANSFORM_NODE_PERPLEXITY: true,
} as const;
