import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { verifyStoryStageSource } from './verify-story-stage-no-raw-key.mjs';
import { accessCopySource, accessTranslatorSource } from './fixtures/story-stage-access-copy.mjs';

const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const specs = [
  ['COPY', 'tr', 'title', 'fiveLocaleCopy', 'safeCopyValues'],
  ['STORY_CONTROL_COPY', 'controlTr', 'resumeFrom', 'fiveLocaleControls', 'safeControlValues'],
  ['ACCESS_COPY', 'accessTr', 'priceLabel', 'fiveLocaleAccess', 'safeAccessValues'],
];
const mainSource = readFileSync(new URL('../../pages/story-stage.js', import.meta.url), 'utf8');
const historicalCopy = dictionaries();
delete historicalCopy.ACCESS_COPY;
const historicalInsertion = fixture(historicalCopy)
  .replace('const state =', `${accessCopySource}\n${accessTranslatorSource}\nconst state =`);

function dictionaries() {
  return Object.fromEntries(specs.map(([name, , key]) => [name,
    Object.fromEntries(locales.map((locale) => [locale, { [key]: 'Visible copy' }])),
  ]));
}

function fixture(copy = dictionaries()) {
  const present = specs.filter(([name]) => Object.hasOwn(copy, name));
  return `(function initStoryStagePage() {
    ${present.map(([name]) => `const ${name} = ${JSON.stringify(copy[name])};`).join('\n')}
    const state = { locale: 'en' };
    ${present.map(([name, translator, key]) => `
      function ${translator}(key) { return ${name}[state.locale]?.[key] || ${name}.ko[key] || ""; }
      ${translator}("${key}");
    `).join('\n')}
  })();`;
}

function assertPassed(source, count = 7) {
  const checks = verifyStoryStageSource(source);
  assert.equal(Object.keys(checks).length, count);
  assert.ok(Object.values(checks).every((value) => value === true), JSON.stringify(checks));
}

test('checked-in page passes all applicable copy assertions', () => {
  const checks = verifyStoryStageSource(mainSource);
  assert.ok(Object.values(checks).every((value) => value === true), JSON.stringify(checks));
});

test('retains all five assertions without optional ACCESS_COPY', () => {
  assertPassed(fixture(historicalCopy), 5);
});

test('real historical ACCESS_COPY insertion reproduces the old extraction failure', () => {
  assert.ok(historicalInsertion.includes(accessCopySource));
  const startMarker = 'const STORY_CONTROL_COPY =';
  const start = historicalInsertion.indexOf(startMarker);
  const end = historicalInsertion.indexOf('const state =', start + startMarker.length);
  let literal = historicalInsertion.slice(start + startMarker.length, end).trim();
  if (literal.endsWith(';')) literal = literal.slice(0, -1);
  assert.throws(() => runInNewContext(`(${literal})`), {
    name: 'SyntaxError', message: "Unexpected token ';'",
  });
});

test('real historical adjacent dictionaries pass the new verifier', () => {
  assertPassed(historicalInsertion);
});

test('extraction ignores marker-like text, braces, comments and unrelated declarations', () => {
  const copy = dictionaries();
  copy.STORY_CONTROL_COPY.en.resumeFrom = 'A brace } and ; const state = and "quotes"';
  const source = fixture(copy)
    .replace('const COPY =', '// const COPY = {}; const STORY_CONTROL_COPY = {};\nconst COPY =')
    .replace('const ACCESS_COPY =', 'const unused = "const state = }"; const ACCESS_COPY =')
    .replace('const state = { locale:', 'const /* comment */ state = { locale:');
  assertPassed(source);
});

test('object boundaries do not depend on the next declaration or semicolons', () => {
  const source = fixture()
    .replace(';\nconst STORY_CONTROL_COPY', ', STORY_CONTROL_COPY')
    .replace(';\nconst ACCESS_COPY', ', ACCESS_COPY')
    .replace('const state =', 'let state =');
  assert.ok(source.includes(', STORY_CONTROL_COPY ='));
  assert.ok(source.includes(', ACCESS_COPY ='));
  assertPassed(source);
});

test('copy is parsed without executing adjacent browser code or initializer expressions', () => {
  assertPassed(fixture().replace('const state =', 'throw new Error("Do not run the page"); const state ='));
  assert.throws(() => verifyStoryStageSource(fixture().replace(
    '"Visible copy"', '(() => { throw new Error("Do not run initializers"); })()',
  )), /static object literal/);
});

for (const [name, translator, key, completeCheck, safeCheck] of specs) {
  for (const locale of locales) {
    test(`${name} rejects missing ${locale} locale and key`, () => {
      const missingLocale = dictionaries();
      delete missingLocale[name][locale];
      assert.equal(verifyStoryStageSource(fixture(missingLocale))[completeCheck], false);
      const missingKey = dictionaries();
      delete missingKey[name][locale][key];
      assert.equal(verifyStoryStageSource(fixture(missingKey))[completeCheck], false);
    });
  }

  test(`${name} rejects a key missing in every locale, including English`, () => {
    const copy = dictionaries();
    for (const locale of locales) copy[name][locale] = { unused: 'Unused label' };
    assert.equal(verifyStoryStageSource(fixture(copy))[completeCheck], false);
  });

  test(`${name} rejects empty dictionaries and mismatched extra keys`, () => {
    for (const empty of [{}, Object.fromEntries(locales.map((locale) => [locale, {}]))]) {
      const copy = dictionaries();
      copy[name] = empty;
      assert.equal(verifyStoryStageSource(fixture(copy))[completeCheck], false);
    }
    const copy = dictionaries();
    copy[name].ja.extra = 'Extra label';
    assert.equal(verifyStoryStageSource(fixture(copy))[completeCheck], false);
  });

  test(`${name} rejects blank, corrupt, dotted and bare raw-key values`, () => {
    for (const value of ['', '  ', '\uFFFD', '\u00C2', '\u00C3', 'story.access.price', ' story.access.price ', key]) {
      const copy = dictionaries();
      copy[name].en[key] = value;
      assert.equal(verifyStoryStageSource(fixture(copy))[safeCheck], false, JSON.stringify(value));
    }
  });

  test(`${name} rejects non-string values and invalid locale shapes`, () => {
    for (const value of [null, 42, true, [], {}]) {
      const copy = dictionaries();
      copy[name].en[key] = value;
      assert.throws(() => assertPassed(fixture(copy)));
    }
    const copy = dictionaries();
    copy[name].en = 'Not a locale dictionary';
    assert.equal(verifyStoryStageSource(fixture(copy))[completeCheck], false);
  });

  test(`${translator} rejects raw-key fallback and direct returns`, () => {
    const prefix = `return ${name}[state.locale]?.[key] || ${name}.ko[key] || "";`;
    for (const body of [
      `return ${name}[state.locale]?.[key] || ${name}.ko[key] || key;`,
      `return ${name}[state.locale]?.[key] ?? (key);`,
      'return key;',
      'return `${key}`;',
    ]) {
      assert.equal(verifyStoryStageSource(fixture().replace(prefix, body)).rawKeyFallbackBlocked, false);
    }
  });

  test(`${translator} rejects filtered raw-key return paths independently of probes`, () => {
    const prefix = `return ${name}[state.locale]?.[key] || ${name}.ko[key] || "";`;
    const lookup = `${name}[state.locale]?.[key] || ${name}.ko[key]`;
    for (const fallback of [
      `return ${lookup} || key;`,
      `return (${lookup}) ?? (key);`,
      `return ${name}.ko[key] ? ${name}.ko[key] : key;`,
      `return ${lookup} || \`\${key}\`;`,
    ]) {
      const source = fixture().replace(prefix,
        `if (!/^[a-z][a-zA-Z]*$/.test(key)) return ""; ${fallback}`,
      ).replace(`${translator}("${key}");`,
        `const missingKey = "missingLabel"; globalThis.observed = ${translator}(missingKey);`,
      );
      const context = {};
      runInNewContext(source, context);
      assert.equal(context.observed, 'missingLabel');
      assert.equal(verifyStoryStageSource(source).rawKeyFallbackBlocked, false);
    }
  });

  test(`${translator} allows filtered lookups with literal and conditional fallbacks`, () => {
    const prefix = `return ${name}[state.locale]?.[key] || ${name}.ko[key] || "";`;
    for (const body of [
      `if (!/^[a-z][a-zA-Z]*$/.test(key)) return ""; return ${name}[state.locale]?.[key] || ${name}.ko[key] || "";`,
      `if (!/^[a-z][a-zA-Z]*$/.test(key)) return "Unavailable"; return ${name}[state.locale]?.[key] ?? ${name}.ko[key] ?? "Translation unavailable";`,
      `return key === "" ? "" : (${name}[state.locale]?.[key] || ${name}.ko[key] || "Translation unavailable");`,
    ]) {
      assertPassed(fixture().replace(prefix, body));
    }
  });
}

test('rejects TypeScript-only syntax and JavaScript early errors in the actual page', () => {
  for (const [before, after] of [
    ['const COPY =', 'const COPY: any ='],
    ['function tr(key)', 'function tr(key: string)'],
    ['locale: resolveLocale(),', 'locale: resolveLocale() as string,'],
    ['"use strict";', '"use strict"; const repeated = 1; const repeated = 2;'],
  ]) {
    assert.ok(mainSource.includes(before));
    assert.throws(() => verifyStoryStageSource(mainSource.replace(before, after)), { name: 'SyntaxError' });
  }
});

test('raw-key checks are limited to translation functions', () => {
  assertPassed(fixture().replace('const state =', 'function unrelated(key) { return key || key; } const state ='));
});

test('rejects malformed source, ambiguous declarations, and non-static dictionary properties', () => {
  for (const source of [
    `${fixture()} const broken = ;`,
    `${fixture()} const STORY_CONTROL_COPY = {};`,
    fixture().replace('const ACCESS_COPY = {', 'const ACCESS_COPY = { ...otherCopy,'),
    fixture().replace('"priceLabel":"Visible copy"', 'get priceLabel() { return "Visible copy"; }'),
    fixture().replace('"priceLabel":"Visible copy"', '["priceLabel"]:"Visible copy"'),
    fixture().replace('"priceLabel":"Visible copy"', '"priceLabel":"Visible copy", "priceLabel":"Duplicate"'),
    fixture().replace('const STORY_CONTROL_COPY =', 'const OTHER_COPY ='),
  ]) {
    assert.throws(() => verifyStoryStageSource(source));
  }
});
