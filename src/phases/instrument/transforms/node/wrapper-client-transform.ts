/**
 * Shared transform for the Node providers whose Revenium middleware is a client
 * wrapper (OpenAI, Perplexity): `Initialize()` + `GetClient()`, then method
 * chains such as `client.chat().completions().create(params, metadata)`.
 *
 * Nothing is metered until the app's calls move to the wrapped client, and that
 * client's API differs from the SDK's, so call sites are not rewritten. The
 * transform adds no import (the generated helper initializes the middleware
 * once and exports the wrapped client); it marks every raw-client construction
 * with a TODO(revenium) that spells out the change, and adds the reference block.
 *
 * Every edit is placed from the parsed AST, never from a text search, so it can
 * only land in code: a prompt string that mentions `new OpenAI(` is not touched.
 */

import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { parseNodeSource, traverseNodeAst } from "../../../scan/detectors/ast/node-ast.js";
import type { TransformContext, TransformResult } from "./base-node-transform.js";
import {
  buildNodeCommentBlock,
  insertNodeBlock,
  isGeneratedHelperSpecifier,
  WRAPPER_CLIENTS,
  type WrapperClientProvider,
} from "./base-node-transform.js";

const RAW_CLIENT_TODO_MARKER = "TODO(revenium)";
const SDK_MODULE = "openai";
const SDK_CONSTRUCTORS = new Set(["OpenAI", "AzureOpenAI", "default"]);
const PERPLEXITY_HINT = /perplexity/i;

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(content: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), content);
}

function lineStartOf(content: string, offset: number): number {
  return content.lastIndexOf("\n", offset - 1) + 1;
}

/** A statement's whole line when nothing else shares it, else just the statement. */
function removalOf(content: string, node: t.Node): Edit {
  const start = node.start!;
  const end = node.end!;
  const lineStart = lineStartOf(content, start);
  const newline = content.indexOf("\n", end);
  const lineEnd = newline < 0 ? content.length : newline;
  const aloneOnLine = content.slice(lineStart, start).trim() === "" && content.slice(end, lineEnd).trim() === "";
  return aloneOnLine
    ? { start: lineStart, end: newline < 0 ? lineEnd : newline + 1, text: "" }
    : { start, end, text: "" };
}

function buildRawClientTodo(provider: WrapperClientProvider, indent: string, filePath?: string): string[] {
  const { displayName, middlewareSubpath, clientName, obtainClient, calls } = WRAPPER_CLIENTS[provider];
  return [
    `${RAW_CLIENT_TODO_MARKER}: this ${displayName} client is not metered. ${middlewareSubpath} wraps the client, it does not patch it.`,
    `  Use the wrapped client instead:`,
    ...obtainClient(filePath).map((line) => `    ${line}`),
    `  then call it with method chains and the metadata as the second argument:`,
    `    ${calls.map((call) => `${clientName}.${call}(params, metadata)`).join(", ")}`,
  ].map((line) => `${indent}// ${line}`);
}

function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}

function hasTodoAbove(lines: string[], lineIndex: number): boolean {
  for (let i = lineIndex - 1; i >= 0 && isCommentLine(lines[i]!); i--) {
    if (lines[i]!.includes(RAW_CLIENT_TODO_MARKER)) return true;
  }
  return false;
}

interface FileFacts {
  constructions: Array<{ node: t.NewExpression; statement: t.Node; perplexityHint: boolean }>;
  /** Ranges where a new line would change a value or rendered text rather than add a comment. */
  textRanges: Array<[number, number]>;
  importsHelper: boolean;
  importsMiddleware: Set<string>;
  program: NodePath<t.Program> | null;
}

function sdkBindings(ast: t.File): { constructors: Set<string>; namespaces: Set<string> } {
  const constructors = new Set<string>();
  const namespaces = new Set<string>();
  traverseNodeAst(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== SDK_MODULE) return;
      for (const spec of path.node.specifiers) {
        if (t.isImportDefaultSpecifier(spec)) constructors.add(spec.local.name);
        if (t.isImportNamespaceSpecifier(spec)) namespaces.add(spec.local.name);
        if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported) && SDK_CONSTRUCTORS.has(spec.imported.name)) {
          constructors.add(spec.local.name);
        }
      }
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      const isSdkRequire = t.isCallExpression(init) && t.isIdentifier(init.callee, { name: "require" }) &&
        t.isStringLiteral(init.arguments[0], { value: SDK_MODULE });
      if (!isSdkRequire) return;
      const id = path.node.id;
      if (t.isIdentifier(id)) {
        constructors.add(id.name);
        namespaces.add(id.name);
      } else if (t.isObjectPattern(id)) {
        for (const prop of id.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && SDK_CONSTRUCTORS.has(prop.key.name) && t.isIdentifier(prop.value)) {
            constructors.add(prop.value.name);
          }
        }
      }
    },
  });
  return { constructors, namespaces };
}

function isRawClientConstruction(node: t.NewExpression, bindings: ReturnType<typeof sdkBindings>): boolean {
  const callee = node.callee;
  if (t.isIdentifier(callee)) return bindings.constructors.has(callee.name);
  return t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object) &&
    bindings.namespaces.has(callee.object.name) && t.isIdentifier(callee.property) && SDK_CONSTRUCTORS.has(callee.property.name);
}

// `import type { X }` and `import { type X }` are erased at compile time, so
// they never run the helper's Initialize().
function importLoadsAtRuntime(declaration: t.ImportDeclaration): boolean {
  if (declaration.importKind === "type") return false;
  if (declaration.specifiers.length === 0) return true;
  return declaration.specifiers.some((spec) => !(t.isImportSpecifier(spec) && spec.importKind === "type"));
}

function collectFacts(content: string, ast: t.File): FileFacts {
  const bindings = sdkBindings(ast);
  const facts: FileFacts = { constructions: [], textRanges: [], importsHelper: false, importsMiddleware: new Set(), program: null };
  const noteSource = (source: string, loadsAtRuntime = true) => {
    if (loadsAtRuntime && isGeneratedHelperSpecifier(source)) facts.importsHelper = true;
    facts.importsMiddleware.add(source);
  };
  traverseNodeAst(ast, {
    Program(path) {
      facts.program = path;
    },
    ImportDeclaration(path) {
      noteSource(path.node.source.value, importLoadsAtRuntime(path.node));
    },
    CallExpression(path) {
      const arg = path.node.arguments[0];
      if (t.isIdentifier(path.node.callee, { name: "require" }) && t.isStringLiteral(arg)) noteSource(arg.value);
    },
    NewExpression(path) {
      if (!isRawClientConstruction(path.node, bindings)) return;
      const args = path.node.arguments;
      const argsText = args.length > 0 ? content.slice(args[0]!.start!, args[args.length - 1]!.end!) : "";
      facts.constructions.push({
        node: path.node,
        statement: path.getStatementParent()?.node ?? path.node,
        perplexityHint: PERPLEXITY_HINT.test(argsText),
      });
    },
    "StringLiteral|TemplateLiteral|JSXText|JSXElement|JSXFragment"(path: NodePath) {
      facts.textRanges.push([path.node.start!, path.node.end!]);
    },
  });
  return facts;
}

function insideText(offset: number, textRanges: Array<[number, number]>): boolean {
  return textRanges.some(([start, end]) => start < offset && offset < end);
}

function todoEdits(
  content: string,
  facts: FileFacts,
  fallbackProvider: WrapperClientProvider,
  filePath?: string,
): Edit[] {
  const lines = content.split("\n");
  const anyPerplexityHint = facts.constructions.some((c) => c.perplexityHint);
  const edits: Edit[] = [];
  const marked = new Set<number>();
  for (const construction of facts.constructions) {
    const candidates = [lineStartOf(content, construction.node.start!), lineStartOf(content, construction.statement.start!)];
    const at = candidates.find((offset) => !insideText(offset, facts.textRanges));
    if (at === undefined || marked.has(at)) continue;
    const lineIndex = content.slice(0, at).split("\n").length - 1;
    if (hasTodoAbove(lines, lineIndex)) continue;
    const provider = construction.perplexityHint ? "perplexity" : anyPerplexityHint ? "openai" : fallbackProvider;
    const indent = /^\s*/.exec(lines[lineIndex]!)![0];
    edits.push({ start: at, end: at, text: `${buildRawClientTodo(provider, indent, filePath).join("\n")}\n` });
    marked.add(at);
  }
  return edits;
}

// The import earlier releases added to every file, matched on its bindings so
// any formatting (Prettier's multi-line form, single quotes, CRLF) is found.
// Its GetClient binding was never used, which fails noUnusedLocals. Its
// Initialize() call is kept unless the file also imports the generated helper,
// which initializes once: another module's GetClient() may depend on it, and
// GetClient() throws when nothing initialized.
const LEGACY_IMPORT_BINDINGS: Record<WrapperClientProvider, { Initialize: string; GetClient: string }> = {
  openai: { Initialize: "InitializeRevenium", GetClient: "GetReveniumOpenAI" },
  perplexity: { Initialize: "InitializeReveniumPerplexity", GetClient: "GetReveniumPerplexity" },
};

function legacyImportEdits(content: string, facts: FileFacts, provider: WrapperClientProvider): Edit[] {
  const program = facts.program;
  if (!program) return [];
  const expected = LEGACY_IMPORT_BINDINGS[provider];
  const declaration = program.node.body.find((statement): statement is t.ImportDeclaration =>
    t.isImportDeclaration(statement) &&
    statement.source.value === WRAPPER_CLIENTS[provider].middlewareSubpath &&
    statement.specifiers.length === 2 &&
    statement.specifiers.every((spec) =>
      t.isImportSpecifier(spec) && t.isIdentifier(spec.imported) &&
      expected[spec.imported.name as keyof typeof expected] === spec.local.name));
  if (!declaration) return [];

  const initializeCalls = facts.importsHelper
    ? program.node.body.filter((statement): statement is t.ExpressionStatement =>
        t.isExpressionStatement(statement) && t.isCallExpression(statement.expression) &&
        t.isIdentifier(statement.expression.callee, { name: expected.Initialize }) &&
        statement.expression.arguments.length === 0)
    : [];
  const removedCallees = new Set<t.Node>(initializeCalls.map((s) => (s.expression as t.CallExpression).callee));
  const stillUsed = (local: string) =>
    (program.scope.getBinding(local)?.referencePaths ?? []).some((ref) => !removedCallees.has(ref.node));

  const kept = (declaration.specifiers as t.ImportSpecifier[]).filter((spec) => stillUsed(spec.local.name));
  if (kept.length === declaration.specifiers.length) return [];

  const source = (declaration.source.extra?.raw as string | undefined) ?? JSON.stringify(declaration.source.value);
  const importEdit = kept.length > 0
    ? {
        start: declaration.start!,
        end: declaration.end!,
        text: `import { ${kept.map((spec) => `${(spec.imported as t.Identifier).name} as ${spec.local.name}`).join(", ")} } from ${source};`,
      }
    : removalOf(content, declaration);
  return [importEdit, ...initializeCalls.map((statement) => removalOf(content, statement))];
}

function needsReference(content: string, facts: FileFacts, provider: WrapperClientProvider): boolean {
  const { displayName, middlewareSubpath } = WRAPPER_CLIENTS[provider];
  const hasReference = content.includes(`Usage with Revenium ${displayName} middleware`);
  const usesWrapper = facts.importsHelper || facts.importsMiddleware.has(middlewareSubpath);
  return !hasReference && !usesWrapper;
}

export function transformNodeWrapperClient(
  content: string,
  ctx: TransformContext,
  provider: WrapperClientProvider,
): TransformResult {
  const { displayName, middlewareSubpath } = WRAPPER_CLIENTS[provider];
  const ast = parseNodeSource(content);
  if (!ast) {
    return { content, modified: false, changes: [`Skipped ${displayName}: the file does not parse, so revvy left it unchanged`] };
  }
  const facts = collectFacts(content, ast);
  const changes: string[] = [];

  const legacy = legacyImportEdits(content, facts, provider);
  if (legacy.length > 0) changes.push(`Removed the unused bindings an earlier revvy release imported from ${middlewareSubpath}`);
  const todos = todoEdits(content, facts, provider, ctx.filePath);
  if (todos.length > 0) {
    changes.push(`Marked ${todos.length} client construction(s) with a ${RAW_CLIENT_TODO_MARKER} to move to the wrapped client (not metered until then)`);
  }
  let result = applyEdits(content, [...legacy, ...todos]);
  const editedAst = result === content ? ast : parseNodeSource(result);
  if (!editedAst) {
    return { content, modified: false, changes: [`Skipped ${displayName}: the edits would not parse, so revvy left the file unchanged`] };
  }

  if (needsReference(result, collectFacts(result, editedAst), provider)) {
    result = insertNodeBlock(result, null, buildNodeCommentBlock(ctx.design, provider, ctx.filePath));
    changes.push(`Added the ${displayName} wrapped-client usage reference`);
  }

  if (result === content) {
    return { content, modified: false, changes: [`Already instrumented with Revenium (${displayName})`] };
  }
  return { content: result, modified: true, changes };
}
