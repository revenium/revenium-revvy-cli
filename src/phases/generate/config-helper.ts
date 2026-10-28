import type { SupportedLanguage } from "../../constants/languages.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import { renderTemplate } from "../../utils/template-engine.js";
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

export function renderConfigHelper(design: MeteringDesign): string {
  return renderTemplate(helperFor(design.detectedLanguage).template, {
    providers: design.detectedProviders,
    organization: design.organization,
    products: design.products,
    agents: design.agents,
    taskTypes: design.taskTypes,
    trackingGoal: design.trackingGoal,
    outcomeTracking: design.outcomeTracking,
    centralizedCallPattern: design.centralizedCallPattern,
  });
}
