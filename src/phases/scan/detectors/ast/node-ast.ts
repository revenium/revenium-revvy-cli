/**
 * AST-based AI call-site detection for Node/TypeScript/JavaScript.
 *
 * Uses @babel/parser + @babel/traverse so we can:
 *   - resolve every CallExpression's root binding via import declarations
 *   - filter calls so we only count those that originate from a known SDK
 *   - avoid double-counting the same call across multiple regex patterns
 *   - skip strings, comments, and JSDoc that would fool a regex matcher
 */

import { parse, type ParserOptions } from "@babel/parser";
import * as traverseNs from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

import type { CallSite } from "../../../../types/scan-result.js";
import {
  getPatternsForLanguage,
  type ProviderPattern,
} from "../../patterns/index.js";

// @babel/traverse is a CJS module. Under ESM interop, `import * as x from`
// can resolve to either the function itself, an object with `.default = fn`,
// or even an object with `.default.default = fn` depending on the loader
// (tsx vs node ESM vs tsup bundle). Normalize all variants.
type TraverseFn = (typeof import("@babel/traverse"))["default"];
function normalizeTraverse(mod: unknown): TraverseFn {
  if (typeof mod === "function") return mod as TraverseFn;
  const m = mod as { default?: unknown };
  if (typeof m?.default === "function") return m.default as TraverseFn;
  const inner = (m?.default as { default?: unknown } | undefined)?.default;
  if (typeof inner === "function") return inner as TraverseFn;
  throw new Error("Unable to load @babel/traverse: no callable export found");
}
const traverse: TraverseFn = normalizeTraverse(traverseNs);

const PARSER_OPTIONS: ParserOptions = {
  sourceType: "unambiguous",
  errorRecovery: true,
  allowReturnOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowAwaitOutsideFunction: true,
  plugins: [
    "typescript",
    "jsx",
    "decorators-legacy",
    "classProperties",
    "topLevelAwait",
    "importMeta",
    "dynamicImport",
    "optionalChaining",
    "nullishCoalescingOperator",
  ],
};

/**
 * AI call site enriched with the name of its enclosing function, when one
 * exists. Used by centralized-utility-discovery to figure out which function
 * (not just file) owns most of the AI calls.
 */
export interface NodeCallSite extends CallSite {
  enclosingFunction?: string;
}

interface NodeAstResult {
  callSites: NodeCallSite[];
  /** Imports of Revenium middleware found in the file. */
  reveniumImports: Array<{ importPath: string; lineNumber: number }>;
  /** True iff Babel rejected the source — e.g., the file is now syntactically invalid. */
  parseFailed?: boolean;
}

/**
 * Walks up from a Babel NodePath until it finds the nearest enclosing
 * function and returns a sensible name for it.
 *
 *   function foo() { ... }                  => "foo"
 *   const foo = function () { ... }         => "foo"
 *   const foo = () => { ... }               => "foo"
 *   class Bar { foo() { ... } }             => "Bar.foo"
 *   exports.foo = function () { ... }       => "foo"
 *   { foo() { ... } } (object method)       => "foo"
 *   anonymous function/IIFE                 => undefined
 */
function findEnclosingFunctionName(
  startPath: NodePath<t.CallExpression>,
): string | undefined {
  let current: NodePath<t.Node> | null = startPath;
  while (current) {
    const parentFn = current.getFunctionParent();
    if (!parentFn) return undefined;

    const fn = parentFn.node;

    // Plain function declaration: function foo() {}
    if (t.isFunctionDeclaration(fn) && fn.id) {
      return fn.id.name;
    }

    // Class method: foo() {} → enclosing class adds context.
    if (t.isClassMethod(fn) || t.isClassPrivateMethod(fn)) {
      const key = fn.key;
      const methodName = t.isIdentifier(key) ? key.name : undefined;
      // Walk up to find the enclosing class
      let walker: NodePath<t.Node> | null = parentFn.parentPath ?? null;
      while (walker) {
        if (
          t.isClassDeclaration(walker.node) ||
          t.isClassExpression(walker.node)
        ) {
          const cls = walker.node as t.ClassDeclaration | t.ClassExpression;
          const className = cls.id?.name;
          if (className && methodName) return `${className}.${methodName}`;
          if (methodName) return methodName;
          break;
        }
        walker = walker.parentPath ?? null;
      }
      if (methodName) return methodName;
    }

    // Object method: { foo() {} }
    if (t.isObjectMethod(fn)) {
      const key = fn.key;
      if (t.isIdentifier(key)) return key.name;
    }

    // Function expression / arrow assigned to a variable
    if (t.isFunctionExpression(fn) || t.isArrowFunctionExpression(fn)) {
      const parentNode = parentFn.parentPath?.node;
      // const X = () => {}  / const X = function () {}
      if (
        parentNode &&
        t.isVariableDeclarator(parentNode) &&
        t.isIdentifier(parentNode.id)
      ) {
        return parentNode.id.name;
      }
      // X = () => {} / exports.X = () => {} / module.exports.X = () => {}
      if (parentNode && t.isAssignmentExpression(parentNode)) {
        const left = parentNode.left;
        if (t.isIdentifier(left)) return left.name;
        if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
          return left.property.name;
        }
      }
      // Object property: { foo: () => {} }
      if (
        parentNode &&
        t.isObjectProperty(parentNode) &&
        t.isIdentifier(parentNode.key)
      ) {
        return parentNode.key.name;
      }
      // Named function expression: const _ = function foo() {}
      if (t.isFunctionExpression(fn) && fn.id) return fn.id.name;
    }

    // Couldn't name this one — keep climbing in case it's nested in a named fn.
    current = parentFn.parentPath ?? null;
  }
  return undefined;
}

/**
 * Returns the dot-joined method chain ending in the called method, e.g.
 *   client.chat.completions.create(...)         => "chat.completions.create"
 *   client.chat().completions().create(...)     => "chat().completions().create"
 *   foo.bar(...)                                 => "bar"
 *   bar(...)                                     => "bar"
 *
 * Also returns the root identifier name (e.g. "client", "foo", "bar") so the
 * caller can map it back to the import that produced it.
 */
function describeCallee(callee: t.Expression | t.V8IntrinsicIdentifier): {
  rootName: string | null;
  methodChain: string;
} | null {
  // Bare call:  doSomething(...)
  if (t.isIdentifier(callee)) {
    return { rootName: callee.name, methodChain: callee.name };
  }

  // Member chain — possibly with intermediate calls like .chat().completions()
  if (t.isMemberExpression(callee)) {
    const segments: string[] = [];

    let current: t.Expression | t.V8IntrinsicIdentifier | t.Super = callee;
    let rootName: string | null = null;

    // Walk the chain inside-out, collecting "name" or "name()" segments.
    while (current) {
      if (t.isMemberExpression(current)) {
        const prop = current.property;
        if (current.computed || !t.isIdentifier(prop)) {
          // computed access like obj["foo"] — bail; we don't try to resolve.
          return null;
        }
        segments.unshift(prop.name);
        current = current.object as t.Expression;
      } else if (t.isCallExpression(current)) {
        // Intermediate call: the child becomes "name()" instead of "name".
        const inner = current.callee;
        if (t.isMemberExpression(inner)) {
          const prop = inner.property;
          if (inner.computed || !t.isIdentifier(prop)) return null;
          segments.unshift(`${prop.name}()`);
          current = inner.object as t.Expression;
        } else if (t.isIdentifier(inner)) {
          // Root is itself a function call: e.g. foo().bar
          // We treat foo() as the root — provider attribution becomes harder
          // but we can still return the chain.
          rootName = inner.name;
          break;
        } else {
          return null;
        }
      } else if (t.isIdentifier(current)) {
        rootName = current.name;
        break;
      } else if (t.isThisExpression(current)) {
        rootName = "this";
        break;
      } else {
        // new Foo().bar(...) etc — give up on root resolution but keep chain.
        rootName = null;
        break;
      }
    }

    return { rootName, methodChain: segments.join(".") };
  }

  return null;
}

/**
 * Extracts the package name from an import path.
 *   "openai"                  => "openai"
 *   "@anthropic-ai/sdk"       => "@anthropic-ai/sdk"
 *   "@revenium/middleware/openai" => "@revenium/middleware"
 *   "openai/resources"        => "openai"
 */
function packageOf(source: string): string {
  if (source.startsWith("@")) {
    const parts = source.split("/");
    return parts.slice(0, 2).join("/");
  }
  return source.split("/")[0]!;
}

/**
 * Build a map of binding names → set of provider names that the binding
 * could refer to, based on all imports in the file.
 */
function buildBindingMap(
  ast: t.File,
  patterns: ProviderPattern[],
): { bindingToProviders: Map<string, Set<string>>; reveniumImports: NodeAstResult["reveniumImports"] } {
  const bindingToProviders = new Map<string, Set<string>>();
  const reveniumImports: NodeAstResult["reveniumImports"] = [];

  // Index: package name → providers that own that package
  const packageToProviders = new Map<string, Set<string>>();
  for (const p of patterns) {
    for (const pkg of p.packageNames) {
      const set = packageToProviders.get(pkg) ?? new Set();
      set.add(p.provider);
      packageToProviders.set(pkg, set);
    }
  }

  // Index of revenium middleware imports for the instrumentation detector
  const reveniumImportPaths = new Set<string>();
  for (const p of patterns) {
    for (const imp of p.instrumentationImports) reveniumImportPaths.add(imp);
  }

  const addBinding = (name: string, providers: Set<string>) => {
    const existing = bindingToProviders.get(name);
    if (existing) {
      providers.forEach((p) => existing.add(p));
    } else {
      bindingToProviders.set(name, new Set(providers));
    }
  };

  /**
   * Helper: record a Revenium middleware import (static, dynamic, or require)
   * if the source matches one of our known instrumentation import paths.
   * Codebases sometimes use lazy `import()` or `require()` to defer the SDK
   * patch (e.g. `reveniumMiddlewareLoad = import("@revenium/middleware/anthropic")`)
   * to sidestep tsx ESM/CJS require-cycles. The runtime patch is real; the
   * scanner just has to recognize the deferred shape.
   */
  const recordReveniumImport = (source: string, lineNumber: number) => {
    const isReveniumMiddleware =
      reveniumImportPaths.has(source) ||
      Array.from(reveniumImportPaths).some(
        (rp) => source === rp || source.startsWith(`${rp}/`),
      );
    if (isReveniumMiddleware) {
      reveniumImports.push({ importPath: source, lineNumber });
    }
  };

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const pkg = packageOf(source);
      const providers = packageToProviders.get(pkg);
      recordReveniumImport(source, path.node.loc?.start.line ?? 0);

      if (!providers) return;

      for (const spec of path.node.specifiers) {
        if (
          t.isImportDefaultSpecifier(spec) ||
          t.isImportNamespaceSpecifier(spec) ||
          t.isImportSpecifier(spec)
        ) {
          addBinding(spec.local.name, providers);
        }
      }
    },

    /**
     * Catch dynamic + lazy import shapes:
     *   import("@revenium/middleware/anthropic")
     *   await import("@revenium/middleware/anthropic")
     *   const reveniumMiddlewareLoad = import("@revenium/middleware/anthropic")
     *   require("@revenium/middleware/anthropic")
     *
     * For static `import "..."` we already handle it above via ImportDeclaration.
     * Without this, codebases that lazy-load the middleware (common on tsx /
     * ESM-CJS boundaries) get a false-positive `revvy check` failure even
     * though the patch lands at runtime.
     */
    CallExpression(path) {
      const node = path.node;
      const arg = node.arguments[0];
      if (!arg || !t.isStringLiteral(arg)) return;
      const source = arg.value;
      const lineNumber = node.loc?.start.line ?? 0;

      // Dynamic `import("...")` — Babel represents this with callee as `Import` token.
      // (Depending on plugins, can also be Identifier with name "import" in older configs.)
      const isDynamicImport =
        t.isImport(node.callee) ||
        (t.isIdentifier(node.callee) && node.callee.name === "import");

      // CommonJS bare `require("...")` (without an assignment — those are caught in
      // VariableDeclarator below). Top-level `require("@revenium/...")` for side
      // effects is a real pattern.
      const isRequire =
        t.isIdentifier(node.callee, { name: "require" });

      if (!isDynamicImport && !isRequire) return;

      recordReveniumImport(source, lineNumber);
    },

    VariableDeclarator(path) {
      // Catch `const X = require('openai')` and CommonJS-style.
      const init = path.node.init;
      if (!init) return;

      // Bare require: const X = require("openai")
      if (
        t.isCallExpression(init) &&
        t.isIdentifier(init.callee, { name: "require" }) &&
        init.arguments.length === 1 &&
        t.isStringLiteral(init.arguments[0])
      ) {
        const source = init.arguments[0].value;
        const pkg = packageOf(source);
        const providers = packageToProviders.get(pkg);
        if (!providers) return;

        const id = path.node.id;
        if (t.isIdentifier(id)) {
          addBinding(id.name, providers);
        } else if (t.isObjectPattern(id)) {
          for (const prop of id.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
              addBinding(prop.value.name, providers);
            }
          }
        }
      }

      // Constructor instance: const client = new OpenAI(); const a = new Anthropic();
      // We propagate provider attribution from the constructor binding to the new variable.
      if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
        const ctorProviders = bindingToProviders.get(init.callee.name);
        if (ctorProviders && t.isIdentifier(path.node.id)) {
          addBinding(path.node.id.name, ctorProviders);
        }
      }

      // Method call result: const model = vertex.getGenerativeModel(...)
      // Propagate provider attribution from the receiver to the result variable.
      // Covers patterns like:
      //   const generativeModel = vertex.getGenerativeModel({...})
      //   const chat = model.startChat({...})
      if (
        t.isCallExpression(init) &&
        t.isMemberExpression(init.callee) &&
        t.isIdentifier(path.node.id)
      ) {
        const obj = init.callee.object;
        if (t.isIdentifier(obj)) {
          const receiverProviders = bindingToProviders.get(obj.name);
          if (receiverProviders) {
            addBinding(path.node.id.name, receiverProviders);
          }
        }
      }

      // Await of method call: const model = await vertex.getGenerativeModel(...)
      if (
        t.isAwaitExpression(init) &&
        t.isCallExpression(init.argument) &&
        t.isMemberExpression(init.argument.callee) &&
        t.isIdentifier(path.node.id)
      ) {
        const obj = init.argument.callee.object;
        if (t.isIdentifier(obj)) {
          const receiverProviders = bindingToProviders.get(obj.name);
          if (receiverProviders) {
            addBinding(path.node.id.name, receiverProviders);
          }
        }
      }
    },
  });

  return { bindingToProviders, reveniumImports };
}

export function detectNodeCallSites(
  filePath: string,
  content: string,
): NodeAstResult {
  const patterns = getPatternsForLanguage("node");
  const callSites: CallSite[] = [];

  let ast: t.File;
  try {
    ast = parse(content, PARSER_OPTIONS);
  } catch {
    // Fall back to nothing if the file fails to parse — we don't want a single
    // weird file to abort the whole scan. Surface the failure so callers
    // (specifically `revvy check`) can detect when an instrumentation pass left
    // a previously-valid file unparseable.
    return { callSites: [], reveniumImports: [], parseFailed: true };
  }

  const { bindingToProviders, reveniumImports } = buildBindingMap(ast, patterns);

  // Pre-build a lookup: methodChain → list of (provider, callPattern)
  const methodIndex = new Map<
    string,
    Array<{ provider: ProviderPattern; methodChain: string; method: string; operationType: ProviderPattern["callPatterns"][number]["operationType"] }>
  >();
  for (const provider of patterns) {
    for (const cp of provider.callPatterns) {
      const arr = methodIndex.get(cp.methodChain) ?? [];
      arr.push({
        provider,
        methodChain: cp.methodChain,
        method: cp.method ?? cp.methodChain,
        operationType: cp.operationType,
      });
      methodIndex.set(cp.methodChain, arr);
    }
  }

  // Track sites we've already recorded so we don't double-count when the same
  // (file, line, methodChain) keeps appearing.
  const seen = new Set<string>();
  const lines = content.split("\n");

  traverse(ast, {
    CallExpression(path) {
      const desc = describeCallee(path.node.callee);
      if (!desc) return;

      const candidates = methodIndex.get(desc.methodChain);
      if (!candidates) return;

      // Identify which provider this call most likely belongs to.
      // 1) If we can resolve the root binding to a provider import, prefer it.
      // 2) Else, fall back to any candidate (may be ambiguous when provider can't be resolved).
      let chosen = candidates[0]!;

      if (desc.rootName) {
        const rootProviders = bindingToProviders.get(desc.rootName);
        if (rootProviders) {
          const match = candidates.find((c) =>
            rootProviders.has(c.provider.provider),
          );
          if (match) {
            chosen = match;
          } else {
            // Root resolves to a provider, but the called methodChain doesn't
            // belong to that provider — likely a false positive (e.g. some
            // unrelated `.invoke()` on a non-LangChain object). Skip.
            return;
          }
        } else if (desc.rootName !== "this") {
          // Root is not a known provider binding. We require explicit resolution
          // for chains that are very generic (single-segment like "invoke",
          // "stream", "send", "kickoff") to avoid false positives.
          if (!desc.methodChain.includes(".") && !desc.methodChain.includes("(")) {
            return;
          }
        }
      }

      const lineNumber = path.node.loc?.start.line ?? 0;
      const key = `${filePath}:${lineNumber}:${chosen.provider.provider}:${chosen.methodChain}`;
      if (seen.has(key)) return;
      seen.add(key);

      const snippet = (lines[lineNumber - 1] || "").trim();

      const enclosingFunction = findEnclosingFunctionName(path);

      callSites.push({
        filePath,
        lineNumber,
        provider: chosen.provider.provider,
        method: chosen.method,
        operationType: chosen.operationType,
        snippet,
        enclosingFunction,
      });
    },
  });

  return { callSites, reveniumImports };
}
