import type { SupportedLanguage } from "../constants/languages.js";

const BARE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  node: "JavaScript/TypeScript",
  python: "Python",
  go: "Go",
};

/**
 * What to tell the user when `--customer-id-expression` is a bare identifier.
 * In Node projects the customer usually hangs off a request object, so a bare
 * name is more often a literal typed without `--customer-id-literal`. In Go and
 * Python handlers it is the normal shape of a local, so only the scope
 * requirement is worth stating.
 */
export function bareIdentifierNotice(expression: string, language: SupportedLanguage): string | null {
  if (!BARE_IDENTIFIER_RE.test(expression)) return null;
  if (language === "node") {
    return (
      `⚠ --customer-id-expression "${expression}" looks like a bare identifier. ` +
      `If you meant a literal string constant, use --customer-id-literal "${expression}" instead. ` +
      `If you meant a code expression that resolves to a variable, you may need to escape the quotes ` +
      `('"${expression}"') or use a more qualified expression (e.g., "req.user.${expression}").`
    );
  }
  return (
    `ℹ --customer-id-expression "${expression}" is used as a ${LANGUAGE_NAMES[language]} variable, so it must be in scope at every AI call site. ` +
    `For a fixed string, use --customer-id-literal "${expression}" instead.`
  );
}
