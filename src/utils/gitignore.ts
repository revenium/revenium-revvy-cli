import { execFileSync } from "child_process";
import { join } from "path";
import { writeFile } from "fs/promises";
import { safeReadFile } from "./fs-helpers.js";
import { BACKUP_SUFFIX } from "./generated-file.js";

/** `.env` carries the metering key; backups hold pre-revvy copies of source files. */
export const REVVY_IGNORED_ENTRIES = [".env", `*${BACKUP_SUFFIX}`] as const;

export interface GitignoreUpdate {
  added: string[];
  created: boolean;
  /** Entries git already tracks, which no ignore pattern can hide. */
  tracked: string[];
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("")
    .map((ch) => {
      if (ch === "*") return "[^/]*";
      if (ch === "?") return "[^/]";
      return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${body}$`);
}

interface BasenamePattern {
  glob: string;
  negated: boolean;
  /** A leading `/` limits the pattern to the repository root. */
  anchored: boolean;
}

/**
 * Normalises a .gitignore line to a basename glob, or null for comments,
 * directory-only patterns and patterns that name a subdirectory.
 */
function basenamePattern(line: string): BasenamePattern | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.endsWith("/")) return null;
  const negated = trimmed.startsWith("!");
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^(\*\*\/)+/, "");
  const anchored = body.startsWith("/");
  const glob = anchored ? body.slice(1) : body;
  if (glob.includes("/")) return null;
  return { glob, negated, anchored };
}

/**
 * An entry is covered when the last pattern matching it (read literally, so
 * `.env*` covers `.env` and `*` covers `*.revvy-backup`) ignores it in every
 * directory. A root-anchored pattern such as `/.env` does not count, because
 * revvy's backups and a monorepo's workspace `.env` live below the root; an
 * anchored negation still un-ignores. A line-based approximation of
 * `git check-ignore` that works without git.
 */
export function isIgnoredBy(gitignore: string, entry: string): boolean {
  let ignored = false;
  for (const line of gitignore.split(/\r?\n/)) {
    const pattern = basenamePattern(line);
    if (!pattern || !globToRegExp(pattern.glob).test(entry)) continue;
    if (pattern.negated) ignored = false;
    else if (!pattern.anchored) ignored = true;
  }
  return ignored;
}

// The backup glob is also checked against the concrete names revvy writes, so a
// later exception such as `!/.env.revvy-backup` cannot leave the copy of the
// metering key committable while the wildcard itself looks covered.
const CONCRETE_NAMES: Record<string, readonly string[]> = {
  [`*${BACKUP_SUFFIX}`]: [`.env${BACKUP_SUFFIX}`, `.env.1${BACKUP_SUFFIX}`],
};

export function missingIgnoreEntries(gitignore: string | null, entries: readonly string[]): string[] {
  return entries.filter((entry) =>
    [entry, ...(CONCRETE_NAMES[entry] ?? [])].some((name) => !isIgnoredBy(gitignore ?? "", name)),
  );
}

export function appendIgnoreEntries(gitignore: string | null, entries: readonly string[]): string {
  const block = ["# Revenium (added by Revvy)", ...entries].join("\n") + "\n";
  if (!gitignore) return block;
  const separator = gitignore.endsWith("\n") ? "\n" : "\n\n";
  return gitignore + separator + block;
}

/**
 * Files git already tracks stay tracked whatever .gitignore says. Returns an
 * empty list when git is missing or the directory is not a repository.
 */
export function trackedByGit(targetDir: string, files: readonly string[]): string[] {
  return files.filter((file) => {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", "--", file], { cwd: targetDir, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
}

export async function ensureRevvyFilesIgnored(targetDir: string): Promise<GitignoreUpdate> {
  const path = join(targetDir, ".gitignore");
  const existing = await safeReadFile(path);
  const added = missingIgnoreEntries(existing, REVVY_IGNORED_ENTRIES);
  if (added.length > 0) await writeFile(path, appendIgnoreEntries(existing, added), "utf-8");
  return { added, created: existing === null && added.length > 0, tracked: trackedByGit(targetDir, [".env"]) };
}

export function describeGitignoreUpdate(update: GitignoreUpdate): string {
  const entries = REVVY_IGNORED_ENTRIES.join(" and ");
  if (update.added.length === 0) return `.gitignore already ignores ${entries}`;
  const verb = update.created ? "Created .gitignore ignoring" : "Added to .gitignore:";
  return `${verb} ${update.added.join(", ")} (keeps the metering key and revvy backups out of git)`;
}

export function trackedFilesWarning(update: GitignoreUpdate): string | null {
  if (update.tracked.length === 0) return null;
  const files = update.tracked.join(", ");
  return `git already tracks ${files}, so .gitignore cannot keep the metering key out of commits. Run \`git rm --cached ${files}\` to stop tracking it.`;
}
