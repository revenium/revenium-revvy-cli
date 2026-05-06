import { useReducer, useCallback } from "react";
import {
  revvyReducer,
  createInitialState,
  type SetupMode,
  type HealthCheckResult,
  type InstrumentationSummary,
  type BillingProvidersResult,
  type CISetupResult,
  Phase,
} from "../types/revvy-state.js";
import type { ScanResult } from "../types/scan-result.js";
import type { MeteringDesign } from "../types/metering-design.js";

export function useRevvyState(
  apiKey?: string,
  targetDir?: string,
  debug?: boolean
) {
  const [state, dispatch] = useReducer(
    revvyReducer,
    createInitialState(apiKey, targetDir, debug)
  );

  const setApiKey = useCallback(
    (key: string) => dispatch({ type: "SET_API_KEY", apiKey: key }),
    []
  );

  const completeHealthCheck = useCallback(
    (result: HealthCheckResult) =>
      dispatch({ type: "HEALTH_CHECK_COMPLETE", result }),
    []
  );

  const selectSetupMode = useCallback(
    (mode: SetupMode) =>
      dispatch({ type: "SETUP_MODE_SELECTED", mode }),
    []
  );

  const completeBillingProviders = useCallback(
    (result: BillingProvidersResult) =>
      dispatch({ type: "BILLING_PROVIDERS_COMPLETE", result }),
    []
  );

  const completeScan = useCallback(
    (result: ScanResult) => dispatch({ type: "SCAN_COMPLETE", result }),
    []
  );

  const completeConsultation = useCallback(
    (design: MeteringDesign) =>
      dispatch({ type: "CONSULTATION_COMPLETE", design }),
    []
  );

  const completeGeneration = useCallback(
    (files: string[]) => dispatch({ type: "GENERATION_COMPLETE", files }),
    []
  );

  const completeInstrumentation = useCallback(
    (summary: InstrumentationSummary) =>
      dispatch({ type: "INSTRUMENTATION_COMPLETE", summary }),
    []
  );

  const completeCISetup = useCallback(
    (result: CISetupResult) =>
      dispatch({ type: "CI_SETUP_COMPLETE", result }),
    []
  );

  const goToPhase = useCallback(
    (phase: Phase) => dispatch({ type: "GO_TO_PHASE", phase }),
    []
  );

  const goBack = useCallback(
    () => dispatch({ type: "GO_BACK" }),
    []
  );

  const backToMenu = useCallback(
    () => dispatch({ type: "BACK_TO_MENU" }),
    []
  );

  return {
    state,
    dispatch,
    setApiKey,
    completeHealthCheck,
    selectSetupMode,
    completeBillingProviders,
    completeScan,
    completeConsultation,
    completeGeneration,
    completeInstrumentation,
    completeCISetup,
    goToPhase,
    goBack,
    backToMenu,
  };
}

export type RevvyStateActions = ReturnType<typeof useRevvyState>;
