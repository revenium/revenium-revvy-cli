# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/revenium/revenium-revvy-cli/releases/tag/v0.1.0
