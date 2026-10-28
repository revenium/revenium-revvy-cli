# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2026-10-28

### Fixed

- Go projects: detect raw `openai-go`, `anthropic-sdk-go` and `genai` call chains, name the provider by its canonical key, and suggest the `github.com/revenium/revenium-go-sdk/<provider>` module instead of the Node package or the deprecated `revenium-middleware-*-go` modules
- Node: Google GenAI and Vertex AI are wired through `GoogleGenAIController` / `VertexAIController`, Perplexity through `Initialize()` + `GetClient()`; files instrumented with `@revenium/middleware/fal` or `@revenium/middleware/litellm` are recognised as instrumented
- Python: canonical `import revenium_middleware.openai`, fal.ai detection and `revenium_middleware.fal`, and per-agent decorators that use the SDK's `revenium_metadata` scope so calls that do not forward `usage_metadata` are still attributed
- The post-onboarding dashboard link opens `/performance/traces` directly instead of a redirect
- Billing providers: Azure can be connected, Anthropic accepts Claude Enterprise analytics keys, fal.ai asks for a FULL-preset or scoped key, and the spend-refresh cadence (daily at midnight UTC after the initial backfill) is stated
- Duplicate provider credentials are reported with the platform's own message (the API answers 400, not 409)
- Go projects get a Go config helper (`revenium/config.go`, built on `core.WithUsageMetadata`), Go editor rules and a `go get` install line, instead of a TypeScript helper and Node rules
- `revvy check` on a Python project suggests `import revenium_middleware.<provider>` rather than a Node subpath
- The pip install line covers fal.ai, Vertex AI and LangChain extras, and the npm line adds `@fal-ai/client`
- The generated Python helper loads `.env` before the middleware imports, so the metering key is picked up without the app wiring `python-dotenv` itself
- A `.revvy-backup` is written only for files revvy actually changed
- JSON provider credentials (Azure, Bedrock, Vertex, OpenRouter) are checked by their keys, not by key order
- A Go file that imports only the Revenium wrapper has its calls scanned; raw `bedrockruntime` calls are no longer counted as wrapped by an Anthropic wrapper import in the same file; Python fal.ai calls are matched through `fal_client.*`, so `subprocess.run` is not reported as an image call
- The Node Perplexity transform no longer injects a module-scope `Initialize()`, which throws on import when the keys are not set
- The generated Python helper imports `revenium_metadata`, `wraps` and `Callable` only when it renders the per-agent decorators that use them
- Generated Go constants are valid for any product or agent name (names are escaped as Go string literals and identifiers are made unique), and a Bedrock-only Go project is told to install the Anthropic module

### Changed

- Agent guide: write key per SDK (`REVENIUM_WRITE_API_KEY` on Python, the metering key itself on Node, `JobClientConfig` on Go), outcome `404` retry only built into the Python SDK, metering limit of 100 req/s per key, `agenticJobId` character rules, reserved metric key `reported_value`, strict-ingestion `422` codes and the ingestion-failures endpoint, Go SDK module list and floors, and a per-SDK field matrix that includes Go

## [1.0.1] - 2026-08-25

### Fixed

- Verify the metering key against the Revenium API before reporting setup success, so a rejected key no longer produces a false "setup complete" result
- Refresh the agent curriculum, CI agent prompt, and generated configuration templates to match the current Revenium API
- Report the correct version in `revvy --version` and in the startup banner, which were both stuck at `0.1.0`

## [1.0.0] - 2026-05-07

### Changed

- Promote to stable 1.0.0 release

## [0.1.0] - 2026-05-06

### Added

- Initial release of `@revenium/revvy`, an AI-powered CLI assistant for Revenium
- Interactive setup wizard with phases: health check, setup-mode selection, billing-provider linking, AI SDK scan, consultation, code generation, instrumentation, verification, and CI setup
- AST-based detection of AI SDK call sites across JavaScript, TypeScript, Python, and Go projects
- Automatic code instrumentation for OpenAI, Anthropic, and Google AI providers via `@revenium/middleware`
- `revvy check` self-validation command for verifying instrumentation completeness
  - Human-readable output (default)
  - GitHub Actions annotations (`--ci`)
  - Warn-only mode for non-blocking PR checks (`--ci --warn-only`)
- Generated GitHub Actions workflow installs `revvy check` in warn-only mode by default for gradual rollout
- Non-interactive mode (`--non-interactive`) for AI agents and automation
- Editor-rule installation for Claude Code, Cursor, Gemini, and Codex agents
- Dry-run mode (`--dry-run`) to preview changes without writing files
- Test metering event verification before marking setup complete

[1.0.2]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.2
[1.0.1]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.1
[1.0.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.0
[0.1.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v0.1.0
