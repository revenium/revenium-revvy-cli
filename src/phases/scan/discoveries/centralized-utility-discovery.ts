/**
 * Discovery of the customer's "shared AI utility" — the file (and ideally the
 * function) where most AI calls are concentrated. Large codebases typically
 * have 1-2 shared functions that all AI invocations go through.
 *
 * Strategy:
 *   1. Group all detected AI call sites by their containing file.
 *   2. The file with the highest count is the candidate, scored by the share
 *      of total calls it accounts for (>= 70% = high confidence, >= 40% =
 *      medium, otherwise low).
 *   3. For Node, the AST walker also records the enclosing function name, so
 *      we can surface "function X in file Y" when a single function dominates.
 */

import type { CallSite } from "../../../types/scan-result.js";
import type { CentralizedUtility } from "./types.js";

export interface CallSiteWithContext extends CallSite {
  /** Enclosing function name (Node only — discovered via AST). */
  enclosingFunction?: string;
}

interface DiscoverParams {
  callSites: CallSiteWithContext[];
}

// Real-world calibration: codebases that have an obvious shared utility
// usually concentrate 30-60% of AI calls in it, with the rest in specialized
// modules. We treat 30% as the floor for surfacing a candidate and 50% as
// the bar for high confidence.
const HIGH_CONFIDENCE_THRESHOLD = 0.5;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.3;

function classify(coverageRatio: number): CentralizedUtility["confidence"] {
  if (coverageRatio >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (coverageRatio >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

export function discoverCentralizedUtility({
  callSites,
}: DiscoverParams): { primary: CentralizedUtility | null; alternatives: CentralizedUtility[] } {
  if (callSites.length === 0) return { primary: null, alternatives: [] };

  // Group by file
  const byFile = new Map<string, CallSiteWithContext[]>();
  for (const site of callSites) {
    const existing = byFile.get(site.filePath) ?? [];
    existing.push(site);
    byFile.set(site.filePath, existing);
  }

  // Build candidates
  const candidates: CentralizedUtility[] = [];
  for (const [filePath, sites] of byFile.entries()) {
    const coverageRatio = sites.length / callSites.length;

    // Find dominant enclosing function (only meaningful when AST gave us names)
    let candidateFunction: string | undefined;
    const fnCounts = new Map<string, number>();
    for (const s of sites) {
      if (!s.enclosingFunction) continue;
      fnCounts.set(s.enclosingFunction, (fnCounts.get(s.enclosingFunction) ?? 0) + 1);
    }
    if (fnCounts.size > 0) {
      const sorted = [...fnCounts.entries()].sort((a, b) => b[1] - a[1]);
      const [topFn, topCount] = sorted[0]!;
      // Only surface the function name if it owns at least half of this
      // file's AI calls — otherwise the file is "scattered internally".
      if (topCount / sites.length >= 0.5) {
        candidateFunction = topFn;
      }
    }

    candidates.push({
      filePath,
      enclosedCallSites: sites.length,
      totalCallSites: callSites.length,
      coverageRatio,
      confidence: classify(coverageRatio),
      candidateFunction,
    });
  }

  // Rank by enclosed call sites (desc), then alphabetic for stability
  candidates.sort((a, b) => {
    if (b.enclosedCallSites !== a.enclosedCallSites)
      return b.enclosedCallSites - a.enclosedCallSites;
    return a.filePath.localeCompare(b.filePath);
  });

  const [primary, ...alternatives] = candidates;

  // Only treat the primary as a real "centralized utility" if confidence is
  // medium or high. If everything is low confidence, calls are genuinely
  // scattered and we should tell the user that.
  if (!primary || primary.confidence === "low") {
    return { primary: null, alternatives: candidates };
  }

  return { primary, alternatives: alternatives.slice(0, 4) };
}
