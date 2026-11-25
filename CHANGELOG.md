# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-25

### Added

- Billing providers: ChatGPT Enterprise (workspace admin key + workspace ID), Cursor and GitHub Copilot can be connected from the interactive wizard, with local format checks and their real sync timings
- Agent guide: the full metering field set the SDKs and platform carry today — cache-TTL token buckets (5m/1h/12h), reasoning and streaming fields, failed-call and no-charge fields, coding-assistant client fields with the platform's caps, `inferenceGeo`, squads and service tiers — and a per-SDK matrix rebuilt from the published `@revenium/middleware` 2.1.0, `revenium-python-sdk` 0.16.1 and `revenium-go-sdk` 1.1.9
- Agent guide: a complete job-type economics declaration (unit of work, monetization, overhead, dimensions), period facts and the versioned pre-AI baseline

### Changed

- Node projects on `@google/genai` are instrumented with a side-effect import of `@revenium/middleware/google/genai` (2.1.0 meters the app's own client) instead of a controller rewrite; files that `require()` the SDK get a `require`, files from an earlier revvy run are upgraded, and the older `@google/generative-ai` SDK keeps the controller
- Agent guide: rate limits now cover the per-key edge limit on the management API, the per-account metering ceiling and the per-key-and-team error-pattern limit; strict ingestion is described as answering `201` and listing rejections under ingestion-failures; write keys owned by a Member or Department Admin are named as a cause of outcome `403`s
- Agent guide: the OpenAI/Azure cache-token convention and the canonical `Bedrock` provider value; Node 2.1.0 and Python 0.14.0 upgrade notes

### Fixed

- Node OpenAI and Perplexity projects are no longer reported as metered while their calls still run on the raw SDK client: each raw client gets a `TODO(revenium)` naming the wrapped-client change, and the run summary and `revvy check` count those calls as not metered until it is made; the earlier release's unused `GetClient` binding and duplicate `Initialize()` are removed on rerun
- Python apps meter with the key in `.env` and no other change (`.env` is loaded before the first middleware import); `revvy check` fails a Python project whose running code never imports the middleware; PEP 8 spacing is preserved
- `--base-url` reaches the generated `.env` (`REVENIUM_METERING_BASE_URL`) and the interactive wizard, so non-production onboardings no longer meter to production; `.env` is merged, never overwritten
- `.env` and `*.revvy-backup` are added to `.gitignore`, and backups keep the original file's permissions
- A rerun backs up any generated file the developer edited instead of silently overwriting it, and reports Created / Updated / Unchanged
- A folder with no AI calls gets no files and exits 1
- Snippets carry the product and agent given to revvy, use the project's language (Go gets Go), and import the helper by a path that resolves; the helpers accept `agenticJobType`, `agenticJobVersion` and `environment`; `revvy check` recognises Go calls whose context carries usage metadata
- The dry run prints every generated file in full; the agent guide documents `--base-url` and `check --output-format json`, corrects Quick Start step 3, and fixes the Node outcomes snippet (`initializeConfig()` and `REVENIUM_TEAM_ID`)
- The agent guide and `--setup-mode` help no longer claim `both` connects billing providers in non-interactive mode
- Vertex AI help text names the `billing_dataset` key and the BigQuery prerequisites

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

[1.1.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.1.0
[1.0.2]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.2
[1.0.1]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.1
[1.0.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v1.0.0
[0.1.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v0.1.0
