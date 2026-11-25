/**
 * The closing "is metering active?" lines of a setup run. Built from the same
 * CheckResult `revvy check` uses: success is claimed only when that check
 * passes, so the two never disagree about whether metering is in place.
 */

import { runCheck, type CheckResult, type UnmeteredReason, type UnwrappedCallSite } from "./runCheck.js";
import { hasAutomaticTransform } from "../../instrument/constants/transform-registry.js";

export interface MeteringStatusLine {
  tone: "success" | "warning" | "detail";
  text: string;
}

export const CALL_SITE_NOTE = [
  "ℹ Revvy adds middleware imports, a TODO(revenium) where a client has to become the",
  "  wrapped one, and a reference comment, but does NOT modify your AI call sites —",
  "  that's left to you (or your AI coding agent), because static call-site mutation",
  "  across the SDK matrix is error-prone. See the comment block revvy inserted in the",
  "  modified file(s) for the exact metadata to pass to your AI calls.",
];

const MAX_LISTED = 5;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function listed(items: string[]): MeteringStatusLine[] {
  const shown = items.slice(0, MAX_LISTED).map((text) => ({ tone: "detail" as const, text: `    → ${text}` }));
  const hidden = items.length - shown.length;
  return hidden > 0 ? [...shown, { tone: "detail", text: `    … and ${hidden} more` }] : shown;
}

function siteList(sites: UnwrappedCallSite[]): MeteringStatusLine[] {
  return listed(sites.map((site) => `${site.filePath}:${site.lineNumber} — ${site.method}`));
}

function withReason(result: CheckResult, reason: UnmeteredReason): UnwrappedCallSite[] {
  return result.unwrapped.filter((site) => site.reason === reason);
}

function callsVerb(count: number, singular: string, pluralVerb: string): string {
  return count === 1 ? `1 call ${singular}` : `${count} calls ${pluralVerb}`;
}

function meteredCount(result: CheckResult): number {
  return result.wrappedCount - result.excludedCount;
}

function exclusionNote(result: CheckResult): MeteringStatusLine[] {
  if (result.excludedCount === 0) return [];
  return [{ tone: "detail", text: `  ${plural(result.excludedCount, "call")} excluded by .reveniumrc ${result.excludedCount === 1 ? "is" : "are"} not metered and not counted.` }];
}

function allMetered(result: CheckResult, keyUnverified: boolean): MeteringStatusLine[] {
  const calls = plural(meteredCount(result), "AI call");
  if (keyUnverified) {
    return [
      { tone: "warning", text: "⚠ Instrumentation in place, but the metering key was never verified." },
      { tone: "detail", text: `  ${calls} go through the Revenium middleware. Re-run once the API is reachable,` },
      { tone: "detail", text: "  or confirm the key yourself, before trusting that data is arriving." },
      ...exclusionNote(result),
    ];
  }
  return [
    { tone: "success", text: "✓ Basic metering active" },
    { tone: "detail", text: `  ${calls} go through the Revenium middleware; tokens, model and cost are tracked.` },
    ...exclusionNote(result),
  ];
}

function unmeteredDetails(result: CheckResult): MeteringStatusLine[] {
  const lines: MeteringStatusLine[] = [];

  const onSdkClient = withReason(result, "provider-sdk-client");
  if (onSdkClient.length > 0) {
    lines.push(
      { tone: "detail", text: `  ${callsVerb(onSdkClient.length, "uses", "use")} the provider SDK's own client, which the Revenium wrapper does not` },
      { tone: "detail", text: "  meter. Move each to the wrapped client; for an OpenAI or Perplexity client, the" },
      { tone: "detail", text: "  TODO(revenium) comment above its construction says how:" },
      ...siteList(onSdkClient),
    );
  }

  const noEquivalent = withReason(result, "no-wrapped-equivalent");
  if (noEquivalent.length > 0) {
    lines.push(
      { tone: "detail", text: `  ${callsVerb(noEquivalent.length, "is", "are")} an endpoint the Revenium wrapped client does not offer, so Revenium cannot meter it:` },
      ...siteList(noEquivalent),
    );
  }

  const withoutMiddleware = withReason(result, "no-middleware");
  if (withoutMiddleware.length > 0) {
    lines.push(
      hasAutomaticTransform(result.language)
        ? { tone: "detail", text: `  ${callsVerb(withoutMiddleware.length, "has", "have")} no Revenium middleware loaded:` }
        : { tone: "detail", text: `  ${callsVerb(withoutMiddleware.length, "has", "have")} no middleware: revvy has no automatic transform for ${result.language}, so it has to be added by hand:` },
      ...siteList(withoutMiddleware),
    );
  }

  if (result.instrumentationRegressions.length > 0) {
    lines.push(
      { tone: "detail", text: `  ${plural(result.instrumentationRegressions.length, "file")} no longer scan the way revvy recorded them, so their calls may be missing above:` },
      ...listed(result.instrumentationRegressions.map((r) => `${r.filePath} (${r.reason === "parse-failed" ? "does not parse" : "expected calls missing"})`)),
    );
  }

  if (result.providersWithoutMiddleware.length > 0) {
    lines.push(
      { tone: "detail", text: `  ${plural(result.providersWithoutMiddleware.length, "AI provider")} imported without its Revenium middleware:` },
      ...listed(result.providersWithoutMiddleware.map((p) => `${p.provider} (${p.packageName})`)),
    );
  }

  return lines;
}

export function describeMeteringStatus(result: CheckResult, keyUnverified: boolean): MeteringStatusLine[] {
  if (result.totalCallSites === 0 && result.instrumentationRegressions.length === 0) {
    return [
      { tone: "warning", text: "✗ Nothing is being metered: no AI calls were found." },
      { tone: "detail", text: "  Check that the target directory is the project that makes the AI calls." },
    ];
  }
  if (result.passed && meteredCount(result) === 0) {
    return [
      { tone: "warning", text: "✗ Nothing is being metered: every AI call is excluded by .reveniumrc." },
      ...exclusionNote(result),
    ];
  }
  if (result.passed) return allMetered(result, keyUnverified);

  const metered = meteredCount(result);
  const header: MeteringStatusLine = result.unwrappedCount === 0
    ? { tone: "warning", text: "⚠ Metering is not confirmed: `revvy check` fails on this project." }
    : metered > 0
      ? { tone: "warning", text: `⚠ Metering is active for only ${metered} of ${plural(result.totalCallSites - result.excludedCount, "AI call")}.` }
      : { tone: "warning", text: "⚠ Metering is NOT active yet." };

  return [
    header,
    ...unmeteredDetails(result),
    ...exclusionNote(result),
    { tone: "detail", text: "  `revvy check` lists the fix for each item and passes once every call is metered." },
  ];
}

export interface MeteringStatus {
  lines: MeteringStatusLine[];
  /** The check behind the lines; null when it could not run. */
  check: CheckResult | null;
}

/** Runs the check and describes it; a failing check never aborts the setup run that asked. */
export async function assessMeteringStatus(
  targetDir: string,
  excludePatterns: string[] | undefined,
  keyUnverified: boolean,
): Promise<MeteringStatus> {
  try {
    const check = await runCheck(targetDir, excludePatterns);
    return { lines: describeMeteringStatus(check, keyUnverified), check };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      lines: [
        { tone: "warning", text: `⚠ Could not work out which calls are metered: ${reason}` },
        { tone: "detail", text: "  Run `revvy check` to see the status." },
      ],
      check: null,
    };
  }
}
