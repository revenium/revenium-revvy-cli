#!/usr/bin/env tsx
/**
 * Renders the agent prompt template to docs/agent-guide.md.
 * Run: pnpm build:docs (or npx tsx scripts/build-agent-guide.ts)
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const { AGENT_PROMPT } = await import("../src/phases/ci-setup/templates/agentPrompt.js");

const outPath = join(root, "docs", "agent-guide.md");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, AGENT_PROMPT, "utf-8");

console.log(`✓ docs/agent-guide.md (${AGENT_PROMPT.split("\n").length} lines)`);
