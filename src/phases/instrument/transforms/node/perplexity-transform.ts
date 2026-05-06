/**
 * Transform for Node.js/TypeScript files using Perplexity via the OpenAI SDK.
 *
 * Uses Initialize + GetClient from @revenium/middleware/perplexity (client wrapper).
 * This transform adds the import + a commented reference block.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_IMPORT = `import "@revenium/middleware/perplexity"; // Revenium: client wrapper for Perplexity metering`;

/**
 * Heuristic: does this Node/TS file look like it's using the Perplexity API?
 */
export function isNodePerplexityFile(content: string): boolean {
  return (
    content.includes("perplexity.ai") ||
    content.includes("PERPLEXITY_API_KEY") ||
    content.includes("PERPLEXITY_KEY") ||
    /model\s*:\s*["'`]sonar/.test(content)
  );
}

export function transformNodePerplexity(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "@revenium/middleware/perplexity")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Perplexity)"],
    };
  }

  const commentBlock = buildNodeCommentBlock(ctx.design, "perplexity", ctx.filePath);

  result = insertNodeBlock(result, REVENIUM_IMPORT, commentBlock);
  changes.push("Added @revenium/middleware/perplexity import + usage reference");

  return { content: result, modified: true, changes };
}
