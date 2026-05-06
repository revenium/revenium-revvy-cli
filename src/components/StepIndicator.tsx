import { Box, Text } from "ink";
import { Phase, PHASE_LABELS } from "../types/revvy-state.js";
import { colors } from "../constants/colors.js";

interface StepIndicatorProps {
  currentPhase: Phase;
  phases?: Phase[];
}

export function StepIndicator({ currentPhase, phases }: StepIndicatorProps) {
  const displayPhases = phases ?? Object.values(Phase).filter((p) => p !== Phase.Complete);
  const currentIndex = displayPhases.indexOf(currentPhase as (typeof displayPhases)[number]);

  return (
    <Box marginBottom={1} gap={1}>
      {displayPhases.map((phase, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = phase === currentPhase;

        let indicator: string;
        let color: string;
        if (isComplete) {
          indicator = "●";
          color = colors.success;
        } else if (isCurrent) {
          indicator = "◉";
          color = colors.primary;
        } else {
          indicator = "○";
          color = colors.muted;
        }

        return (
          <Box key={phase} gap={0}>
            <Text color={color}>
              {indicator}{" "}
            </Text>
            <Text color={isCurrent ? colors.primary : isComplete ? colors.success : colors.muted} bold={isCurrent}>
              {PHASE_LABELS[phase]}
            </Text>
            {index < displayPhases.length - 1 && (
              <Text dimColor> → </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
