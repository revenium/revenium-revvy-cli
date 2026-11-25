import { buildGitHubActionWorkflow } from "./templates/githubAction.js";
import { getEditorRules } from "./templates/editorRules.js";
import { AGENT_PROMPT } from "./templates/agentPrompt.js";
import { writeGeneratedFile, type GeneratedFileResult } from "../../utils/generated-file.js";
import type { PackageManagerInfo } from "../../utils/package-manager.js";

export const GITHUB_WORKFLOW_PATH = ".github/workflows/revenium-check.yml";

const EDITORS = [
  { dir: ".cursor", name: "Cursor" },
  { dir: ".claude", name: "Claude" },
  { dir: ".gemini", name: "Gemini" },
  { dir: ".codex", name: "Codex" },
] as const;

const EDITOR_RULES_FILE = "rules/revenium.md";
const EDITOR_AGENT_FILE = "revvy-agent.md";

export const EDITOR_GROUP_LABEL = `editor rules + agent prompts (${EDITORS.map((e) => e.name).join(", ")})`;

interface EditorFile {
  path: string;
  content: string;
}

function editorFiles(rules: string): EditorFile[] {
  return EDITORS.flatMap(({ dir }) => [
    { path: `${dir}/${EDITOR_RULES_FILE}`, content: rules },
    { path: `${dir}/${EDITOR_AGENT_FILE}`, content: AGENT_PROMPT },
  ]);
}

export function editorFilePaths(): string[] {
  return editorFiles("").map((f) => f.path);
}

export function githubWorkflowContent(pmInfo: PackageManagerInfo | undefined): string {
  return buildGitHubActionWorkflow(pmInfo);
}

export async function writeGitHubWorkflow(
  targetDir: string,
  pmInfo: PackageManagerInfo | undefined,
): Promise<GeneratedFileResult> {
  return writeGeneratedFile(targetDir, GITHUB_WORKFLOW_PATH, githubWorkflowContent(pmInfo));
}

/** Yields each file as it is written, so a caller keeps what was written if a later write fails. */
export async function* writeEditorFiles(
  targetDir: string,
  language: "node" | "python" | "go",
  detectedProviders: readonly string[] | undefined,
): AsyncGenerator<GeneratedFileResult> {
  for (const file of editorFiles(getEditorRules(language, detectedProviders))) {
    yield await writeGeneratedFile(targetDir, file.path, file.content);
  }
}
