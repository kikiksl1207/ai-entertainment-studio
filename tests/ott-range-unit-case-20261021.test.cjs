'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('OTT Range source retains the RFC 9110 case-insensitive bytes unit wiring', () => {
  const source = readFileSync(path.join(__dirname, '../server/src/ott-media/ott-media.controller.ts'), 'utf8');
  const expected = 'const match = /^bytes=(\\d*)-(\\d*)$/i.exec(value);';
  assert.equal(source.split(expected).length - 1, 1);
  assert.equal(source.includes('const match = /^bytes=(\\d*)-(\\d*)$/.exec(value);'), false);
});
