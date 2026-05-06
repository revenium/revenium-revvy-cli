/**
 * Transform for Node.js/TypeScript files using the OpenAI SDK.
 *
 * The Revenium OpenAI middleware uses a client wrapper pattern:
 * Initialize() + GetClient() + method-chain .chat().completions().create(params, metadata)
 *
 * This transform adds the import + a commented reference block showing
 * the developer how to refactor their code to use the wrapped client.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_IMPORT = `import { Initialize as InitializeRevenium, GetClient as GetReveniumOpenAI } from "@revenium/middleware/openai";`;
const REVENIUM_INIT = `InitializeRevenium();`;

export function transformNodeOpenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "@revenium/middleware/openai")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium"],
    };
  }

  const commentBlock = buildNodeCommentBlock(ctx.design, "openai", ctx.filePath);

  result = insertNodeBlock(result, `${REVENIUM_IMPORT}\n${REVENIUM_INIT}`, commentBlock);
  changes.push(
    "Added @revenium/middleware/openai import + Initialize() + usage reference",
  );

  return { content: result, modified: true, changes };
}
