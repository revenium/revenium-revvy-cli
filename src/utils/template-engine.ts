import ejs from "ejs";
import { coerceCustomerId } from "./customer-id-coercion.js";

/**
 * Neutralize `*\/` sequences that would prematurely terminate a block comment
 * if the value is interpolated into a `/* ... *\/` block. Inserts a space
 * between `*` and `/` — visually preserves the value while breaking the close
 * marker. Pass this as the `safeForBlockComment` helper into templates.
 */
export function safeForBlockComment(value: string | undefined | null): string {
  if (!value) return "";
  return String(value).replace(/\*\//g, "* /");
}

export function renderTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  return ejs.render(
    template,
    { safeForBlockComment, coerceCustomerId, ...data },
    { rmWhitespace: false },
  );
}
