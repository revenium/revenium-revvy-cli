# Revvy

[![npm version](https://img.shields.io/npm/v/@revenium/revvy.svg)](https://www.npmjs.com/package/@revenium/revvy)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Documentation](https://img.shields.io/badge/docs-revenium.io-blue)](https://docs.revenium.io)
[![Website](https://img.shields.io/badge/website-revenium.ai-blue)](https://www.revenium.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered CLI assistant for Revenium. Connects billing providers, instruments codebases with metering, and more.

## For AI coding agents

If you're an AI assistant (Claude Code, Cursor, Copilot, etc.) and the user asked you to instrument their codebase with Revenium, **read the agent guide before invoking the CLI**. The guide covers:
- The mechanical instrumentation flow — how to detect the customer ID across different web frameworks, the conditional CLI args, the `revvy check` self-validation loop
- **The "AI Outcomes design" conversation you should lead with the developer after the basic instrumentation lands** — using your codebase context to design a meaningful `taskType` / `traceId` / Job ID strategy. This is where the deepest customer value comes from (per-workflow analytics, per-outcome ROI), and it's expected to be part of what you do — not a side quest.

- **Agent guide**: [`src/phases/ci-setup/templates/agentPrompt.ts`](src/phases/ci-setup/templates/agentPrompt.ts) (the same content gets installed into the user's project at `.claude/revvy-agent.md`, `.cursor/...`, `.gemini/...`, `.codex/...` after the first revvy run)
- **Run non-interactively**: `npx @revenium/revvy --non-interactive --setup-mode instrumentation --customer-id-expression <expr>` (set `REVENIUM_METERING_API_KEY` in env, or pass `--api-key`)
- **Preview before applying**: add `--dry-run`
- **Validate after instrumenting**: `npx @revenium/revvy check`

## Validating instrumentation

`revvy check` (or `npx @revenium/revvy check`) verifies every AI call site in the current project is wrapped by Revenium middleware. Useful as a pre-commit check, in CI, and as an iteration loop for AI agents (apply → check → fix → re-check).

```bash
revvy check                          # human-readable output, exits 1 on failure
revvy check --ci                     # GitHub Actions annotations
revvy check --ci --warn-only         # report findings, never fail (default for the generated PR workflow)
```

The CI setup phase wires this into a GitHub Actions workflow that runs in **warn-only mode by default** — findings appear as PR annotations but do not block merges, so initial rollout doesn't disrupt customer teams while gaps are still being discovered. Once instrumentation is complete, remove `--warn-only` from `.github/workflows/revenium-check.yml` to enforce blocking on unwrapped AI calls.

## Quick start

### Run via npm (recommended)

```bash
cd /path/to/your/project
npx @revenium/revvy
```

### Run from local source (for development / testing)

```bash
pnpm install
pnpm build
node ./bin/revvy.js
```

## Dev

```bash
pnpm dev          # watch mode
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm smoke        # headless scenario tests
```

## Architecture

```
src/
  app.tsx                  # Ink root — routes between phases
  cli.tsx                  # yargs entry
  feature-flags.ts         # Toggle modules on/off
  constants.ts             # API URLs, providers, sync times
  hooks/use-revvy-state.ts # State management (useReducer)
  types/revvy-state.ts     # Phases, state, actions, reducer
  phases/
    health-check/          # API key + connectivity
    setup-mode/            # Choose: billing providers / instrumentation / both
    billing-providers/     # Link provider API keys (OpenAI, Anthropic, etc.)
    scan/                  # AST detection of AI SDKs + call sites
    consultation/          # Q&A to design metering model
    generate/              # EJS templates → revenium-config.{ts,py}
    instrument/            # Code transforms per language × provider
    verify/                # POST test metering event
    ci-setup/              # GitHub Actions + editor rules + revvy check
    complete/              # Summary + next steps + 3P agent detection
  components/              # Banner, StepIndicator, Question, Spinner, StatusLine
```
