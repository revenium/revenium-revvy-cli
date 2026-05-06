/**
 * Detect the package manager + monorepo layout of a target project.
 *
 * Used to:
 *  - Print an install command that matches the project's lockfile (pnpm/yarn/bun/npm).
 *  - Surface a hint to agents when the project is a monorepo so they know to scope
 *    `--filter` / `workspace` correctly when applying patterns from `revvy --dry-run`.
 *  - Generate a CI workflow YAML that uses the same toolchain the project already uses.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { fileExists } from "./fs-helpers.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface PackageManagerInfo {
  manager: PackageManager;
  /** True if any monorepo signal was found (workspaces / pnpm-workspace.yaml / lerna.json / turbo.json / nx.json). */
  isMonorepo: boolean;
  /** Pinned version from `engines.node` in package.json, if present. */
  nodeVersion?: string;
  /** Pinned package manager version (e.g. "pnpm@10.5.0") from `packageManager` field, if present. */
  packageManagerVersion?: string;
}

/**
 * Detects package manager from lockfile presence (most reliable signal).
 * Falls back to npm if no lockfile is found — that matches the CLI's pre-detection default.
 */
export async function detectPackageManager(targetDir: string): Promise<PackageManagerInfo> {
  // Order matters: pnpm/yarn/bun lockfiles are more specific than package-lock.json,
  // and a project may have both (e.g. a stale package-lock.json after migrating to pnpm).
  const checks: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ];

  let manager: PackageManager = "npm";
  for (const [lockfile, pm] of checks) {
    if (await fileExists(join(targetDir, lockfile))) {
      manager = pm;
      break;
    }
  }

  // Monorepo signals (any of these = treat as monorepo)
  const monorepoMarkers = [
    "pnpm-workspace.yaml",
    "lerna.json",
    "turbo.json",
    "nx.json",
    "rush.json",
  ];
  let isMonorepo = false;
  for (const marker of monorepoMarkers) {
    if (await fileExists(join(targetDir, marker))) {
      isMonorepo = true;
      break;
    }
  }

  // Read package.json for engines.node, packageManager, and root `workspaces` field.
  let nodeVersion: string | undefined;
  let packageManagerVersion: string | undefined;
  try {
    const pkgRaw = await readFile(join(targetDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      engines?: { node?: string };
      packageManager?: string;
      workspaces?: unknown;
    };
    nodeVersion = pkg.engines?.node;
    packageManagerVersion = pkg.packageManager;
    if (!isMonorepo && pkg.workspaces) {
      isMonorepo = true;
    }
  } catch {
    // Missing or malformed package.json — leave fields undefined.
  }

  return { manager, isMonorepo, nodeVersion, packageManagerVersion };
}

/**
 * Returns the install verb for a given package manager.
 * - npm → `npm install <pkgs>`
 * - pnpm → `pnpm add <pkgs>`
 * - yarn → `yarn add <pkgs>`
 * - bun → `bun add <pkgs>`
 *
 * Note: in monorepos, the caller should suggest scoping (e.g. `pnpm --filter <pkg> add ...`)
 * — this helper returns the bare command suitable for single-package projects.
 */
export function installCommand(manager: PackageManager, packages: string[]): string {
  const pkgs = packages.join(" ");
  switch (manager) {
    case "pnpm":
      return `pnpm add ${pkgs}`;
    case "yarn":
      return `yarn add ${pkgs}`;
    case "bun":
      return `bun add ${pkgs}`;
    case "npm":
    default:
      return `npm install ${pkgs}`;
  }
}
