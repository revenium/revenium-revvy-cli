/**
 * Transform for Node.js/TypeScript files using the Vertex AI SDK.
 *
 * Uses VertexAIController from @revenium/middleware/google/vertex.
 * This transform adds the import + a commented reference block.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_IMPORT = `import "@revenium/middleware/google/vertex"; // Revenium: auto-patches Vertex AI SDK`;

export function transformNodeVertexAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "@revenium/middleware/google/vertex")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Vertex AI)"],
    };
  }

  const commentBlock = buildNodeCommentBlock(ctx.design, "vertex-ai", ctx.filePath);

  result = insertNodeBlock(result, REVENIUM_IMPORT, commentBlock);
  changes.push("Added @revenium/middleware/google/vertex import + usage reference");

  return { content: result, modified: true, changes };
}
