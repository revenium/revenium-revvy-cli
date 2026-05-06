import { Box, Text, useInput } from "ink";
import { colors } from "../../constants/colors.js";
import { Question } from "../../components/Question.js";
import { useConsultation } from "./useConsultation.js";
import {
  resolveLabel,
  resolveHint,
  resolveOptions,
  resolvePlaceholder,
  type QuestionContext,
} from "./questions.js";
import type { ScanResult } from "../../types/scan-result.js";
import type { MeteringDesign } from "../../types/metering-design.js";

interface ConsultationProps {
  scanResult: ScanResult;
  onComplete: (design: MeteringDesign) => void;
  onBack?: () => void;
}

export function Consultation({ scanResult, onComplete, onBack }: ConsultationProps) {
  const { currentQuestion, answers, questionNumber, isFirstQuestion, isComplete, submitAnswer, goBack } =
    useConsultation({ scanResult, onComplete });

  // escape key: go back to previous question, or to SetupMode if on Q1
  useInput((_input, key) => {
    if (key.escape && !isComplete) {
      if (isFirstQuestion) {
        onBack?.();
      } else {
        goBack();
      }
    }
  });

  if (isComplete) {
    return (
      <Box flexDirection="column">
        <Text bold color={colors.success}>
          Metering design complete!
        </Text>
        <Text dimColor>Generating your configuration...</Text>
      </Box>
    );
  }

  if (!currentQuestion) {
    return (
      <Text color={colors.error}>
        Error: No question found. Please report this issue.
      </Text>
    );
  }

  // Resolve dynamic labels/options/hints/placeholder against the current
  // scanResult + answers context.
  const ctx: QuestionContext = { answers, scanResult };
  const label = resolveLabel(currentQuestion, ctx);
  const hint = resolveHint(currentQuestion, ctx);
  const options = resolveOptions(currentQuestion, ctx);
  const placeholder = resolvePlaceholder(currentQuestion, ctx);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text bold>Metering Design</Text>
        <Text dimColor>(Question {questionNumber})</Text>
      </Box>

      {/* Intro + scan context summary */}
      {questionNumber === 1 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            We'll ask a few quick questions to understand how you want to track
            AI costs. Your answers help us generate the right configuration.
          </Text>
          <Text dimColor> </Text>
          <Text dimColor>
            Based on your codebase scan, we found{" "}
            <Text color={colors.primary}>{scanResult.providers.length}</Text> AI provider
            {scanResult.providers.length !== 1 ? "s" : ""} and{" "}
            <Text color={colors.primary}>{scanResult.callSites.length}</Text> AI call
            site{scanResult.callSites.length !== 1 ? "s" : ""}.
          </Text>
          {scanResult.customerCandidates.length > 0 && (
            <Text dimColor>
              Auto-detected{" "}
              <Text color={colors.primary}>{scanResult.customerCandidates.length}</Text>{" "}
              customer identification pattern
              {scanResult.customerCandidates.length !== 1 ? "s" : ""} we'll ask
              you to confirm.
            </Text>
          )}
          {scanResult.centralizedUtility && (
            <Text dimColor>
              A shared AI utility looks present at{" "}
              <Text color={colors.primary}>{scanResult.centralizedUtility.filePath}</Text>
              .
            </Text>
          )}
          <Text dimColor>
            Let's design how you want to track and attribute these costs.
          </Text>
        </Box>
      )}

      {currentQuestion.type === "text" && (
        <Question
          type="text"
          label={label}
          hint={hint}
          placeholder={placeholder}
          onSubmit={(value) => submitAnswer(value)}
        />
      )}

      {currentQuestion.type === "select" && options && (
        <Question
          type="select"
          label={label}
          hint={hint}
          options={options}
          onSubmit={(value) => submitAnswer(value)}
        />
      )}

      {currentQuestion.type === "multi-select" && options && (
        <Question
          type="multi-select"
          label={label}
          hint={hint}
          options={options}
          onSubmit={(values) => submitAnswer(values)}
        />
      )}
    </Box>
  );
}
