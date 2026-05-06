import type { SelectOption } from "../../components/Question.js";
import type { ScanResult } from "../../types/scan-result.js";

export type QuestionType = "text" | "select" | "multi-select";

/** Stable sentinels for synthetic options that aren't a real candidate. */
export const PICK_DIFFERENT = "__pick_different__";
export const TYPE_CUSTOM = "__type_custom__";
export const NO_CENTRALIZED = "__no_centralized__";

export interface QuestionDefinition {
  id: string;
  /** Static label, OR a function that derives the label from scan + answers. */
  label: string | ((ctx: QuestionContext) => string);
  hint?: string | ((ctx: QuestionContext) => string | undefined);
  type: QuestionType;
  /** Static options, OR a function that derives them from scan + answers. */
  options?: SelectOption[] | ((ctx: QuestionContext) => SelectOption[]);
  placeholder?: string | ((ctx: QuestionContext) => string | undefined);
  /** Determines the next question id (or null to end the flow). */
  getNext: (ctx: QuestionContext) => string | null;
  /** Optionally hide this question. */
  shouldShow?: (ctx: QuestionContext) => boolean;
}

export interface QuestionContext {
  answers: Record<string, string | string[]>;
  scanResult: ScanResult;
}

function resolve<T>(value: T | ((ctx: QuestionContext) => T), ctx: QuestionContext): T {
  return typeof value === "function" ? (value as (c: QuestionContext) => T)(ctx) : value;
}

export function resolveLabel(q: QuestionDefinition, ctx: QuestionContext): string {
  return resolve(q.label, ctx);
}
export function resolveHint(q: QuestionDefinition, ctx: QuestionContext): string | undefined {
  return q.hint ? resolve(q.hint, ctx) : undefined;
}
export function resolveOptions(q: QuestionDefinition, ctx: QuestionContext): SelectOption[] | undefined {
  return q.options ? resolve(q.options, ctx) : undefined;
}
export function resolvePlaceholder(q: QuestionDefinition, ctx: QuestionContext): string | undefined {
  return q.placeholder ? resolve(q.placeholder, ctx) : undefined;
}

export const QUESTIONS: QuestionDefinition[] = [
  {
    id: "customer-confirm",
    label: ({ scanResult }) =>
      scanResult.customerCandidates.length > 0
        ? "We auto-detected how your code identifies the customer. Pick which to use:"
        : "We couldn't auto-detect how you identify customers in your code. Tell us:",
    hint: ({ scanResult }) => {
      if (scanResult.customerCandidates.length === 0) return undefined;
      const top = scanResult.customerCandidates[0]!;
      return `Top candidate: ${top.expression} (${top.occurrences} occurrence${top.occurrences > 1 ? "s" : ""} in ${top.filesFound} file${top.filesFound > 1 ? "s" : ""})`;
    },
    type: "select",
    options: ({ scanResult }) => {
      if (scanResult.customerCandidates.length === 0) {
        // No candidates → degrade to a single-option select that pushes user
        // to the manual text fallback.
        return [{ label: "Type a custom expression", value: TYPE_CUSTOM }];
      }
      const candidateOpts: SelectOption[] = scanResult.customerCandidates
        .slice(0, 5)
        .map((c) => ({
          label: `${c.expression}  (${c.occurrences}× across ${c.filesFound} file${c.filesFound > 1 ? "s" : ""})`,
          value: c.expression,
        }));
      candidateOpts.push({ label: "Type a custom expression", value: TYPE_CUSTOM });
      return candidateOpts;
    },
    getNext: ({ answers }) => {
      if (answers["customer-confirm"] === TYPE_CUSTOM) return "customer-custom";
      return "products";
    },
  },

  {
    id: "customer-custom",
    label: "How does your code identify the customer making the request?",
    hint: "We'll wire this expression into Revenium's organizationName metering field",
    type: "text",
    placeholder: "e.g., req.user.orgId, req.user.customerId, ctx.Value('org')",
    getNext: () => "products",
  },

  {
    id: "products",
    label: "Do you want to track costs by product or feature?",
    type: "select",
    options: [
      { label: "Yes, we have distinct AI-powered products", value: "yes-products" },
      { label: "Yes, by feature area (e.g., chat, search, analysis)", value: "yes-features" },
      { label: "No, just aggregate costs per customer/team", value: "no" },
    ],
    getNext: ({ answers }) => {
      if (answers.products === "no") return "agents";
      return "product-names";
    },
  },

  {
    id: "product-names",
    label: "Where in your code is the product/feature name stored?",
    hint: "Enter the code expression that holds the product name at runtime, or a comma-separated list of literal names.",
    type: "text",
    placeholder: "e.g., req.body.productName, config.PRODUCT_NAME, or Smart Search, AI Assistant",
    getNext: () => "agents",
  },

  {
    id: "agents",
    label: "Do you have named AI agents in your codebase?",
    type: "select",
    options: [
      { label: "Yes, we have named agents (e.g., support-bot, research-agent)", value: "yes" },
      { label: "We use an agent framework (LangChain, CrewAI, etc.)", value: "framework" },
      { label: "No, our AI calls are ad-hoc", value: "no" },
      { label: "Mix of both", value: "mixed" },
    ],
    getNext: ({ answers }) => {
      if (answers.agents === "no") return "centralized-confirm";
      return "agent-names";
    },
  },

  {
    id: "agent-names",
    label: "Where in your code is the agent name defined?",
    hint: "Enter the code expression that identifies the agent, or a comma-separated list of literal names.",
    type: "text",
    placeholder: "e.g., agent.name, AGENT_NAME, or support-bot, research-agent",
    getNext: () => "centralized-confirm",
  },

  {
    id: "centralized-confirm",
    label: ({ scanResult }) => {
      if (!scanResult.centralizedUtility) {
        return "We couldn't find a single shared AI utility — calls look scattered. Want to point us to one?";
      }
      const u = scanResult.centralizedUtility;
      const pct = Math.round(u.coverageRatio * 100);
      const fnPart = u.candidateFunction ? ` (function ${u.candidateFunction})` : "";
      return `Looks like ${u.filePath}${fnPart} centralizes your AI calls (${u.enclosedCallSites}/${u.totalCallSites} = ${pct}%). Confirm?`;
    },
    hint: ({ scanResult }) => {
      const u = scanResult.centralizedUtility;
      if (!u) return undefined;
      const conf =
        u.confidence === "high"
          ? "high confidence"
          : u.confidence === "medium"
          ? "medium confidence"
          : "low confidence";
      return `${conf} — instrumenting this single point would cover ${Math.round(
        u.coverageRatio * 100,
      )}% of AI calls`;
    },
    type: "select",
    options: ({ scanResult }) => {
      const opts: SelectOption[] = [];
      const { centralizedUtility, alternativeCentralizedUtilities } = scanResult;

      if (centralizedUtility) {
        opts.push({
          label: `Yes, use ${centralizedUtility.filePath}`,
          value: centralizedUtility.filePath,
        });
      }

      for (const alt of alternativeCentralizedUtilities.slice(0, 3)) {
        opts.push({
          label: `Use ${alt.filePath} instead (${alt.enclosedCallSites}/${alt.totalCallSites} calls)`,
          value: alt.filePath,
        });
      }

      opts.push({ label: "Pick a different file (type path)", value: PICK_DIFFERENT });
      opts.push({
        label: "AI calls are scattered — instrument each call site",
        value: NO_CENTRALIZED,
      });

      return opts;
    },
    getNext: ({ answers }) => {
      if (answers["centralized-confirm"] === PICK_DIFFERENT) return "centralized-path";
      return null;
    },
  },

  {
    id: "centralized-path",
    label: "Where is your centralized AI utility?",
    hint: "The file path relative to your project root",
    type: "text",
    placeholder: "e.g., src/lib/ai.ts, app/services/llm_service.py",
    getNext: () => null,
  },
];

export function getQuestionById(id: string): QuestionDefinition | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export const FIRST_QUESTION_ID = "customer-confirm";
