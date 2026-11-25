import type { MeteringDesign } from "../../../types/metering-design.js";

export interface GoHelperIdentifiers {
  products: Map<string, string>;
  agents: Map<string, string>;
}

function exportedName(prefix: string, name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return prefix + words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

/**
 * Names of the Product* / Agent* constants the generated Go helper declares.
 * The helper template and the call-site snippets both read this, so a snippet
 * always names a constant that exists.
 */
export function goHelperIdentifiers(
  design: Pick<MeteringDesign, "products" | "agents">,
): GoHelperIdentifiers {
  const used = new Set<string>();
  const unique = (prefix: string, name: string): string => {
    const base = exportedName(prefix, name);
    let ident = base;
    for (let n = 2; used.has(ident); n++) ident = base + n;
    used.add(ident);
    return ident;
  };
  return {
    products: new Map(design.products.map((p) => [p.name, unique("Product", p.name)])),
    agents: new Map(design.agents.map((a) => [a.name, unique("Agent", a.name)])),
  };
}
