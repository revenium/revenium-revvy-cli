/**
 * Shared helpers used by both Node and Python transform modules.
 * Extracted to avoid duplication and ensure bug fixes apply in both places.
 */

import type { MeteringDesign } from "./base-transform.js";

/**
 * Normalizes a string to lowercase alphanumerics only for agent name matching.
 */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Given a filename (basename without extension) and a list of agents, returns
 * the best-matching agent by longest normalized substring match. Falls back
 * to first agent (and signals a guess) if no match found.
 *
 * Returns { agent, guessed } where guessed=true means the comment should
 * note that the agent was inferred (not exact-matched).
 *
 * Single-agent special case: if the agent list has exactly one entry, the
 * value almost always came from `--agent-names` as an explicit literal
 * (or a single-item discovery). The "guessed from filename" annotation is
 * misleading in that case — there was no choice to make. Treat it as not
 * guessed.
 */
export function pickAgentForFile(
  agents: MeteringDesign["agents"],
  filePath?: string,
): { name: string; guessed: boolean } | null {
  if (agents.length === 0) return null;

  // Single agent → no inference happened; the value is the value.
  if (agents.length === 1) return { name: agents[0]!.name, guessed: false };

  // No filePath or empty string → fall back to first agent, mark as guessed
  if (!filePath) return { name: agents[0]!.name, guessed: true };

  // Derive basename without extension
  const baseName = filePath
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  const normBaseName = normalizeForMatch(baseName);

  // Empty basename (e.g., hidden file like ".env") → fall back, mark as guessed
  if (!normBaseName) return { name: agents[0]!.name, guessed: true };

  // Find longest agent name that matches (basename contains agent OR agent contains basename)
  let bestMatch: { name: string; len: number } | null = null;
  for (const agent of agents) {
    const normAgent = normalizeForMatch(agent.name);
    if (normBaseName.includes(normAgent) || normAgent.includes(normBaseName)) {
      if (!bestMatch || normAgent.length > bestMatch.len) {
        bestMatch = { name: agent.name, len: normAgent.length };
      }
    }
  }

  if (bestMatch) {
    return { name: bestMatch.name, guessed: false };
  }
  // Fallback: first agent, mark as guessed
  return { name: agents[0]!.name, guessed: true };
}

/**
 * Returns a human-readable agenticJobName placeholder based on the first
 * agent name. Helps developers understand what kind of context to pass.
 */
export function pickJobNamePlaceholder(agents: MeteringDesign["agents"]): string {
  if (agents.length === 0) return '"${workflow}: ${entity_id}"';
  const name = agents[0]!.name.toLowerCase();
  if (/support/.test(name)) return '"Support: ${ticket.subject}"';
  if (/(tool|gen|create)/.test(name)) return '"Tool generation: ${tool_name}"';
  if (/(research|search)/.test(name)) return '"Research: ${query}"';
  if (/review/.test(name)) return '"Review: ${item}"';
  return '"${workflow}: ${entity_id}"';
}
