import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(scriptDirectory, "..", "..", "app.js");
const sourceBytes = fs.readFileSync(appPath);
const source = sourceBytes.toString("utf8");
const requiredLocales = ["ko-KR", "ja-JP", "en-US", "zh-CN", "zh-Hant"];
const intentionallyEmptyKeys = new Set(["auth.modal.terms.prefix"]);
const requiredModalKeys = [
  "auth.login",
  "auth.signup",
  "auth.modal.close",
  "auth.modal.login.title",
  "auth.modal.login.subtitle",
  "auth.modal.forgot.title",
  "auth.modal.forgot.subtitle",
  "auth.modal.success.title",
  "auth.modal.success.subtitle",
  "auth.modal.register.title",
  "auth.modal.register.subtitle",
  "auth.modal.email.placeholder",
  "auth.modal.nickname.placeholder",
  "auth.modal.terms.prefix",
  "auth.modal.terms.terms",
  "auth.modal.terms.privacy",
  "auth.modal.terms.suffix",
];
const requiredHeaderKeys = ["auth.logout", "auth.loginRequired"];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!Buffer.from(source, "utf8").equals(sourceBytes)) {
  fail("app.js must remain valid UTF-8");
}

if (source.includes("\uFFFD")) {
  fail("app.js must not contain a replacement character");
}

const dictionaryStart = source.indexOf("const I18N_DICT = ");
const dictionaryEnd = source.indexOf("let _currentLocale", dictionaryStart);
const runtimeStart = source.indexOf("const I18N_LOCALES = ");
const runtimeEnd = source.indexOf("function maskEmail", runtimeStart);
const modalStart = source.indexOf("function createAuthModal()");
const modalEnd = source.indexOf("document.body.appendChild(modal);", modalStart);

if ([dictionaryStart, dictionaryEnd, runtimeStart, runtimeEnd, modalStart, modalEnd].some((index) => index < 0)) {
  fail("could not locate the auth i18n source sections");
}

const dictionaryLiteral = source
  .slice(dictionaryStart + "const I18N_DICT = ".length, dictionaryEnd)
  .trim()
  .replace(/;$/, "");
const dictionary = vm.runInNewContext(`(${dictionaryLiteral})`);
const runtime = vm.createContext({ globalThis: {} });
vm.runInContext(`${source.slice(runtimeStart, runtimeEnd)}\nglobalThis.authTranslation = t;`, runtime);
const translate = runtime.globalThis.authTranslation;
const modalSource = source.slice(modalStart, modalEnd);
const boundModalKeys = new Set();

for (const match of modalSource.matchAll(/data-i18n(?:-attr|-aria)?="([^"]+)"/g)) {
  for (const value of match[1].split(",")) {
    boundModalKeys.add(value.includes(":") ? value.split(":").at(-1).trim() : value.trim());
  }
}

const keysToVerify = new Set([
  ...requiredModalKeys,
  ...requiredHeaderKeys,
  ...boundModalKeys,
]);

for (const key of keysToVerify) {
  if (requiredModalKeys.includes(key) && !modalSource.includes(key)) {
    fail(`auth modal is missing i18n binding for ${key}`);
  }

  const entry = dictionary[key];
  if (!entry) fail(`missing dictionary entry for ${key}`);

  for (const locale of requiredLocales) {
    if (!Object.hasOwn(entry, locale)) {
      fail(`missing ${locale} value for ${key}`);
    }

    const value = translate(key, locale);
    if (value === key) fail(`raw key fallback for ${key} in ${locale}`);
    if (!intentionallyEmptyKeys.has(key) && (!value || !value.trim())) {
      fail(`empty visible copy for ${key} in ${locale}`);
    }
    if (locale === "ko-KR" && !intentionallyEmptyKeys.has(key) && !/[\uac00-\ud7a3]/.test(value)) {
      fail(`Korean copy is unreadable for ${key}`);
    }
  }
}

if (translate("auth.modal.terms.prefix", "ko-KR") !== "") {
  fail("Korean terms prefix must stay intentionally empty");
}

console.log(`PASS: auth i18n source guard (${keysToVerify.size} keys, ${requiredLocales.length} locales)`);
