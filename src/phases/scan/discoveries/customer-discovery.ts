/**
 * Heuristic discovery of how the developer's code identifies the customer
 * making each request. We scan source files for well-known auth patterns
 * (Express/Fastify, FastAPI/Flask/Django, Gin/Fiber/net/http, JWT, etc.)
 * and rank candidates by frequency. Note: regex patterns intentionally match
 * developer variable names like `tenantId`, `tenant_id`, and `X-Tenant-Id` —
 * those are common naming conventions in real codebases, regardless of how
 * we name the concept in the CLI.
 *
 * Output feeds into the consultation: instead of asking the user to type the
 * expression, we present a confirmation list with the top candidates.
 */

import { readFile } from "fs/promises";
import type { SupportedLanguage } from "../../../constants/languages.js";
import type { CustomerCandidate } from "./types.js";

interface PatternDef {
  /** Regex that captures the full access expression (e.g. `req.user.orgId`). */
  regex: RegExp;
  /** Where this expression typically comes from. */
  source: "auth-context" | "api-key" | "custom";
}

const NODE_PATTERNS: PatternDef[] = [
  // Express / Fastify / Koa middleware bindings
  { regex: /\b(req|request|ctx|c)\.user\.(?:orgId|organizationId|tenantId|teamId|companyId|workspaceId|accountId|id)\b/g, source: "auth-context" },
  { regex: /\b(req|request|ctx)\.auth\.(?:orgId|organizationId|tenantId|teamId|sub|userId)\b/g, source: "auth-context" },
  { regex: /\b(req|request)\.session\.(?:user|tenant|org)\.(?:id|orgId|tenantId|name)\b/g, source: "auth-context" },
  { regex: /\bsession\.(?:user|tenant|org)\.(?:id|orgId|tenantId|name)\b/g, source: "auth-context" },
  // NestJS — @Req() req with user
  { regex: /\b(req|request)\.user\b(?!\s*=)/g, source: "auth-context" },
  // Header-based customer ID (matches X-Tenant-Id, X-Org-Id, X-Customer-Id, X-Api-Key)
  { regex: /\b(req|request)\.headers\[?["']x-(?:tenant|org|api|customer)-(?:id|key)["']\]?/gi, source: "api-key" },
  { regex: /\b(req|request)\.headers\.(?:authorization|x-api-key)\b/gi, source: "api-key" },
  // Locals (Express res.locals.user etc.)
  { regex: /\bres\.locals\.(?:user|tenant|org)\.(?:id|orgId|tenantId)\b/g, source: "auth-context" },
];

const PYTHON_PATTERNS: PatternDef[] = [
  // Django / DRF
  { regex: /\b(?:self\.)?request\.user\.(?:org_id|organization_id|tenant_id|team_id|id|pk|username)\b/g, source: "auth-context" },
  // Flask
  { regex: /\bg\.user\.(?:org_id|organization_id|tenant_id|id|email)\b/g, source: "auth-context" },
  { regex: /\bcurrent_user\.(?:org_id|organization_id|tenant_id|id)\b/g, source: "auth-context" },
  // FastAPI
  { regex: /\brequest\.state\.user\.(?:org_id|organization_id|tenant_id|id)\b/g, source: "auth-context" },
  { regex: /\bDepends\(\s*get_current_user\s*\)/g, source: "auth-context" },
  // Header / API key based
  { regex: /\brequest\.headers\.get\(\s*["']x-(?:tenant|org|api|customer)-(?:id|key)["']\s*\)/gi, source: "api-key" },
  // Generic context
  { regex: /\bcontext\.(?:user|tenant|org)\.(?:id|org_id|tenant_id)\b/g, source: "auth-context" },
];

const GO_PATTERNS: PatternDef[] = [
  // net/http with context values
  { regex: /\b(?:r|req|request)\.Context\(\)\.Value\(\s*["a-zA-Z0-9_.]+\s*\)/g, source: "auth-context" },
  { regex: /\bctx\.Value\(\s*["a-zA-Z0-9_.]+\s*\)/g, source: "auth-context" },
  // Gin: c.Get("user")
  { regex: /\bc\.Get\(\s*["'](?:user|tenant|org|orgId|tenantId)["']\s*\)/g, source: "auth-context" },
  { regex: /\bc\.MustGet\(\s*["'](?:user|tenant|org|orgId|tenantId)["']\s*\)/g, source: "auth-context" },
  // Fiber: c.Locals("user")
  { regex: /\bc\.Locals\(\s*["'](?:user|tenant|org|orgId|tenantId)["']\s*\)/g, source: "auth-context" },
  // Echo: c.Get("user")
  // Headers
  { regex: /\b(?:r|req|c)\.(?:Header\.Get|GetHeader)\(\s*["']X-(?:Tenant|Org|Api|Customer)-(?:Id|Key)["']\s*\)/gi, source: "api-key" },
  // JWT claims
  { regex: /\bclaims\.(?:OrgId|OrganizationId|TenantId|TeamId|UserId|Sub)\b/g, source: "auth-context" },
];

function patternsFor(language: SupportedLanguage): PatternDef[] {
  if (language === "node") return NODE_PATTERNS;
  if (language === "python") return PYTHON_PATTERNS;
  if (language === "go") return GO_PATTERNS;
  return [];
}

interface RawHit {
  expression: string;
  source: PatternDef["source"];
  filePath: string;
}

function normalizeExpression(raw: string): string {
  // Collapse whitespace inside header lookups so different formatting maps to
  // the same canonical expression.
  return raw.replace(/\s+/g, "");
}

/**
 * Scan all source files (already discovered by call-site detector) and
 * return ranked customer ID candidates.
 */
export async function discoverCustomerCandidates(
  filePaths: string[],
  language: SupportedLanguage,
  relativeOf: (absolute: string) => string,
): Promise<CustomerCandidate[]> {
  const patterns = patternsFor(language);
  if (patterns.length === 0) return [];

  // Map: normalized expression -> aggregated info
  const agg = new Map<
    string,
    {
      source: PatternDef["source"];
      occurrences: number;
      files: Set<string>;
      rawSample: string;
    }
  >();

  for (const filePath of filePaths) {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const relative = relativeOf(filePath);
    const hits: RawHit[] = [];

    for (const p of patterns) {
      // Reset state on each file for global regexes
      const re = new RegExp(p.regex.source, p.regex.flags);
      let match;
      while ((match = re.exec(content)) !== null) {
        hits.push({
          expression: match[0],
          source: p.source,
          filePath: relative,
        });
      }
    }

    for (const hit of hits) {
      const key = normalizeExpression(hit.expression);
      const existing = agg.get(key);
      if (existing) {
        existing.occurrences += 1;
        existing.files.add(hit.filePath);
      } else {
        agg.set(key, {
          source: hit.source,
          occurrences: 1,
          files: new Set([hit.filePath]),
          rawSample: hit.expression,
        });
      }
    }
  }

  const candidates: CustomerCandidate[] = Array.from(agg.entries()).map(
    ([_normalized, info]) => ({
      expression: info.rawSample, // keep the original formatting
      filesFound: info.files.size,
      occurrences: info.occurrences,
      source: info.source,
      exampleFiles: Array.from(info.files).slice(0, 3),
    }),
  );

  // Rank: prefer expressions that appear in MORE FILES (more general), then
  // by raw occurrences. This biases us toward shared patterns (e.g. auth
  // middleware injecting `req.user.orgId` across the codebase) and away from
  // one-off accesses.
  candidates.sort((a, b) => {
    if (b.filesFound !== a.filesFound) return b.filesFound - a.filesFound;
    return b.occurrences - a.occurrences;
  });

  return candidates;
}
