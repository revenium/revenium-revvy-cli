import { useState, useCallback } from "react";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";
import {
  getQuestionById,
  FIRST_QUESTION_ID,
  type QuestionDefinition,
  type QuestionContext,
} from "./questions.js";
import { buildMeteringDesign } from "./design-builder.js";

interface UseConsultationOptions {
  scanResult: ScanResult;
  onComplete: (design: MeteringDesign) => void;
}

interface ConsultationState {
  currentQuestionId: string;
  currentQuestion: QuestionDefinition | null;
  answers: Record<string, string | string[]>;
  questionHistory: string[];
  isComplete: boolean;
}

export function useConsultation({
  scanResult,
  onComplete,
}: UseConsultationOptions) {
  const [state, setState] = useState<ConsultationState>(() => {
    const firstQuestion = getQuestionById(FIRST_QUESTION_ID);
    return {
      currentQuestionId: FIRST_QUESTION_ID,
      currentQuestion: firstQuestion || null,
      answers: {},
      questionHistory: [FIRST_QUESTION_ID],
      isComplete: false,
    };
  });

  const submitAnswer = useCallback(
    (value: string | string[]) => {
      setState((prev) => {
        const newAnswers = {
          ...prev.answers,
          [prev.currentQuestionId]: value,
        };

        const ctx: QuestionContext = { answers: newAnswers, scanResult };

        // Determine next question
        const nextId = prev.currentQuestion?.getNext(ctx) || null;

        if (!nextId) {
          // Consultation complete
          const design = buildMeteringDesign(newAnswers, scanResult);
          // Use setTimeout to avoid state update during render
          setTimeout(() => onComplete(design), 0);
          return {
            ...prev,
            answers: newAnswers,
            isComplete: true,
          };
        }

        const nextQuestion = getQuestionById(nextId);

        // Check if we should skip this question
        if (nextQuestion?.shouldShow && !nextQuestion.shouldShow(ctx)) {
          const skipNextId = nextQuestion.getNext(ctx);
          if (!skipNextId) {
            const design = buildMeteringDesign(newAnswers, scanResult);
            setTimeout(() => onComplete(design), 0);
            return {
              ...prev,
              answers: newAnswers,
              isComplete: true,
            };
          }
          const skipNextQuestion = getQuestionById(skipNextId);
          return {
            currentQuestionId: skipNextId,
            currentQuestion: skipNextQuestion || null,
            answers: newAnswers,
            questionHistory: [...prev.questionHistory, skipNextId],
            isComplete: false,
          };
        }

        return {
          currentQuestionId: nextId,
          currentQuestion: nextQuestion || null,
          answers: newAnswers,
          questionHistory: [...prev.questionHistory, nextId],
          isComplete: false,
        };
      });
    },
    [scanResult, onComplete],
  );

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.questionHistory.length <= 1) {
        // at first question — can't go back within consultation
        return prev;
      }
      const newHistory = prev.questionHistory.slice(0, -1);
      const previousId = newHistory[newHistory.length - 1]!;
      const previousQuestion = getQuestionById(previousId);

      // remove the current question's answer
      const newAnswers = { ...prev.answers };
      delete newAnswers[prev.currentQuestionId];

      return {
        currentQuestionId: previousId,
        currentQuestion: previousQuestion || null,
        answers: newAnswers,
        questionHistory: newHistory,
        isComplete: false,
      };
    });
  }, []);

  return {
    currentQuestion: state.currentQuestion,
    answers: state.answers,
    questionNumber: state.questionHistory.length,
    isFirstQuestion: state.questionHistory.length <= 1,
    isComplete: state.isComplete,
    submitAnswer,
    goBack,
  };
}
