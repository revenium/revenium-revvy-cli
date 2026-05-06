import { Box, Text } from "ink";
import { colors } from "../../constants/colors.js";
import { Question } from "../../components/Question.js";
import type { SetupMode as SetupModeType } from "../../types/revvy-state.js";

interface SetupModeProps {
  orgName?: string;
  onSelect: (mode: SetupModeType) => void;
}

export function SetupMode({ orgName, onSelect }: SetupModeProps) {
  return (
    <Box flexDirection="column" gap={1}>
      {orgName && (
        <Text dimColor>
          Logged in as <Text color={colors.primary}>{orgName}</Text>
        </Text>
      )}

      <Question
        type="select"
        label="What would you like to do?"
        hint="Choose how you'd like to get started with Revenium."
        options={[
          {
            label: "Connect billing providers",
            value: "billing",
            description:
              "Link your OpenAI, Anthropic, AWS, etc. accounts to see all AI spend in one dashboard. No code changes needed.",
          },
          {
            label: "Instrument your codebase",
            value: "instrumentation",
            description:
              "Scan your code for AI calls, design a metering model, then auto-add Revenium middleware imports and metadata.",
          },
          {
            label: "Both — connect providers first, then instrument code",
            value: "both",
            description:
              "Connect billing providers first for immediate spend visibility, then instrument your code for detailed per-call tracking.",
          },
        ]}
        onSubmit={(value) => onSelect(value as SetupModeType)}
      />
    </Box>
  );
}
