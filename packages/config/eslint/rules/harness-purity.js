// Build plan rule 3: packages/harness imports only @edmate/contracts, zod, mathjs and its own
// modules; everything else goes through ports.
//
// An allow-list, so a package nobody has named yet still fails closed. Node built-ins
// (`node:crypto`, `fs`, ...) are NOT allowed: the harness stays runtime-neutral (human decision,
// 17 Oct 2026). Exceptions: `vitest` inside *.test.* / *.spec.* files, and tooling config files
// (eslint.config.js, vitest.config.ts) at the package root, which never ship as harness code.
import path from 'node:path';

const HARNESS_SEGMENT = `${path.sep}packages${path.sep}harness${path.sep}`;
const ALLOWED = [/^zod($|\/)/, /^mathjs$/, /^@edmate\/contracts($|\/)/];
const TEST_ONLY_ALLOWED = [/^vitest($|\/)/];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Tooling config at the package root (eslint.config.js, vitest.config.ts) is not harness code.
const ROOT_TOOLING_CONFIG = /^[\w-]+\.config\.[cm]?[jt]s$/;

/** Absolute path of packages/harness for a file inside it, or null if the file is elsewhere. */
function harnessRoot(filename) {
  const abs = path.resolve(filename);
  const at = abs.lastIndexOf(HARNESS_SEGMENT);
  return at === -1 ? null : abs.slice(0, at + HARNESS_SEGMENT.length);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'packages/harness may import only @edmate/contracts, zod, mathjs and its own modules (build plan rule 3)',
    },
    schema: [],
    messages: {
      forbidden:
        "packages/harness may not import '{{source}}': only @edmate/contracts, zod, mathjs and its own modules are allowed (build plan rule 3). Define a port and inject an adapter instead.",
      nonLiteral:
        'packages/harness may not import a non-literal module path; the purity rule cannot check it (build plan rule 3).',
      requireReference:
        "packages/harness may not use 'require' except as a direct require('<allowed module>') call; the purity rule cannot check what it loads (build plan rule 3).",
    },
  },
  create(context) {
    const root = harnessRoot(context.filename);
    if (root === null) return {};
    if (ROOT_TOOLING_CONFIG.test(path.resolve(context.filename).slice(root.length))) return {};
    const fileDir = path.dirname(path.resolve(context.filename));
    const isTestFile = TEST_FILE.test(context.filename);

    function isAllowed(source) {
      if (source.startsWith('.')) {
        // "Its own modules": a relative path must stay inside packages/harness.
        return path.resolve(fileDir, source).startsWith(root);
      }
      if (ALLOWED.some((re) => re.test(source))) return true;
      return isTestFile && TEST_ONLY_ALLOWED.some((re) => re.test(source));
    }

    function check(node) {
      if (!node || node.type !== 'Literal' || typeof node.value !== 'string') {
        context.report({ node: node ?? context.sourceCode.ast, messageId: 'nonLiteral' });
        return;
      }
      if (!isAllowed(node.value)) {
        context.report({ node, messageId: 'forbidden', data: { source: node.value } });
      }
    }

    /**
     * True if this `require` identifier refers to the global CommonJS `require` (or to nothing
     * declared at all), false for a local variable or parameter named `require`, and false when
     * the identifier is not a variable reference (an object key, for example).
     */
    function isGlobalRequire(identifier) {
      const scope = context.sourceCode.getScope(identifier);
      const ref = scope.references.find((r) => r.identifier === identifier);
      if (!ref) return false;
      return !ref.resolved || ref.resolved.scope.type === 'global';
    }

    function isRequireProperty(node) {
      return node.computed
        ? node.property.type === 'Literal' && node.property.value === 'require'
        : node.property.type === 'Identifier' && node.property.name === 'require';
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => node.source && check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportEqualsDeclaration: (node) =>
        node.moduleReference.type === 'TSExternalModuleReference' &&
        check(node.moduleReference.expression),
      // A direct `require('<literal>')` call is checked like an import.
      CallExpression: (node) =>
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        isGlobalRequire(node.callee) &&
        check(node.arguments[0]),
      // Any other use of the global `require` (aliasing, passing it, `typeof`) fails closed:
      // the rule can't see what it would load.
      Identifier: (node) => {
        if (node.name !== 'require' || !isGlobalRequire(node)) return;
        if (node.parent.type === 'CallExpression' && node.parent.callee === node) return;
        context.report({ node, messageId: 'requireReference' });
      },
      // `module.require`, `globalThis.require`, `x['require']`: fail closed.
      MemberExpression: (node) =>
        isRequireProperty(node) && context.report({ node, messageId: 'requireReference' }),
    };
  },
};
