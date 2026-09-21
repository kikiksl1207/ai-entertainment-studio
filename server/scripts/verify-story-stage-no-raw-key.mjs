import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script, runInNewContext } from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const dictionaries = [
  ['COPY', 'tr', 'fiveLocaleCopy', 'safeCopyValues'],
  ['STORY_CONTROL_COPY', 'controlTr', 'fiveLocaleControls', 'safeControlValues'],
  ['ACCESS_COPY', 'accessTr', 'fiveLocaleAccess', 'safeAccessValues'],
  ['PURCHASE_COPY', 'purchaseTr', 'fiveLocalePurchase', 'safePurchaseValues'],
];

export function verifyStoryStageSource(source) {
  // Compile, but do not run, the classic browser script; the TS parser accepts TS-only syntax.
  new Script(source, { filename: 'story-stage.js' });
  const parsed = ts.createSourceFile(
    'story-stage.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  if (parsed.parseDiagnostics.length) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.parseDiagnostics[0].messageText, '\n'));
  }

  const objects = new Map();
  const translators = new Map();
  const usedKeys = new Map(dictionaries.map(([, translator]) => [translator, new Set()]));
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        dictionaries.some(([name]) => name === node.name.text)) {
      if (objects.has(node.name.text)) throw new Error(`Duplicate ${node.name.text} declaration`);
      objects.set(node.name.text, readObject(node.initializer));
    }
    if (ts.isFunctionDeclaration(node) && usedKeys.has(node.name?.text)) {
      if (translators.has(node.name.text)) throw new Error(`Duplicate ${node.name.text} function`);
      translators.set(node.name.text, node);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        usedKeys.has(node.expression.text) && node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])) {
      usedKeys.get(node.expression.text).add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);

  const checks = {};
  for (const [name, translator, completeCheck, safeCheck] of dictionaries) {
    if (['ACCESS_COPY', 'PURCHASE_COPY'].includes(name) && !objects.has(name)) continue;
    if (!objects.has(name)) throw new Error(`Story stage copy declaration missing: ${name}`);
    const audit = auditDictionary(objects.get(name), usedKeys.get(translator));
    checks[completeCheck] = audit.complete;
    checks[safeCheck] = audit.safeValues;
  }
  checks.rawKeyFallbackBlocked = dictionaries.every(([name, translator]) => {
    if (!objects.has(name) && !translators.has(translator)) return true;
    const fn = translators.get(translator);
    if (!fn || !hasSafeTranslationReturns(fn, name)) return false;
    // Evaluate only the parsed translator, never the browser page or adjacent declarations.
    try {
      return [...locales, 'unsupported'].every((locale) =>
        ['story.qa.missing', '__missing_copy__'].every((key) => {
          const value = runInNewContext(`(${fn.getText(parsed)})(__qaKey)`, {
            ...Object.fromEntries(objects), state: { locale }, __qaKey: key,
          }, { timeout: 100 });
          return value === '' || isSafeValue(value, key);
        }),
      );
    } catch {
      return false;
    }
  });
  return checks;
}

function hasSafeTranslationReturns(fn, dictionaryName) {
  function isMember(node) {
    return ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node);
  }
  function isSafeReturn(node) {
    if (!node) return false;
    if (ts.isStringLiteralLike(node)) return node.text === '' || isSafeValue(node.text, '');
    if (ts.isParenthesizedExpression(node)) return isSafeReturn(node.expression);
    if (ts.isConditionalExpression(node)) {
      return isSafeReturn(node.whenTrue) && isSafeReturn(node.whenFalse);
    }
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken,
    ].includes(node.operatorToken.kind)) {
      return isSafeReturn(node.left) && isSafeReturn(node.right);
    }
    // Only values from an audited locale dictionary may replace a literal fallback.
    return isMember(node) && isMember(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === dictionaryName;
  }
  let hasReturn = false;
  function hasUnsafeReturn(node) {
    if (ts.isFunctionLike(node)) return false;
    if (ts.isReturnStatement(node)) {
      hasReturn = true;
      return !isSafeReturn(node.expression);
    }
    return ts.forEachChild(node, hasUnsafeReturn);
  }
  return Boolean(fn.body) && !hasUnsafeReturn(fn.body) && hasReturn;
}

function readObject(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    throw new Error('Story stage copy must be a static object literal');
  }
  const result = Object.create(null);
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new Error('Story stage copy must use static named properties');
    }
    const key = property.name.text;
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate story stage copy key: ${key}`);
    result[key] = ts.isStringLiteralLike(property.initializer)
      ? property.initializer.text
      : readObject(property.initializer);
  }
  return result;
}

function auditDictionary(dictionary, usedKeys) {
  const canonicalKeys = [...new Set([...Object.keys(dictionary.en ?? {}), ...usedKeys])];
  let complete = canonicalKeys.length > 0;
  let safeValues = true;

  for (const locale of locales) {
    const values = dictionary[locale] ?? {};
    const keys = Object.keys(values);
    if (
      !Object.hasOwn(dictionary, locale) ||
      typeof values !== 'object' ||
      keys.length !== canonicalKeys.length ||
      canonicalKeys.some((key) => !keys.includes(key))
    ) {
      complete = false;
    }
    for (const [key, value] of Object.entries(values)) {
      if (!isSafeValue(value, key)) safeValues = false;
    }
  }

  return { complete, safeValues };
}

function isSafeValue(value, key) {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim() !== key &&
    !/\uFFFD|\u00C2|\u00C3/.test(value) &&
    !/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(value.trim());
}

function print(status, checks, failed) {
  const output = JSON.stringify({
    runId: randomUUID(),
    publicPath: '/story-stage',
    status,
    checks,
    mutationExecuted: false,
  });
  if (failed) console.error(output);
  else console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = readFileSync(new URL('../../pages/story-stage.js', import.meta.url), 'utf8');
  const checks = verifyStoryStageSource(source);
  const failed = Object.values(checks).some((value) => value !== true);
  print(failed ? 'failed' : 'passed', checks, failed);
  if (failed) process.exitCode = 1;
}
