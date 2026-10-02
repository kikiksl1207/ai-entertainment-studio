import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const dictionarySource = appSource.slice(
  appSource.indexOf('const I18N_DICT = {'),
  appSource.indexOf('\nlet _currentLocale = I18N_FALLBACK;'),
);
const dictionary = runInNewContext(`${dictionarySource}\nI18N_DICT`, {});
const footerPages = [
  'business', 'character-detail', 'characters', 'charge', 'debut',
  'debut-terms', 'lumina-feed', 'lumina-pick', 'mypage', 'privacy',
  'refund-policy', 'shortform', 'terms', 'user-profile',
];

test('business and investment footer link is localized on every page that displays it', () => {
  const pages = ['index.html', ...footerPages.map(page => `${page}/index.html`)];
  for (const page of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /href="\/business#partner-inquiry" data-i18n="footer\.partnerInquiry"/, page);
    assert.match(html, /data-i18n-attr="title:footer\.partnerInquiry\.helper"/, page);
  }
  for (const key of ['footer.partnerInquiry', 'footer.partnerInquiry.helper']) {
    for (const locale of ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant']) {
      assert.ok(dictionary[key]?.[locale], `${key} missing ${locale}`);
    }
  }
});
