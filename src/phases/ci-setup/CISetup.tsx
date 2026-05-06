import { Box, Text } from "ink";
import { colors } from "../../constants/colors.js";
import { Question } from "../../components/Question.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useCISetup, type CISetupChoice } from "./useCISetup.js";
import type { CISetupResult } from "../../types/revvy-state.js";
import { FEATURE_FLAGS } from "../../feature-flags.js";

interface CISetupProps {
  targetDir: string;
  language: "node" | "python" | "go";
  /** Detected provider display names (e.g. "Anthropic", "OpenAI") — used to tailor editor rules. */
  detectedProviders?: readonly string[];
  onComplete: (result: CISetupResult) => void;
  onBack?: () => void;
}

function buildCIOptions(): Array<{ label: string; value: string; description?: string }> {
  const hasGH = FEATURE_FLAGS.CI_GITHUB_ACTIONS;
  const hasEditor = FEATURE_FLAGS.CI_EDITOR_RULES;
  const options: Array<{ label: string; value: string; description?: string }> = [];

  if (hasGH) {
    options.push({
      label: "Yes, add GitHub Actions workflow",
      value: "github",
      description: "Runs `revvy check` on every PR to flag uninstrumented AI calls before they merge.",
    });
  }
  if (hasEditor) {
    options.push({
      label: "Yes, add rules + agent for AI coding tools (Cursor, Claude Code, Gemini, Codex)",
      value: "editor",
      description: "Adds instrumentation rules + a Revvy agent prompt so AI assistants can run revvy on your behalf.",
    });
  }
  if (hasGH && hasEditor) {
    options.push({
      label: "Both — CI workflow + editor rules",
      value: "both",
      description: "Best coverage: CI catches missed calls in PRs, editor rules prevent them during development.",
    });
  }
  options.push({
    label: "Skip for now",
    value: "skip",
    description: "You can always run `revvy` again later to add these.",
  });

  return options;
}

export function CISetup({ targetDir, language, detectedProviders, onComplete, onBack: _onBack }: CISetupProps) {
  const { state, selectChoice } = useCISetup({ targetDir, language, detectedProviders, onComplete });

  // if both CI modules are disabled, auto-skip
  if (!FEATURE_FLAGS.CI_GITHUB_ACTIONS && !FEATURE_FLAGS.CI_EDITOR_RULES) {
    if (state.step === "choosing") {
      selectChoice("skip");
    }
  }

  if (state.step === "choosing") {
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>CI & Code Review Guardrails</Text>
          <Text dimColor>
            {"  "}Ensure new AI calls stay instrumented as your team grows.
          </Text>
        </Box>

        <Question
          type="select"
          label="Should I add checks to catch uninstrumented AI calls?"
          hint="These help prevent developers from adding raw AI calls without Revenium."
          options={buildCIOptions()}
          onSubmit={(value) => selectChoice(value as CISetupChoice)}
          hideEscHint
        />
      </Box>
    );
  }

  if (state.step === "generating") {
    return (
      <Box flexDirection="column" gap={1}>
        <Spinner label="Generating CI configuration..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {state.generatedFiles.map((file) => (
        <StatusLine
          key={file}
          icon="✓"
          label={`Created ${file}`}
          status="success"
        />
      ))}

      {state.error && (
        <StatusLine icon="✗" label={state.error} status="error" />
      )}

      {state.generatedFiles.some((f) => f.includes("github")) && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {"  "}The GitHub Action will run <Text color={colors.primary}>revvy check</Text> on
            every pull request and flag uninstrumented AI calls.
          </Text>
        </Box>
      )}

      {state.generatedFiles.some((f) => f.includes("rules/revenium")) && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {"  "}Editor rules will guide AI coding tools to always include
            Revenium instrumentation when writing AI calls.
          </Text>
        </Box>
      )}

      {state.generatedFiles.some((f) => f.includes("revvy-agent")) && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {"  "}Revvy agent prompt installed — AI assistants (Claude Code, Cursor)
            can now run <Text color={colors.primary}>revvy --non-interactive</Text> on your
            behalf to instrument new code automatically.
          </Text>
        </Box>
      )}

      <Text dimColor>{"  "}Press any key to continue...</Text>
    </Box>
  );
}
