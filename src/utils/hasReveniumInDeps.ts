import { readFile } from "fs/promises";
import { join } from "path";

export async function hasReveniumInDeps(targetDir: string): Promise<boolean> {
  const files = ["requirements.txt", "pyproject.toml", "package.json", "go.mod"];
  for (const file of files) {
    try {
      const content = await readFile(join(targetDir, file), "utf-8");
      if (content.toLowerCase().includes("revenium")) return true;
    } catch {
      // file doesn't exist, skip
    }
  }
  return false;
}