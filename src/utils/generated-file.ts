import { stat, writeFile } from "fs/promises";
import { join } from "path";
import { safeReadFile, safeWriteFile } from "./fs-helpers.js";

export const BACKUP_SUFFIX = ".revvy-backup";

export type WriteOutcome = "created" | "updated" | "unchanged";

export interface GeneratedFileResult {
  /** Path relative to the target directory, as shown to the user. */
  file: string;
  outcome: WriteOutcome;
  /** Set when an existing file with different content was copied aside before the write. */
  backupFile?: string;
}

const OUTCOME_VERBS: Record<WriteOutcome, string> = {
  created: "Created",
  updated: "Updated",
  unchanged: "Unchanged",
};

export function planGeneratedWrite(existing: string | null, next: string): WriteOutcome {
  if (existing === null) return "created";
  return existing === next ? "unchanged" : "updated";
}

/** `<file>.revvy-backup`, then `<file>.1.revvy-backup`, `<file>.2.revvy-backup`, … */
export function backupCandidate(relativePath: string, attempt: number): string {
  return attempt === 0 ? relativePath + BACKUP_SUFFIX : `${relativePath}.${attempt}${BACKUP_SUFFIX}`;
}

/**
 * Saves `content` (the current contents of `relativePath`) beside it and
 * returns the backup's relative path. An earlier backup is never replaced: one
 * holding the same content is reused, otherwise the next free name is taken.
 */
export async function backUpFile(targetDir: string, relativePath: string, content: string): Promise<string> {
  // A backup of .env holds the metering key: it must be no more readable than
  // the file it copies, whatever the process umask would otherwise allow.
  const mode = await stat(join(targetDir, relativePath)).then((s) => s.mode & 0o777, () => 0o600);
  for (let attempt = 0; ; attempt++) {
    const candidate = backupCandidate(relativePath, attempt);
    const existing = await safeReadFile(join(targetDir, candidate));
    if (existing === content) return candidate;
    if (existing !== null) continue;
    try {
      await writeFile(join(targetDir, candidate), content, { encoding: "utf-8", flag: "wx", mode });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export async function writeGeneratedFile(
  targetDir: string,
  relativePath: string,
  content: string,
): Promise<GeneratedFileResult> {
  const existing = await safeReadFile(join(targetDir, relativePath));
  const outcome = planGeneratedWrite(existing, content);
  if (outcome === "unchanged") return { file: relativePath, outcome };

  const backupFile = existing === null ? undefined : await backUpFile(targetDir, relativePath, existing);
  await safeWriteFile(join(targetDir, relativePath), content);
  return backupFile ? { file: relativePath, outcome, backupFile } : { file: relativePath, outcome };
}

export function describeGeneratedFile(result: GeneratedFileResult, detail?: string): string {
  const suffix = detail ? ` ${detail}` : "";
  const backup = result.backupFile ? ` — previous version saved to ${result.backupFile}` : "";
  return `${OUTCOME_VERBS[result.outcome]} ${result.file}${suffix}${backup}`;
}

/** One line for a group of files written together (e.g. the eight editor-rule files). */
export function describeGeneratedGroup(label: string, results: GeneratedFileResult[]): string {
  const count = (outcome: WriteOutcome) => results.filter((r) => r.outcome === outcome).length;
  const backups = results.flatMap((r) => (r.backupFile ? [r.backupFile] : []));
  const backupNote = backups.length > 0 ? ` — previous versions saved as ${backups.join(", ")}` : "";

  const uniform = (["created", "updated", "unchanged"] as const).find((o) => count(o) === results.length);
  if (uniform) return `${OUTCOME_VERBS[uniform]} ${label}${backupNote}`;

  const parts = (["created", "updated", "unchanged"] as const)
    .filter((o) => count(o) > 0)
    .map((o) => `${count(o)} ${o}`);
  return `Wrote ${label} (${parts.join(", ")})${backupNote}`;
}
