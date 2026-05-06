import type { PackageManagerInfo } from "../../../utils/package-manager.js";

/**
 * Static fallback used when no PackageManagerInfo is available (e.g. Python projects
 * or when called from contexts that don't run the Node detector). Defaults match the
 * historical workflow shipped before package-manager detection was added.
 */
export const GITHUB_ACTION_WORKFLOW = buildGitHubActionWorkflow();

/**
 * Builds the GitHub Actions workflow YAML for the per-PR `revvy check` guardrail.
 *
 * When `pmInfo` is provided, the YAML adapts to the project's actual toolchain:
 *   - `engines.node` (or its first numeric segment) drives the setup-node version.
 *   - `packageManager` field (or the detected lockfile) drives the install step.
 *
 * When `pmInfo` is absent, falls back to Node 22 + pnpm 10 (the historical defaults).
 */
export function buildGitHubActionWorkflow(pmInfo?: PackageManagerInfo): string {
  const nodeVersion = pickNodeVersion(pmInfo?.nodeVersion) ?? "22";
  const manager = pmInfo?.manager ?? "pnpm";
  const managerSetupBlock = buildManagerSetupBlock(manager, pmInfo?.packageManagerVersion);
  const installCmd = managerInstallGlobalCmd(manager);

  return `name: Revenium Instrumentation Check
on: [pull_request]

jobs:
  revenium-check:
    name: Validate AI calls are wrapped by Revenium
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
${managerSetupBlock}
      - name: Install Revvy
        run: ${installCmd}

      # Initial rollout: warn-only mode surfaces findings as PR annotations
      # without failing the build. Once the codebase is fully instrumented and
      # the team is ready to enforce, remove "--warn-only" so unwrapped AI
      # calls block the PR.
      - name: Check AI instrumentation
        run: revvy check --target-dir . --ci --warn-only
`;
}

function pickNodeVersion(engines: string | undefined): string | null {
  if (!engines) return null;
  // Accept ranges like ">=18.17.0", "^20.0.0", "20.x", "22" — extract the first numeric major.
  const m = engines.match(/(\d+)/);
  return m ? m[1]! : null;
}

function buildManagerSetupBlock(manager: string, version?: string): string {
  // Extract just the version number from "pnpm@10.5.0" if provided
  const pmVer = version?.split("@")[1]?.split(".")[0];

  switch (manager) {
    case "pnpm":
      return `
      - uses: pnpm/action-setup@v4
        with:
          version: ${pmVer ?? "10"}
`;
    case "yarn":
      // yarn ships with corepack-enabled Node, so no separate setup needed —
      // but we enable corepack explicitly for clarity.
      return `
      - name: Enable Corepack
        run: corepack enable
`;
    case "bun":
      return `
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${pmVer ?? "latest"}
`;
    case "npm":
    default:
      // npm ships with Node, no setup step needed.
      return "";
  }
}

function managerInstallGlobalCmd(manager: string): string {
  switch (manager) {
    case "pnpm":
      return "pnpm add -g @revenium/revvy";
    case "yarn":
      return "yarn global add @revenium/revvy";
    case "bun":
      return "bun add -g @revenium/revvy";
    case "npm":
    default:
      return "npm install -g @revenium/revvy";
  }
}
