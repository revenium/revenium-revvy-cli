/**
 * Transform for Node.js/TypeScript files using the Google GenAI SDK.
 *
 * Uses GoogleGenAIController from @revenium/middleware/google/genai.
 * This transform adds the import + a commented reference block.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_IMPORT = `import "@revenium/middleware/google/genai"; // Revenium: auto-patches Google GenAI SDK`;

export function transformNodeGoogleGenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (
    hasImport(result, "@revenium/middleware/google/genai") ||
    hasImport(result, "@revenium/middleware/google")
  ) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Google GenAI)"],
    };
  }

  const commentBlock = buildNodeCommentBlock(ctx.design, "google-genai", ctx.filePath);

  result = insertNodeBlock(result, REVENIUM_IMPORT, commentBlock);
  changes.push("Added @revenium/middleware/google/genai import + usage reference");

  return { content: result, modified: true, changes };
}
