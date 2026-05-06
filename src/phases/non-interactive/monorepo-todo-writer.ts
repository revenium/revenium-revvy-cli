/**
 * In a monorepo layout, file placements that are obvious in a single-package
 * project (`.env` at repo root, `src/revenium-config.ts` at repo root) are
 * almost always wrong — the runtime `.env` lives in `apps/<app>/.env` and the
 * config helper belongs inside whichever workspace package owns the AI calls.
 *
 * Rather than guess, revvy refuses to write those files in a monorepo and
 * instead drops a `revenium-monorepo-todo.md` at the repo root with the
 * exact contents the agent should place at locations the agent picks.
 */
import { join } from "path";
import { writeFile } from "fs/promises";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { PackageManagerInfo } from "../../utils/package-manager.js";
import { renderTemplate } from "../../utils/template-engine.js";
import { buildEnvContent } from "../../utils/env-helpers.js";
import { getInstallCommand } from "../instrument/instrumenter.js";

import nodeTemplate from "../generate/templates/node-ts/revenium-config.ts.ejs";
import pythonTemplate from "../generate/templates/python/revenium_config.py.ejs";

interface MonorepoTodoArgs {
  targetDir: string;
  design: MeteringDesign;
  pmInfo: PackageManagerInfo;
  apiKey: string;
}

const TODO_FILENAME = "revenium-monorepo-todo.md";

export function getMonorepoTodoFilename(): string {
  return TODO_FILENAME;
}

export async function writeMonorepoTodo(args: MonorepoTodoArgs): Promise<string> {
  const { targetDir, design, pmInfo, apiKey } = args;
  const path = join(targetDir, TODO_FILENAME);
  const content = buildMonorepoTodoContent(design, pmInfo, apiKey);
  await writeFile(path, content, "utf-8");
  return path;
}

export function buildMonorepoTodoContent(
  design: MeteringDesign,
  pmInfo: PackageManagerInfo,
  apiKey: string,
): string {
  const isPython = design.detectedLanguage === "python";
  const helperFilename = isPython ? "revenium_config.py" : "revenium-config.ts";
  const template = isPython ? pythonTemplate : nodeTemplate;
  const helperContent = renderTemplate(template, {
    providers: design.detectedProviders,
    organization: design.organization,
    products: design.products,
    agents: design.agents,
    taskTypes: design.taskTypes,
    trackingGoal: design.trackingGoal,
    outcomeTracking: design.outcomeTracking,
    centralizedCallPattern: design.centralizedCallPattern,
  });

  // Redact the API key in the env block — the real .env should be written
  // by the agent, but the example shouldn't paste a live key into a markdown
  // file that may end up in source control.
  const envSample = buildEnvContent(apiKey).replace(
    /REVENIUM_METERING_API_KEY=.+/,
    "REVENIUM_METERING_API_KEY=<your-metering-key>",
  );

  const installCmd = getInstallCommand(design, pmInfo);

  return `# Revenium — Monorepo Setup TODO

Revvy detected a **${pmInfo.manager} monorepo** in this repository, so it intentionally **did NOT write \`.env\` or the config helper at the repo root** — those almost always belong inside a specific workspace package, and the wrong choice silently breaks runtime metering.

You (or your AI coding agent) need to place these files at the right locations. The contents below are correct as-is; only the *paths* depend on your repo layout.

---

## 1. Place the config helper inside the runtime workspace

The helper should live in whichever workspace package owns the AI call sites — for example \`packages/ai/src/${helperFilename}\` or \`apps/web/src/${helperFilename}\`. Pick the file that's closest to where your \`.create()\` calls live and that other files can import from.

\`\`\`${isPython ? "python" : "typescript"}
${helperContent.trimEnd()}
\`\`\`

## 2. Place the \`.env\` block inside the runtime workspace's env file

Your runtime application reads \`.env\` from one specific directory — usually \`apps/<app>/.env\` (or wherever the framework's loader points). Append the following block to that file (or merge with whatever is already there):

\`\`\`bash
${envSample.trimEnd()}
\`\`\`

> ⚠ Don't put this at the repo root unless your runtime actually loads \`.env\` from there. In a typical pnpm/yarn monorepo, the root \`.env\` is read at most by tooling, not by the runtime app.

## 3. Install the SDK in the right workspace

Don't run the install command at the repo root in a monorepo — scope it to the workspace package that owns the AI calls.

The detected install command is:

\`\`\`bash
${installCmd}
\`\`\`

For a ${pmInfo.manager} workspace, the scoped form is typically:

${pmInfo.manager === "pnpm" ? `\`\`\`bash
pnpm --filter <runtime-package-name> add @revenium/middleware${design.detectedLanguage === "node" ? " dotenv" : ""}
\`\`\`` : pmInfo.manager === "yarn" ? `\`\`\`bash
yarn workspace <runtime-package-name> add @revenium/middleware${design.detectedLanguage === "node" ? " dotenv" : ""}
\`\`\`` : pmInfo.manager === "bun" ? `\`\`\`bash
bun add @revenium/middleware${design.detectedLanguage === "node" ? " dotenv" : ""}   # run inside the runtime workspace dir
\`\`\`` : `\`\`\`bash
npm install @revenium/middleware${design.detectedLanguage === "node" ? " dotenv" : ""}   # run inside the runtime workspace dir
\`\`\``}

Replace \`<runtime-package-name>\` with the workspace package name from its \`package.json\` (e.g. \`@yourapp/ai\`, \`@yourapp/web\`).

## 4. Re-import the helper in your AI call sites

After placing the helper, update the import path in every modified source file so it resolves to wherever you placed it:

\`\`\`${isPython ? "python" : "typescript"}
${isPython ? "from revenium_config import create_usage_metadata" : 'import { createUsageMetadata } from "../path/to/revenium-config.js";'}
\`\`\`

Revvy's transforms left a default import path of \`./revenium-config\` (Node) or \`revenium_config\` (Python). Adjust it to match the actual placement you chose.

---

## When you're done

Once these four placements are in place, run \`revvy check\` from the repo root to verify everything is wired up. The check will catch:

- Files whose imports no longer resolve
- Call sites that haven't been wrapped
- AI provider SDKs installed without the corresponding Revenium middleware

You can delete this \`${TODO_FILENAME}\` file once the setup is complete.
`;
}
