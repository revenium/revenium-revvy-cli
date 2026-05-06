/**
 * Transform for Node.js/TypeScript files using the Anthropic SDK.
 *
 * `@revenium/middleware/anthropic` monkey-patches the Anthropic SDK on import.
 * This transform adds the import + a commented reference block.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_IMPORT = `import "@revenium/middleware/anthropic"; // Revenium: auto-patches Anthropic SDK`;

export function transformNodeAnthropic(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "@revenium/middleware/anthropic")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium"],
    };
  }

  const commentBlock = buildNodeCommentBlock(ctx.design, "anthropic", ctx.filePath);

  result = insertNodeBlock(result, REVENIUM_IMPORT, commentBlock);
  changes.push("Added @revenium/middleware/anthropic import + usage reference");

  return { content: result, modified: true, changes };
}
