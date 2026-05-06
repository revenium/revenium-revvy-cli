import { readFile } from "fs/promises";
import { join } from "path";
import type { SupportedLanguage } from "../../../constants/languages.js";
import { DEPENDENCY_FILES } from "../../../constants/languages.js";
import { AI_PROVIDER_PACKAGES } from "../../../constants/detection.js";
import type { DetectedProvider } from "../../../types/scan-result.js";

interface DependencyDetectorResult {
  language: SupportedLanguage;
  projectName?: string;
  providers: DetectedProvider[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function detectNodeDependencies(
  targetDir: string
): Promise<DependencyDetectorResult | null> {
  const packageJsonPath = join(targetDir, "package.json");

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const providers: DetectedProvider[] = [];
    const aiPackages = AI_PROVIDER_PACKAGES.node;

    for (const [packageName, displayName] of Object.entries(aiPackages)) {
      if (allDeps[packageName]) {
        providers.push({
          name: packageName.replace("@", "").replace("/", "-"),
          displayName,
          packageName,
          version: allDeps[packageName],
        });
      }
    }

    if (providers.length > 0) {
      return {
        language: "node",
        projectName: pkg.name,
        providers,
      };
    }
  } catch {
    // package.json not found or not parseable
  }

  return null;
}

async function detectPythonDependencies(
  targetDir: string
): Promise<DependencyDetectorResult | null> {
  const providers: DetectedProvider[] = [];
  const aiPackages = AI_PROVIDER_PACKAGES.python;

  // Check requirements.txt
  try {
    const reqPath = join(targetDir, "requirements.txt");
    const content = await readFile(reqPath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim().toLowerCase());

    for (const [packageName, displayName] of Object.entries(aiPackages)) {
      const found = lines.some(
        (line) =>
          line.startsWith(packageName) &&
          (line === packageName ||
            line.startsWith(`${packageName}==`) ||
            line.startsWith(`${packageName}>=`) ||
            line.startsWith(`${packageName}<=`) ||
            line.startsWith(`${packageName}~=`) ||
            line.startsWith(`${packageName}[`))
      );
      if (found) {
        providers.push({
          name: packageName,
          displayName,
          packageName,
        });
      }
    }
  } catch {
    // requirements.txt not found
  }

  // Check pyproject.toml
  try {
    const pyprojectPath = join(targetDir, "pyproject.toml");
    const content = await readFile(pyprojectPath, "utf-8");

    for (const [packageName, displayName] of Object.entries(aiPackages)) {
      // Simple check: look for the package name in pyproject.toml
      const regex = new RegExp(
        `["']${packageName.replace("-", "[-_]")}`,
        "i"
      );
      if (regex.test(content) && !providers.some((p) => p.packageName === packageName)) {
        providers.push({
          name: packageName,
          displayName,
          packageName,
        });
      }
    }
  } catch {
    // pyproject.toml not found
  }

  if (providers.length > 0) {
    return { language: "python", providers };
  }

  return null;
}

async function detectGoDependencies(
  targetDir: string
): Promise<DependencyDetectorResult | null> {
  const providers: DetectedProvider[] = [];
  const aiPackages = AI_PROVIDER_PACKAGES.go;

  try {
    const goModPath = join(targetDir, "go.mod");
    const content = await readFile(goModPath, "utf-8");

    for (const [packageName, displayName] of Object.entries(aiPackages)) {
      if (content.includes(packageName)) {
        providers.push({
          name: packageName.split("/").pop() || packageName,
          displayName,
          packageName,
        });
      }
    }
  } catch {
    // go.mod not found
  }

  if (providers.length > 0) {
    return { language: "go", providers };
  }

  return null;
}

export async function detectDependencies(
  targetDir: string
): Promise<DependencyDetectorResult> {
  // Try each language in priority order
  const nodeResult = await detectNodeDependencies(targetDir);
  if (nodeResult) return nodeResult;

  const pythonResult = await detectPythonDependencies(targetDir);
  if (pythonResult) return pythonResult;

  const goResult = await detectGoDependencies(targetDir);
  if (goResult) return goResult;

  // Fallback: check which dependency files exist to at least detect language
  for (const [lang, files] of Object.entries(DEPENDENCY_FILES)) {
    for (const file of files) {
      if (await fileExists(join(targetDir, file))) {
        return {
          language: lang as SupportedLanguage,
          providers: [],
        };
      }
    }
  }

  // Default to node
  return {
    language: "node",
    providers: [],
  };
}
