/**
 * Shared logic for deciding whether a customer-id expression needs `String()`
 * coercion before being assigned to a string-typed metering field.
 *
 * Used by:
 *  - Call-site manifest writer (the JSON snippet agents copy verbatim)
 *  - Node transform reference comment (the inline example revvy injects)
 *  - Monorepo TODO file (the helper-call example agents wire in by hand)
 *  - Agent guide Step 3 (documentation example)
 *
 * Keeping these in sync prevents the "manifest says String(input.teamId) but
 * the in-file comment shows raw input.teamId" inconsistency that bit a previous
 * fresh-agent test.
 */

const NUMERIC_LOOKING_TAIL = /\.(id|tenantId|teamId|userId|customerId|organizationId|orgId|accountId|companyId)$/i;
const ALREADY_COERCED = /^\s*String\s*\(/;

/**
 * Heuristic — does this customer-id expression look like it might evaluate to
 * a non-string and therefore need `String()` wrapping for the wire-typed
 * `organizationName: string` field?
 *
 * Returns true when:
 *  - The expression isn't already wrapped in `String(...)`
 *  - AND the tail of the property access looks numeric (`.id`, `.teamId`, etc.)
 *
 * Conservative on purpose: only wraps when we're fairly confident the value
 * is numeric. A literal string like `"acme-corp"` won't be touched.
 */
export function needsStringCoercion(expr: string): boolean {
  if (ALREADY_COERCED.test(expr)) return false;
  return NUMERIC_LOOKING_TAIL.test(expr);
}

/** Returns the expression wrapped in `String(...)` only if needed. */
export function coerceCustomerId(expr: string): string {
  return needsStringCoercion(expr) ? `String(${expr})` : expr;
}
