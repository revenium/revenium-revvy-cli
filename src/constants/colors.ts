/**
 * Revenium brand color palette.
 * CLI uses dark-mode variants since terminals have dark backgrounds.
 */
export const colors = {
  /** Primary brand purple — used for prompts, highlights, links, code snippets */
  primary: "#ab6ff7",
  /** Bright green — success states, completed steps, confirmations */
  success: "#7eec4a",
  /** Red — errors, failures, destructive actions */
  error: "#d7594f",
  /** Yellow — warnings (kept as named color for broad terminal compat) */
  warning: "yellow",
  /** Muted purple — secondary/pending text */
  muted: "#e8e1f9",
  /** Blue accent — info status */
  accent: "#4375df",
} as const;
