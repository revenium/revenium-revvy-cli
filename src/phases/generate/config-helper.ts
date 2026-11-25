import { posix } from "path";
import type { SupportedLanguage } from "../../constants/languages.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import { renderTemplate } from "../../utils/template-engine.js";
import { goHelperIdentifiers } from "./utils/go-identifiers.js";
import nodeTemplate from "./templates/node-ts/revenium-config.ts.ejs";
import pythonTemplate from "./templates/python/revenium_config.py.ejs";
import goTemplate from "./templates/go/revenium_config.go.ejs";

const CONFIG_HELPERS: Record<SupportedLanguage, { template: string; fileName: string }> = {
  node: { template: nodeTemplate, fileName: "src/revenium-config.ts" },
  python: { template: pythonTemplate, fileName: "revenium_config.py" },
  go: { template: goTemplate, fileName: "revenium/config.go" },
};

function helperFor(language: string | undefined) {
  return CONFIG_HELPERS[language as SupportedLanguage] ?? CONFIG_HELPERS.node;
}

export function configHelperFileName(language: string | undefined): string {
  return helperFor(language).fileName;
}

const IDENTITY_PARAMETERS: Record<SupportedLanguage, { apiKey: string; customerId: string }> = {
  node: { apiKey: "apiKey", customerId: "customerId" },
  python: { apiKey: "api_key", customerId: "customer_id" },
  go: { apiKey: "APIKey", customerId: "CustomerID" },
};

/** The helper parameter that identifies the customer: the API key in api-key projects, the customer ID otherwise. */
export function helperIdentityParameter(design: Pick<MeteringDesign, "detectedLanguage" | "organization">): string {
  const names = IDENTITY_PARAMETERS[design.detectedLanguage as SupportedLanguage] ?? IDENTITY_PARAMETERS.node;
  return design.organization.source === "api-key" ? names.apiKey : names.customerId;
}

/**
 * The specifier a Node source file uses to import the generated helper,
 * relative to that file. The `.js` extension resolves to the `.ts` file under
 * every TypeScript module resolution and is required by Node ESM.
 */
export function nodeHelperImportSpecifier(fromFile: string): string {
  const helper = configHelperFileName("node").replace(/\.ts$/, ".js");
  const from = posix.dirname(fromFile.replace(/\\/g, "/"));
  const specifier = posix.relative(from, helper);
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

export function renderConfigHelper(design: MeteringDesign): string {
  const goIdents = goHelperIdentifiers(design);
  return renderTemplate(helperFor(design.detectedLanguage).template, {
    providers: design.detectedProviders,
    organization: design.organization,
    products: design.products,
    agents: design.agents,
    taskTypes: design.taskTypes,
    trackingGoal: design.trackingGoal,
    outcomeTracking: design.outcomeTracking,
    centralizedCallPattern: design.centralizedCallPattern,
    productIdents: goIdents.products,
    agentIdents: goIdents.agents,
  });
}
