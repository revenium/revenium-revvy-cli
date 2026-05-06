import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { App } from "./app.js";
import { VERSION } from "./constants/version.js";
import { ENV_VARS } from "./constants/api.js";

const cli = yargs(hideBin(process.argv))
  .scriptName("revvy")
  .version(VERSION)
  .usage("$0 [command] [options]")
  .option("target-dir", {
    type: "string",
    description: "Target project directory",
    default: process.cwd(),
    global: true,
  })
  .command(
    "check",
    "Validate AI call instrumentation (middleware imports + usage_metadata coverage)",
    (yargs) =>
      yargs
        .option("ci", {
          type: "boolean",
          description: "Output GitHub Actions annotations",
          default: !!process.env.CI || !!process.env.GITHUB_ACTIONS,
        })
        .option("warn-only", {
          type: "boolean",
          description:
            "Always exit 0, even when unwrapped calls or regressions are found. Useful for initial rollout: surface findings without failing CI. Remove this flag to enforce blocking.",
          default: false,
        })
        .option("output-format", {
          type: "string",
          description: "Output format: text (default), json (supersedes --ci)",
          choices: ["text", "json"] as const,
          default: "text",
        }),
    async (argv) => {
      const { runCheck } = await import("./phases/ci-setup/check/runCheck.js");
      const { formatCheckResult, formatCheckResultJson } = await import("./phases/ci-setup/check/formatCheckResult.js");

      const result = await runCheck(argv.targetDir as string);
      const warnOnly = argv.warnOnly as boolean;

      // --output-format json supersedes --ci (they are mutually exclusive)
      if (argv.outputFormat === "json") {
        console.log(formatCheckResultJson(result, warnOnly));
      } else {
        console.log(formatCheckResult(result, argv.ci as boolean, warnOnly));
      }

      // In warn-only mode the check still RUNS and prints findings, but never
      // fails the process — so CI doesn't block. The banner emitted by the
      // formatter makes the soft-fail visible in the logs.
      if (warnOnly) {
        process.exit(0);
      }
      process.exit(result.passed ? 0 : 1);
    },
  )
  .command(
    "$0",
    "Interactive onboarding wizard (or non-interactive with --non-interactive)",
    (yargs) =>
      yargs
        .option("api-key", {
          type: "string",
          description: "Revenium Metering API key (or set REVENIUM_METERING_API_KEY env var). Not required for --dry-run.",
          default: process.env[ENV_VARS.API_KEY],
        })
        .option("base-url", {
          type: "string",
          description: "Revenium API base URL (or set REVENIUM_METERING_BASE_URL env var). For dev/staging environments.",
          default: process.env[ENV_VARS.BASE_URL],
        })
        .option("debug", {
          type: "boolean",
          description: "Enable debug logging",
          default: false,
        })
        .option("non-interactive", {
          type: "boolean",
          description: "Run without prompts (requires --setup-mode). Ideal for CI/CD and AI agents",
          default: false,
        })
        .option("setup-mode", {
          type: "string",
          description: "Setup mode: 'instrumentation' (imports only) or 'both' (imports + metering design)",
          choices: ["instrumentation", "both"] as const,
        })
        .option("customer-id-expression", {
          type: "string",
          description: "Code expression that returns the customer ID for the current request (e.g., req.user.orgId, req.user.customerId, request.headers.get('X-Customer-Id'))",
        })
        .option("customer-id-literal", {
          type: "string",
          description: "Customer ID as a literal constant (auto-quoted in generated code). Use this when there's no per-customer concept (CLI tool, internal app).",
        })
        .option("product-names", {
          type: "string",
          description: "Product names: comma-separated list or code expression (e.g., \"Product A,Product B\" or \"get_product()\")",
        })
        .option("agent-names", {
          type: "string",
          description: "Agent names: comma-separated list or code expression (e.g., \"support-bot,search-agent\")",
        })
        .option("centralized-utility", {
          type: "string",
          description: "Centralized AI utility file path, or 'none' to skip detection",
        })
        .option("skip-ci", {
          type: "boolean",
          description: "Skip CI guardrails and editor rules setup",
          default: false,
        })
        .option("dry-run", {
          type: "boolean",
          description: "Preview changes without writing any files (non-interactive only)",
          default: false,
        })
        .option("exclude", {
          type: "array",
          string: true,
          description: "Glob pattern to exclude from AI-call scanning (gitignore syntax). Repeatable. Combined with .gitignore and .revvyignore if those files exist in the target directory.",
        }),
    async (argv) => {
      const isTTY = process.stdout.isTTY && process.stdin.isTTY;

      // Mutual exclusion + literal handling apply to both interactive and non-interactive modes.
      const rawExpression = argv.customerIdExpression as string | undefined;
      const rawLiteral = argv.customerIdLiteral as string | undefined;

      if (rawExpression !== undefined && rawLiteral !== undefined) {
        console.error("Error: --customer-id-literal and --customer-id-expression are mutually exclusive.");
        console.error("  Use --customer-id-literal for a string constant (e.g., \"internal\").");
        console.error("  Use --customer-id-expression for a code expression (e.g., req.user.orgId).");
        process.exit(1);
      }

      // Bare-identifier warning for --customer-id-expression.
      const BARE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (rawExpression !== undefined && BARE_IDENTIFIER_RE.test(rawExpression)) {
        process.stderr.write(
          `⚠ --customer-id-expression "${rawExpression}" looks like a bare identifier. ` +
          `If you meant a literal string constant, use --customer-id-literal "${rawExpression}" instead. ` +
          `If you meant a code expression that resolves to a variable, you may need to escape the quotes ` +
          `('"${rawExpression}"') or use a more qualified expression (e.g., "req.user.${rawExpression}").\n`
        );
      }

      // --customer-id-literal: use JSON.stringify so values containing ", \, or newlines are escaped correctly.
      const resolvedCustomerIdExpression: string | undefined =
        rawLiteral !== undefined
          ? JSON.stringify(rawLiteral)
          : rawExpression;

      if (argv.nonInteractive) {
        const apiKey = argv.apiKey as string | undefined;
        const isDryRun = argv.dryRun as boolean;

        // API key required unless dry-run
        if (!apiKey && !isDryRun) {
          console.error("Error: --api-key required for non-interactive mode (unless --dry-run)");
          console.error("  Set REVENIUM_METERING_API_KEY env var or pass --api-key");
          process.exit(1);
        }

        const setupMode = (argv.setupMode as "instrumentation" | "both") || "instrumentation";
        if (!argv.setupMode) {
          process.stderr.write(`ℹ --setup-mode not specified, defaulting to "instrumentation"\n`);
        }

        const pipelineArgs = {
          apiKey,
          baseUrl: argv.baseUrl as string | undefined,
          targetDir: argv.targetDir as string,
          setupMode,
          customerIdExpression: resolvedCustomerIdExpression,
          productNames: argv.productNames as string | undefined,
          agentNames: argv.agentNames as string | undefined,
          centralizedUtility: argv.centralizedUtility as string | undefined,
          skipCi: argv.skipCi as boolean,
          dryRun: isDryRun,
          excludePatterns: argv.exclude as string[] | undefined,
        };

        // Non-TTY: use plain text output (no ANSI codes, no Ink)
        if (!isTTY) {
          const { runPipeline } = await import("./phases/non-interactive/runPipeline.js");
          try {
            await runPipeline(pipelineArgs);
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`✗ ${msg}`);
            process.exit(1);
          }
          return;
        }

        // TTY: use Ink for pretty output
        const { NonInteractiveRunner } = await import("./phases/non-interactive/NonInteractiveRunner.js");
        render(
          <NonInteractiveRunner
            args={{
              ...pipelineArgs,
              apiKey: pipelineArgs.apiKey ?? "",
            }}
          />,
        );
      } else {
        // Interactive mode requires a TTY
        if (!isTTY) {
          console.error("Non-interactive terminal detected. The interactive wizard requires a TTY.");
          console.error("");
          console.error("Run with --non-interactive instead:");
          console.error("  revvy --non-interactive --api-key $REVENIUM_METERING_API_KEY --setup-mode both");
          console.error("");
          console.error("Or preview changes first:");
          console.error("  revvy --non-interactive --setup-mode instrumentation --dry-run");
          process.exit(1);
        }

        render(
          <App
            apiKey={argv.apiKey as string | undefined}
            targetDir={argv.targetDir as string}
            debug={argv.debug as boolean}
          />,
        );
      }
    },
  )
  .example("$0", "Start the interactive setup wizard")
  .example(
    "$0 --non-interactive --api-key $KEY --setup-mode both",
    "Full non-interactive setup"
  )
  .example("$0 --non-interactive --api-key $KEY --setup-mode instrumentation --dry-run", "Preview changes without writing files")
  .example("$0 check", "Validate all AI calls are instrumented")
  .example("$0 check --ci", "CI mode with GitHub Actions annotations")
  .epilogue(
    "AI agents — read the agent guide BEFORE invoking the CLI. It covers the full flow,\n" +
    "  customer-id detection patterns, and the revvy check self-validation loop:\n" +
    "  https://github.com/revenium/revenium-revvy-cli/blob/main/docs/agent-guide.md\n" +
    "\n" +
    "  After 'revvy' runs in a project, the same guide is installed at .claude/revvy-agent.md\n" +
    "  (and .cursor/, .gemini/, .codex/) — agents in subsequent sessions discover it automatically."
  )
  .help()
  .alias("h", "help")
  .alias("v", "version")
  .strict();

cli.parse();
