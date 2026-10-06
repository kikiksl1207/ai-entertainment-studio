import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('../server/node_modules/typescript');
const source = readFileSync(new URL('../server/src/admin/admin.controller.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('admin.controller.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AdminController');

function permissions(name) {
  const method = owner.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method);
  const call = (ts.getDecorators(method) || []).map(node => node.expression).find(node =>
    ts.isCallExpression(node) && node.expression.getText(ast) === 'RequireAdminPermissions');
  assert.ok(call);
  return call.arguments.map(node => { assert.ok(ts.isStringLiteral(node)); return node.text; });
}

test('account-internal creator access diagnostics require explicit super authority', () => {
  assert.deepEqual(permissions('getBackstageCreatorAccessDiagnostics'), ['*']);
});

test('normal creator access listing keeps its sales read permission', () => {
  assert.deepEqual(permissions('getBackstageCreatorAccess'), ['creators:read']);
});

test('creator access grants remain a separate write operation', () => {
  assert.deepEqual(permissions('grantBackstageCreatorAccess'), ['creators:write']);
});
