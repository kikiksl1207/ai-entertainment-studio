import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const runId = randomUUID();
const publicPath = '/story-stage';
const source = readFileSync(
  new URL('../../pages/story-stage.js', import.meta.url),
  'utf8',
);

const copy = readObject('const COPY =', 'const STORY_CONTROL_COPY =');
const controls = readObject('const STORY_CONTROL_COPY =', 'const state =');
const copyAudit = auditDictionary(copy);
const controlAudit = auditDictionary(controls);
const rawKeyFallbackBlocked =
  !/function tr\(key\)[\s\S]*?\|\| key;/.test(source) &&
  !/function controlTr\(key\)[\s\S]*?\|\| key;/.test(source);

const checks = {
  fiveLocaleCopy: copyAudit.complete,
  fiveLocaleControls: controlAudit.complete,
  safeCopyValues: copyAudit.safeValues,
  safeControlValues: controlAudit.safeValues,
  rawKeyFallbackBlocked,
};

if (Object.values(checks).some((value) => value !== true)) {
  print('failed', checks, true);
  process.exitCode = 1;
} else {
  print('passed', checks, false);
}

function readObject(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Story stage copy marker missing');
  let literal = source.slice(start + startMarker.length, end).trim();
  if (literal.endsWith(';')) literal = literal.slice(0, -1);
  return runInNewContext(`(${literal})`);
}

function auditDictionary(dictionary) {
  const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
  const canonicalKeys = Object.keys(dictionary.en ?? {});
  let complete = true;
  let safeValues = true;

  for (const locale of locales) {
    const values = dictionary[locale] ?? {};
    const keys = Object.keys(values);
    if (
      keys.length !== canonicalKeys.length ||
      canonicalKeys.some((key) => !keys.includes(key))
    ) {
      complete = false;
    }
    for (const value of Object.values(values)) {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        /\uFFFD|\u00C2|\u00C3/.test(value) ||
        /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(value)
      ) {
        safeValues = false;
      }
    }
  }

  return { complete, safeValues };
}

function print(status, checks, failed) {
  const output = JSON.stringify({
    runId,
    publicPath,
    status,
    checks,
    mutationExecuted: false,
  });
  if (failed) console.error(output);
  else console.log(output);
}
