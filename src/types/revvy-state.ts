import type { MeteringDesign } from "./metering-design.js";
import type { ScanResult } from "./scan-result.js";
import { FEATURE_FLAGS } from "../feature-flags.js";

export enum Phase {
  HealthCheck = "health-check",
  SetupMode = "setup-mode",
  BillingProviders = "billing-providers",
  Scan = "scan",
  Consultation = "consultation",
  Generate = "generate",
  Instrument = "instrument",
  CISetup = "ci-setup",
  Complete = "complete",
}

/** Full ordered list of every possible phase. */
export const PHASE_ORDER: Phase[] = [
  Phase.HealthCheck,
  Phase.SetupMode,
  Phase.BillingProviders,
  Phase.Scan,
  Phase.Consultation,
  Phase.Generate,
  Phase.Instrument,
  Phase.CISetup,
  Phase.Complete,
];

export const PHASE_LABELS: Record<Phase, string> = {
  [Phase.HealthCheck]: "Health Check",
  [Phase.SetupMode]: "Setup Mode",
  [Phase.BillingProviders]: "Billing Providers",
  [Phase.Scan]: "Codebase Scan",
  [Phase.Consultation]: "Metering Design",
  [Phase.Generate]: "Config Generation",
  [Phase.Instrument]: "Instrumentation",
  [Phase.CISetup]: "CI Setup",
  [Phase.Complete]: "Complete",
};

export type SetupMode = "billing" | "instrumentation" | "both";

/**
 * Returns the phases to show in the step indicator for a given setup mode.
 * Always excludes Complete (it has its own screen).
 */
export function getActivePhases(mode: SetupMode | null): Phase[] {
  if (!mode) {
    return [Phase.HealthCheck];
  }
  switch (mode) {
    case "billing":
      return [Phase.HealthCheck, Phase.BillingProviders, Phase.CISetup];
    case "instrumentation":
      return [
        Phase.HealthCheck,
        Phase.Scan,
        Phase.Consultation,
        Phase.Generate,
        Phase.Instrument,
        Phase.CISetup,
      ];
    case "both":
      return [
        Phase.HealthCheck,
        Phase.BillingProviders,
        Phase.Scan,
        Phase.Consultation,
        Phase.Generate,
        Phase.Instrument,
        Phase.CISetup,
      ];
  }
}

export interface ProviderCredentialResult {
  provider: string;
  credentialName: string;
  success: boolean;
  validationStatus?: string;
  errorMessage?: string;
}

export interface BillingProvidersResult {
  credentials: ProviderCredentialResult[];
}

export interface HealthCheckResult {
  apiKeyValid: boolean;
  apiReachable: boolean;
  orgName?: string;
  teamId?: string;
  errorMessage?: string;
}

export interface InstrumentationSummary {
  filesModified: number;
  totalChanges: number;
  installCommand: string;
}

export interface CISetupResult {
  githubAction: boolean;
  editorRules: boolean;
  generatedFiles: string[];
}

export interface RevvyState {
  phase: Phase;
  apiKey?: string;
  targetDir: string;
  debug: boolean;
  setupMode: SetupMode | null;
  teamId: string | null;
  healthCheck: HealthCheckResult | null;
  billingProvidersResult: BillingProvidersResult | null;
  scanResult: ScanResult | null;
  meteringDesign: MeteringDesign | null;
  generatedFiles: string[];
  instrumentationSummary: InstrumentationSummary | null;
  ciSetupResult: CISetupResult | null;
}

export type RevvyAction =
  | { type: "SET_API_KEY"; apiKey: string }
  | { type: "HEALTH_CHECK_COMPLETE"; result: HealthCheckResult }
  | { type: "SETUP_MODE_SELECTED"; mode: SetupMode }
  | { type: "BILLING_PROVIDERS_COMPLETE"; result: BillingProvidersResult }
  | { type: "SCAN_COMPLETE"; result: ScanResult }
  | { type: "CONSULTATION_COMPLETE"; design: MeteringDesign }
  | { type: "GENERATION_COMPLETE"; files: string[] }
  | { type: "INSTRUMENTATION_COMPLETE"; summary: InstrumentationSummary }
  | { type: "CI_SETUP_COMPLETE"; result: CISetupResult }
  | { type: "GO_TO_PHASE"; phase: Phase }
  | { type: "GO_BACK" }
  | { type: "BACK_TO_MENU" };

/**
 * Figures out which phase comes right after HealthCheck based on feature flags.
 * If only one module is enabled, skip the SetupMode question entirely.
 */
function phaseAfterHealthCheck(): { phase: Phase; autoMode: SetupMode | null } {
  const billing = FEATURE_FLAGS.BILLING_PROVIDERS;
  const instrumentation = FEATURE_FLAGS.CODEBASE_INSTRUMENTATION;

  if (billing && instrumentation) {
    return { phase: Phase.SetupMode, autoMode: null };
  }
  if (billing) {
    return { phase: Phase.BillingProviders, autoMode: "billing" };
  }
  if (instrumentation) {
    return { phase: Phase.Scan, autoMode: "instrumentation" };
  }
  return { phase: Phase.SetupMode, autoMode: null };
}

function phaseAfterBillingProviders(mode: SetupMode): Phase {
  return mode === "both" ? Phase.Scan : Phase.CISetup;
}

export function revvyReducer(
  state: RevvyState,
  action: RevvyAction
): RevvyState {
  switch (action.type) {
    case "SET_API_KEY":
      return {
        ...state,
        apiKey: action.apiKey || undefined,
        healthCheck: action.apiKey ? state.healthCheck : null,
      };

    case "HEALTH_CHECK_COMPLETE": {
      if (!action.result.apiKeyValid) {
        return { ...state, healthCheck: action.result, phase: Phase.HealthCheck };
      }
      const { phase, autoMode } = phaseAfterHealthCheck();
      return {
        ...state,
        healthCheck: action.result,
        teamId: action.result.teamId ?? null,
        phase,
        setupMode: autoMode ?? state.setupMode,
      };
    }

    case "SETUP_MODE_SELECTED": {
      const nextPhase =
        action.mode === "billing" || action.mode === "both"
          ? Phase.BillingProviders
          : Phase.Scan;
      return { ...state, setupMode: action.mode, phase: nextPhase };
    }

    case "BILLING_PROVIDERS_COMPLETE":
      return {
        ...state,
        billingProvidersResult: action.result,
        phase: phaseAfterBillingProviders(state.setupMode ?? "billing"),
      };

    case "SCAN_COMPLETE":
      return {
        ...state,
        scanResult: action.result,
        phase: Phase.Consultation,
      };

    case "CONSULTATION_COMPLETE":
      return {
        ...state,
        meteringDesign: action.design,
        phase: Phase.Generate,
      };

    case "GENERATION_COMPLETE":
      return {
        ...state,
        generatedFiles: action.files,
        phase: Phase.Instrument,
      };

    case "INSTRUMENTATION_COMPLETE":
      return {
        ...state,
        instrumentationSummary: action.summary,
        phase: Phase.CISetup,
      };

    case "CI_SETUP_COMPLETE":
      return {
        ...state,
        ciSetupResult: action.result,
        phase: Phase.Complete,
      };

    case "GO_TO_PHASE":
      return { ...state, phase: action.phase };

    case "GO_BACK": {
      const activePhases = getActivePhases(state.setupMode);
      const currentIdx = activePhases.indexOf(state.phase);
      if (currentIdx <= 0) {
        return { ...state, phase: Phase.SetupMode };
      }
      return { ...state, phase: activePhases[currentIdx - 1]! };
    }

    case "BACK_TO_MENU":
      return {
        ...state,
        phase: Phase.SetupMode,
        setupMode: null,
        billingProvidersResult: null,
        scanResult: null,
        meteringDesign: null,
        generatedFiles: [],
        instrumentationSummary: null,
        ciSetupResult: null,
      };

    default:
      return state;
  }
}

export function createInitialState(
  apiKey?: string,
  targetDir: string = process.cwd(),
  debug: boolean = false
): RevvyState {
  return {
    phase: Phase.HealthCheck,
    apiKey,
    targetDir,
    debug,
    setupMode: null,
    teamId: null,
    healthCheck: null,
    billingProvidersResult: null,
    scanResult: null,
    meteringDesign: null,
    generatedFiles: [],
    instrumentationSummary: null,
    ciSetupResult: null,
  };
}
