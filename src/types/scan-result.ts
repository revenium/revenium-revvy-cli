import type { SupportedLanguage } from "../constants/languages.js";
import type {
  CustomerCandidate,
  CentralizedUtility,
} from "../phases/scan/discoveries/types.js";

export interface DetectedProvider {
  name: string;
  displayName: string;
  packageName: string;
  version?: string;
}

export interface CallSite {
  filePath: string;
  lineNumber: number;
  provider: string;
  method: string;
  operationType:
    | "chat"
    | "embed"
    | "image"
    | "audio"
    | "video"
    | "completion"
    | "response"
    | "tool"
    | "other";
  snippet: string;
  /**
   * Name of the function that contains this AI call. Currently populated by
   * the Node AST walker only — used by centralized-utility-discovery to
   * surface "function X dominates the AI calls in file Y".
   */
  enclosingFunction?: string;
}

export interface ExistingInstrumentation {
  detected: boolean;
  packages: string[];
  callSites: CallSite[];
}

export interface ScanResult {
  language: SupportedLanguage;
  projectName?: string;
  providers: DetectedProvider[];
  callSites: CallSite[];
  existingInstrumentation: ExistingInstrumentation;
  totalFiles: number;
  filesWithAICalls: number;
  /** Auto-discovered customer ID expressions ranked by likelihood. */
  customerCandidates: CustomerCandidate[];
  /** Top-ranked centralized AI utility (file/function) — null if calls are scattered. */
  centralizedUtility: CentralizedUtility | null;
  /** Up to N runner-up centralized candidates, for "pick a different file" UX. */
  alternativeCentralizedUtilities: CentralizedUtility[];
}

export type {
  CustomerCandidate,
  CentralizedUtility,
} from "../phases/scan/discoveries/types.js";
