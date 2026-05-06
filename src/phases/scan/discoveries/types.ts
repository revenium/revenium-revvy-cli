/**
 * Auto-discovery output types — feed into the consultation phase so the
 * Revvy can confirm findings instead of asking blind text questions.
 */

export interface CustomerCandidate {
  /** Code expression the customer would use, e.g. `req.user.orgId`. */
  expression: string;
  /** How many distinct files this expression appears in. */
  filesFound: number;
  /** Total occurrences across all files. */
  occurrences: number;
  /** Best-guess source category for the metering design. */
  source: "auth-context" | "api-key" | "custom";
  /** Up to 3 example file paths, for display in confirmation prompts. */
  exampleFiles: string[];
}

export interface CentralizedUtility {
  /** Path (relative to target dir) where the utility lives. */
  filePath: string;
  /** Number of AI call sites that originate inside this file. */
  enclosedCallSites: number;
  /** Total AI call sites in the project. */
  totalCallSites: number;
  /** Ratio enclosedCallSites / totalCallSites. */
  coverageRatio: number;
  /** "high" >= 0.7, "medium" >= 0.4, otherwise "low". */
  confidence: "high" | "medium" | "low";
  /**
   * Node-only: name of the dominant enclosing function within the file
   * (when one function clearly owns most of the calls). Undefined for
   * Python/Go where we don't have function-level call-graph yet.
   */
  candidateFunction?: string;
}

export interface DiscoveryResult {
  customerCandidates: CustomerCandidate[];
  centralizedUtility: CentralizedUtility | null;
  alternativeCentralizedUtilities: CentralizedUtility[];
}
