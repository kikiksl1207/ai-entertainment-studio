'use strict';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root=path.resolve(__dirname,'..'); const file=require.resolve(path.join(root,'pages/content-rights-contract-ui.js'));
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];

function withUI(run) {
  const keys = ['window', 'localStorage'];
  const saved = keys.map(k => Object.getOwnPropertyDescriptor(globalThis, k));
  const cached = require.cache[file];
  let locale = 'ko';
  try {
    const values = [{ luminaI18n: { getLocale: () => locale } }, { getItem: () => locale }];
    keys.forEach((k, i) => Object.defineProperty(globalThis, k, { value: values[i], writable: true, configurable: true }));
    delete require.cache[file];
    require(file);
    const ui = globalThis.window.LuminaContentRightsUI;
    assert.equal(typeof ui.percent, 'function');
    run(ui, value => { locale = value; });
  } finally {
    delete require.cache[file];
    if (cached) require.cache[file] = cached;
    keys.forEach((k, i) => saved[i] ? Object.defineProperty(globalThis, k, saved[i]) : delete globalThis[k]);
  }
}

test('missing and invalid shares display a dash without object coercion', () => withUI((ui, setLocale) => {
  let coercions = 0;
  const hostile = { valueOf() { coercions++; throw Error('coercion forbidden'); } };
  const values = [null, undefined, '', ' \t\n', false, true, [], [0], {}, new Number(0), new String('0'), 0n, 1n, Symbol(), () => 0, NaN, Infinity, -Infinity, 'NaN', 'Infinity', '-Infinity', hostile];
  for (const locale of locales) {
    setLocale(locale);
    values.forEach((value, i) => assert.equal(ui.percent(value), '-', `${locale}: missing ${i}`));
    assert.equal(coercions, 0, `${locale}: no valueOf`);
  }
}));

test('finite shares retain legacy formatting in five locales', () => withUI((ui, setLocale) => {
  // Literal legacy expectations, not a replacement formatter or rate policy.
  const cases = [[0, '0%'], ['0', '0%'], [' 0 ', '0%'], [5000, '50%'], ['5000', '50%'], [6000, '60%'], ['6000', '60%'], [10000, '100%'], ['10000', '100%'], [-100, '-1%'], ['-100', '-1%'], [125, '1.25%'], ['0x10', '0.16%'], [125000, '1,250%'], [-0, '0%'], ['-0', '-0%']];
  for (const locale of locales) {
    setLocale(locale);
    cases.forEach(([value, expected], i) => assert.equal(ui.percent(value), expected, `${locale}: finite ${i}`));
  }
}));
