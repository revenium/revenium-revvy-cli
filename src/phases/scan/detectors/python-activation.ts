/**
 * Which Python providers the Revenium middleware actually patches at runtime.
 *
 * `import revenium_middleware.<provider>` patches the SDK for the whole
 * process, so one import anywhere that runs covers every file. "Runs" is the
 * part a plain text search gets wrong: the generated `revenium_config.py`
 * imports the middleware too, but nothing loads it unless some other module
 * imports it, so its imports count only when it is imported.
 */

import { readFile } from "fs/promises";
import { basename, relative } from "path";
import type { CallSite } from "../../../types/scan-result.js";
import { extractPythonImports } from "./ast/import-extractor.js";
import { PYTHON_PATTERNS } from "../patterns/python-patterns.js";

const GENERATED_HELPER_MODULE = "revenium_config";
const MIDDLEWARE_PACKAGE = "revenium_middleware";
// The standalone package earlier SDK releases shipped for LiteLLM; it still
// patches LiteLLM when imported.
const LEGACY_LITELLM_PACKAGE = "revenium_middleware_litellm";

export interface PythonMiddlewareActivation {
  /** Providers patched by a middleware import that runs. */
  activated: Set<string>;
  /** Providers only the generated helper imports, in a project where nothing imports the helper. */
  onlyInUnimportedHelper: Set<string>;
  /**
   * `file:line` of OpenAI-SDK calls made on a client pointed at Perplexity,
   * which `revenium_middleware.perplexity` meters.
   */
  perplexityClientCalls: Set<string>;
}

// The middleware import lines revvy writes end in a `# ...` comment, which the
// shared import extractor's line patterns do not accept.
function withoutComments(content: string): string {
  return content.replace(/#.*$/gm, "");
}

/** Modules a Python file imports with a real (uncommented) import statement. */
export function importedPythonModules(content: string): Set<string> {
  return extractPythonImports(withoutComments(content));
}

/** Whether `modules` imports `module` itself or one of its submodules. */
export function importsPythonModule(modules: Set<string>, module: string): boolean {
  for (const imported of modules) {
    if (imported === module || imported.startsWith(`${module}.`)) return true;
  }
  return false;
}

function providersPatchedBy(modules: Set<string>): Set<string> {
  const providers = new Set<string>();
  if (importsPythonModule(modules, LEGACY_LITELLM_PACKAGE)) providers.add("litellm");
  for (const module of modules) {
    if (!module.startsWith(`${MIDDLEWARE_PACKAGE}.`)) continue;
    for (const pattern of PYTHON_PATTERNS) {
      if (pattern.instrumentationImports.some((marker) => module === marker || module.startsWith(`${marker}.`))) {
        providers.add(pattern.provider);
      }
    }
  }
  return providers;
}

function importsGeneratedHelper(modules: Set<string>): boolean {
  for (const module of modules) {
    if (module === GENERATED_HELPER_MODULE || module.endsWith(`.${GENERATED_HELPER_MODULE}`)) return true;
  }
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLIENT_ARGUMENTS_SPAN = 400;

/**
 * Whether `receiver` is assigned an OpenAI client whose constructor arguments
 * mention Perplexity (`base_url="https://api.perplexity.ai"`, a
 * `PERPLEXITY_*` variable). Unresolvable receivers count as not Perplexity.
 */
function isPerplexityClient(content: string, receiver: string): boolean {
  const assignment = new RegExp(`^\\s*${escapeRegExp(receiver)}\\s*(?::[^=\\n]+)?=\\s*[\\w.]*OpenAI\\s*\\(`, "m").exec(content);
  if (!assignment) return false;
  const args = content.slice(assignment.index + assignment[0].length, assignment.index + assignment[0].length + CLIENT_ARGUMENTS_SPAN);
  const end = args.indexOf(")");
  return /perplexity/i.test(end >= 0 ? args.slice(0, end) : args);
}

function perplexityClientCallsIn(content: string, sites: CallSite[]): string[] {
  return sites
    .filter((site) => site.provider === "openai")
    .filter((site) => {
      const receiver = new RegExp(`([A-Za-z_][\\w.]*)\\.${escapeRegExp(site.method)}\\s*\\(`).exec(site.snippet)?.[1];
      return receiver !== undefined && isPerplexityClient(content, receiver);
    })
    .map((site) => `${site.filePath}:${site.lineNumber}`);
}

export async function detectPythonMiddlewareActivation(
  targetDir: string,
  files: string[],
  callSites: CallSite[],
): Promise<PythonMiddlewareActivation> {
  const activated = new Set<string>();
  const helperProviders = new Set<string>();
  const perplexityClientCalls = new Set<string>();
  let helperImported = false;

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const modules = importedPythonModules(content);
    const patched = providersPatchedBy(modules);
    if (basename(file) === `${GENERATED_HELPER_MODULE}.py`) {
      patched.forEach((p) => helperProviders.add(p));
    } else {
      patched.forEach((p) => activated.add(p));
      helperImported ||= importsGeneratedHelper(modules);
    }
    const relativePath = relative(targetDir, file);
    const sitesHere = callSites.filter((site) => site.filePath === relativePath);
    perplexityClientCallsIn(content, sitesHere).forEach((key) => perplexityClientCalls.add(key));
  }

  if (helperImported) helperProviders.forEach((p) => activated.add(p));
  const onlyInUnimportedHelper = new Set([...helperProviders].filter((p) => !activated.has(p)));
  return { activated, onlyInUnimportedHelper, perplexityClientCalls };
}
