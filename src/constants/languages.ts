export const SUPPORTED_LANGUAGES = ["node", "python", "go"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEPENDENCY_FILES: Record<SupportedLanguage, string[]> = {
  node: ["package.json"],
  python: ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"],
  go: ["go.mod"],
};
