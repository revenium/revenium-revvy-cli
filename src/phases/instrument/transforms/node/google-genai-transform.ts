/**
 * Transform for Node.js/TypeScript files using a Google GenAI SDK.
 *
 * Files on `@google/genai` get a side-effect import: from @revenium/middleware
 * 2.1.0 it meters the app's own GoogleGenAI client, with usageMetadata on the
 * call. Files on the older `@google/generative-ai` SDK, which that import does
 * not meter, get the GoogleGenAIController import and its reference block.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { hasImport, buildNodeCommentBlock, insertNodeBlock } from "./base-node-transform.js";

const REVENIUM_SUBPATH = "@revenium/middleware/google/genai";
const METERED_SDK_SPECIFIER = `["']@google\\/genai(?:\\/node)?["']`;
const SDK_ESM_IMPORT = new RegExp(`(?:\\bfrom|\\bimport)\\s*${METERED_SDK_SPECIFIER}`);
const SDK_REQUIRE = new RegExp(`\\brequire\\(\\s*${METERED_SDK_SPECIFIER}\\s*\\)`);

const SIDE_EFFECT_IMPORT = `import "${REVENIUM_SUBPATH}"; // Revenium: meters this app's GoogleGenAI client (@revenium/middleware >= 2.1.0)`;
// The middleware patches only the copy of @google/genai loaded the same way it
// is (verified on 2.1.0: require app + ESM middleware meters nothing).
const SIDE_EFFECT_REQUIRE = `require("${REVENIUM_SUBPATH}"); // Revenium: meters this app's GoogleGenAI client (@revenium/middleware >= 2.1.0)`;
const CONTROLLER_IMPORT = `import { GoogleGenAIController } from "${REVENIUM_SUBPATH}"; // Revenium: controller wrapper for Google GenAI`;

// The exact line earlier revvy releases added to every Google GenAI file. On
// @google/genai it names a controller nothing uses, so TypeScript elides it.
const UNUSED_CONTROLLER_IMPORT_LINE = /^import \{ GoogleGenAIController \} from "@revenium\/middleware\/google\/genai";[^\n]*$/m;

// Only whole comment lines are dropped: regex comment stripping cannot tell a
// `//` or `/*` inside a string from a real comment, and dropping too little only
// means keeping an import, never breaking a file.
function codeOutsideCommentLines(code: string): string {
  return code
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const REFERENCE_BLOCK = /^\/\/ ── Revenium: middleware usage reference ─+\n(?:\/\/[^\n]*\n)*?\/\/ ─{20,}$/m;

// Earlier releases also wrote a reference block that teaches the controller and
// spells out `new GoogleGenAIController()`, so it is ignored when looking for a
// use and replaced together with the import. Any other reference (an alias
// included) keeps the import.
function upgradeUnusedControllerImport(content: string, commentBlock: string): string | null {
  if (!UNUSED_CONTROLLER_IMPORT_LINE.test(content)) return null;
  const withoutOldReference = content.replace(REFERENCE_BLOCK, "");
  const rest = codeOutsideCommentLines(withoutOldReference.replace(UNUSED_CONTROLLER_IMPORT_LINE, ""));
  if (/\bGoogleGenAIController\b/.test(rest)) return null;
  const upgraded = content.replace(UNUSED_CONTROLLER_IMPORT_LINE, SIDE_EFFECT_IMPORT);
  return REFERENCE_BLOCK.test(upgraded)
    ? upgraded.replace(REFERENCE_BLOCK, commentBlock)
    : upgraded;
}

const LOCAL_REQUIRE_DEFINITION = /^\s*(?:const|let|var)\s+require\s*=\s*createRequire\([^\n]*$/m;

const FILE_PROLOGUE = /^(?:#![^\n]*\n)?(?:\s*["']use strict["'];?[^\n]*\n)?/;

// An ES module that defines its own `require` with createRequire needs the
// middleware require after that definition. A CommonJS file takes it at the very
// top: a require can sit inside a multi-line expression, so "after the imports"
// is not a safe statement boundary there.
function insertSideEffectRequire(content: string, commentBlock: string): string {
  const definition = LOCAL_REQUIRE_DEFINITION.exec(content);
  const at = definition
    ? definition.index + definition[0].length + 1
    : (FILE_PROLOGUE.exec(content)?.[0].length ?? 0);
  return `${content.slice(0, at)}${SIDE_EFFECT_REQUIRE}\n${commentBlock}\n\n${content.slice(at)}`;
}

export function transformNodeGoogleGenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const loadsSdkByImport = SDK_ESM_IMPORT.test(content);
  const loadsSdkByRequire = !loadsSdkByImport && SDK_REQUIRE.test(content);
  const autoMetered = loadsSdkByImport || loadsSdkByRequire;

  if (hasImport(content, REVENIUM_SUBPATH)) {
    const upgraded = loadsSdkByImport
      ? upgradeUnusedControllerImport(content, buildNodeCommentBlock(ctx.design, "google-genai", ctx.filePath))
      : null;
    if (upgraded !== null) {
      return {
        content: upgraded,
        modified: true,
        changes: [`Replaced the unused GoogleGenAIController import with a ${REVENIUM_SUBPATH} side-effect import, which meters the existing GoogleGenAI client`],
      };
    }
    return {
      content,
      modified: false,
      changes: ["Already instrumented with Revenium (Google GenAI)"],
    };
  }

  const commentBlock = buildNodeCommentBlock(
    ctx.design,
    autoMetered ? "google-genai" : "google-genai-controller",
    ctx.filePath,
  );
  const result = loadsSdkByRequire
    ? insertSideEffectRequire(content, commentBlock)
    : insertNodeBlock(content, loadsSdkByImport ? SIDE_EFFECT_IMPORT : CONTROLLER_IMPORT, commentBlock);

  return {
    content: result,
    modified: true,
    changes: [
      autoMetered
        ? `Added ${REVENIUM_SUBPATH} import (meters the existing GoogleGenAI client) + usage reference`
        : `Added ${REVENIUM_SUBPATH} controller import + usage reference`,
    ],
  };
}
