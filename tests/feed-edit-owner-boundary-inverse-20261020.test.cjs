'use strict';

// AUTHOR/UNRUN. Pure-helper verification only; three native groups, FIRST0.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const INPUTS = [
  {
    "relative": "app.js",
    "cap": 1048576,
    "lf": {
      "bytes": 435410,
      "sha256": "22437069572d993e76a8f0f7ca7055ed6f7d46fd98feb38a8175eb406860e33c",
      "blob": "495f192c1236b9d45e3cbcb6710433f1cbf3e1ed"
    },
    "crlf": {
      "bytes": 442683,
      "sha256": "e4371ebd3678c86dfb98a84aff4d04d454a111dcee5a8913a4be6d884815c345",
      "blob": "7e9edd7f93ab2cca1d5caba9a19ac786f2cb7a90"
    },
    "before95": {
      "bytes": 434800,
      "sha256": "4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff",
      "blob": "b83bdd503d1ad80c11cc7724a3e6f3ee2bb268d2"
    },
    "before3f7": {
      "bytes": 434541,
      "sha256": "848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07",
      "blob": "15ba461156f1cd41389201b685dda668c6009414"
    },
    "ports": [
      {
        "before": "let _feedEditModalEl = null;\n",
        "after": "let _feedEditModalEl = null;\nfunction feedEditModalCurrent(modal) {\n  if (!modal || modal !== _feedEditModalEl) return false;\n  if (!modal._feedEditOwnerId || modal._feedEditOwnerId !== pickOwnerId()) {\n    closeFeedEditModal();\n    return false;\n  }\n  return true;\n}\nfunction retireFeedEditOnAccountChange() {\n  if (_feedEditModalEl) feedEditModalCurrent(_feedEditModalEl);\n}\n"
      },
      {
        "before": "function openFeedEditModal(post) {\n  closeFeedEditModal();\n  const modal = document.createElement(\"div\");",
        "after": "function openFeedEditModal(post) {\n  closeFeedEditModal();\n  const owner = pickOwnerId();\n  if (!owner) return;\n  const modal = document.createElement(\"div\");\n  modal._feedEditOwnerId = owner;"
      },
      {
        "before": "  setTimeout(() => {\n    textarea.focus();\n    textarea.setSelectionRange(textarea.value.length, textarea.value.length);\n  }, 0);",
        "after": "  setTimeout(() => {\n    if (!feedEditModalCurrent(modal)) return;\n    textarea.focus();\n    if (!feedEditModalCurrent(modal)) return;\n    textarea.setSelectionRange(textarea.value.length, textarea.value.length);\n  }, 0);"
      },
      {
        "before": "    _feedEditModalEl.remove();\n    _feedEditModalEl = null;",
        "after": "    _feedEditModalEl._feedEditOwnerId = null;\n    _feedEditModalEl.remove();\n    _feedEditModalEl = null;"
      },
      {
        "before": "    const current = () => modal === _feedEditModalEl &&\n      modal.querySelector(\"[data-feed-edit-save]\") === saveBtn && saveBtn.dataset.postId === postId;",
        "after": "    const current = () => modal === _feedEditModalEl &&\n      feedEditModalCurrent(modal) &&\n      modal.querySelector(\"[data-feed-edit-save]\") === saveBtn && saveBtn.dataset.postId === postId;"
      }
    ]
  },
  {
    "relative": "pages/lumina-feed.js",
    "cap": 524288,
    "lf": {
      "bytes": 141156,
      "sha256": "67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207",
      "blob": "4ee9e314b7e34059b007adeb252f8dd8f76e9f06"
    },
    "crlf": {
      "bytes": 144106,
      "sha256": "138a4937cf979ce537810a2ee29c5aed6f223611f4536ddb275fc894c9a38e30",
      "blob": "04d72c5d718d5808533436659ea60390394b9e85"
    },
    "before95": {
      "bytes": 141110,
      "sha256": "4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b",
      "blob": "c26788917d62a5517190764ca8fa74269be25f25"
    },
    "ports": [
      {
        "before": "  function clearFeedOnAccountChange() {\n    retireRepostOnAccountChange();",
        "after": "  function clearFeedOnAccountChange() {\n    window.retireFeedEditOnAccountChange?.();\n    retireRepostOnAccountChange();"
      }
    ]
  },
  {
    "relative": "index.html",
    "cap": 262144,
    "lf": {
      "bytes": 20210,
      "sha256": "13f9ad2655afda166c4f14ae873e32ba96bbd11ba0f74acda27393f9baeaca8e",
      "blob": "9c8e97cd753a4c959a1c00bc5a954169bdcee04a"
    },
    "crlf": {
      "bytes": 20632,
      "sha256": "df8b1d8e3e22cc4c4930e91c524bbca3890749b3388fc1e8fb59a69b946c67b6",
      "blob": "f6621061468c35bd7ffde77ca4e0ae42a97c20c4"
    },
    "before95": {
      "bytes": 20210,
      "sha256": "7b44ebef67fe443952c956f202d1caf70c52ed0fcf414368bd81a45fc9634b13",
      "blob": "1b6fa9bea72d812a4fa8114617022562ee78e1bb"
    },
    "before3f7": {
      "bytes": 20210,
      "sha256": "d60181988fd81ac7f7645c9e1df5e49205df0e6fb1401bfccc12d114c0ffc6aa",
      "blob": "c0c36bfae35ef0558eb70d80f12ee8c9be97a63f"
    },
    "ports": [
      {
        "before": "4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff",
        "after": "22437069572d993e76a8f0f7ca7055ed6f7d46fd98feb38a8175eb406860e33c"
      }
    ]
  },
  {
    "relative": "creator-studio/index.html",
    "cap": 262144,
    "lf": {
      "bytes": 62703,
      "sha256": "03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8",
      "blob": "7211a8d47738a397d0453d5708a68e4e3a9682a1"
    },
    "crlf": {
      "bytes": 63507,
      "sha256": "d43cb981b40be46c548cc10a51a3b544281134207400d1c0110b024616447be4",
      "blob": "e58b4deb1d87c84006f6c811c22046e109d5c1c5"
    },
    "before95": {
      "bytes": 62703,
      "sha256": "2d2d45c97fc20e33489e43a189211748beb6af7ffaf8080a8fcb28d12acd2543",
      "blob": "066cae438ba07f5f9abac3f84d456568f0fb3fb8"
    },
    "before3f7": {
      "bytes": 62703,
      "sha256": "12141298f58a5bcc1441295387132a64445ab0bd755bd12216f0af89830a4ed6",
      "blob": "d89d03a2fd7dad25cb5512b928ef5cded854f55f"
    },
    "ports": [
      {
        "before": "4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff",
        "after": "22437069572d993e76a8f0f7ca7055ed6f7d46fd98feb38a8175eb406860e33c"
      }
    ]
  },
  {
    "relative": "lumina-feed/index.html",
    "cap": 262144,
    "lf": {
      "bytes": 24673,
      "sha256": "6cc3bf5ef12b525e7c01e212cd11429f5c009c5693db8078438667117b2ce6bc",
      "blob": "9bd1f484ada81e23db7c9d916124d41ef32a09c6"
    },
    "crlf": {
      "bytes": 25019,
      "sha256": "6f2812133a923cde4e1e7c95de48bbe97e7db3c53f74c605d336ca2ad9b3d385",
      "blob": "f24d7c494026bfcabb25b60fa85d91a2799aaea0"
    },
    "before95": {
      "bytes": 24673,
      "sha256": "de3458eb06217b8eac86faab4e6d6325c90ddeff957b2ee35015edda187bb635",
      "blob": "50101004cccc3ccc9d73c65f9385834d6febb87f"
    },
    "before3f7": {
      "bytes": 24673,
      "sha256": "d01c4134bd859d6314b930ae4f16f6fbc10baa565908c640ff69c4da6e30a238",
      "blob": "0773eec72d89b611e2bb145c9babf430f87ce35a"
    },
    "ports": [
      {
        "before": "4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff",
        "after": "22437069572d993e76a8f0f7ca7055ed6f7d46fd98feb38a8175eb406860e33c"
      },
      {
        "before": "4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b",
        "after": "67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207"
      }
    ]
  },
  {
    "relative": "tests/support/feed-edit-modal-lifetime-inverse-20261019.cjs",
    "cap": 131072,
    "lf": {
      "bytes": 9615,
      "sha256": "93c4de9c4df3cc65ceeee081c57c5b95320428552b363813e6dbad024b2df8ad",
      "blob": "3265048e8ad17481b0892ce57932a7939010e212"
    },
    "crlf": {
      "bytes": 9812,
      "sha256": "107cc193344c45835cd955a35e72eb9f6601e3258c8d945c0185636e77d584d3",
      "blob": "91aaa3e5caf546d261669f4b7d1af37e8df2587b"
    }
  },
  {
    "relative": "tests/support/feed-edit-app-html-inverse-20261020.cjs",
    "cap": 131072,
    "lf": {
      "bytes": 6825,
      "sha256": "0aeab29505e13df2e9d0711a5e0172149a703dd2ee355bff757e460727e56fe6",
      "blob": "72ee0f6d9cf99ceb159fc5e91b371c77278e003c"
    },
    "crlf": {
      "bytes": 6989,
      "sha256": "4e6ac927e470ff8dc9d01c708a5af0ca87e3b48f2cc96bd23d01bd7f1d3da95d",
      "blob": "dd9c9a7a7289d442b5944a1c444097e7c560e99e"
    }
  }
];

function identity(bytes) {
  return { bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
}
function assertIdentity(bytes, expected, label) {
  assert.deepEqual(identity(bytes), expected, label);
}
function readBounded(file, cap) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'ordinary non-symbolic input');
  assert.ok(stat.size > 0 && stat.size <= cap, 'cap BEFORE read/allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
  const raw = fs.readFileSync(file);
  assert.equal(raw.length, stat.size, 'read length matches opening stat');
  return raw;
}
function textView(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text, 'utf8').equals(raw), true, 'fatal UTF8 roundtrip');
  assert.notEqual(text.charCodeAt(0), 0xFEFF, 'no BOM');
  assert.equal(/\r(?!\n)/.test(text), false, 'no bare CR');
  const lf = text.replace(/\r\n/g, '\n');
  assert.ok(text === lf || text === lf.replace(/\n/g, '\r\n'), 'LF or uniform CRLF only');
  return { lf, crlf: text !== lf };
}
const tracked = INPUTS.map(row => ({ file: path.join(ROOT, row.relative), cap: row.cap }));
tracked.push({ file: __filename, cap: 256 * 1024 });
assert.equal(tracked.length, 8);
const opening = tracked.map(row => readBounded(row.file, row.cap));
const openingPins = opening.map(identity);
after(() => {
  const errors = [];
  for (let i = 0; i < tracked.length; i++) {
    try {
      const closing = readBounded(tracked[i].file, tracked[i].cap);
      assert.equal(closing.equals(opening[i]), true, 'closing complete raw bytes ' + i);
      assertIdentity(closing, openingPins[i], 'closing raw length/SHA/blob ' + i);
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'All eight closing vectors attempted');
});
const source = INPUTS.map((row, i) => {
  const view = textView(opening[i]);
  assertIdentity(opening[i], view.crlf ? row.crlf : row.lf, 'whole physical input ' + row.relative);
  assertIdentity(Buffer.from(view.lf, 'utf8'), row.lf, 'whole canonical input ' + row.relative);
  return view.lf;
});
textView(opening[7]);
// Both full helper profiles and all five product bodies are admitted BEFORE target import.
const appHelper = require(tracked[5].file);
const htmlHelper = require(tracked[6].file);
assert.deepEqual(Object.keys(appHelper).sort(),
  ['restoreOwnedFeedEditAccountApp', 'restoreOwnedFeedEditAccountFeed',
    'restoreOwnedFeedEditModalLifetime'].sort());
assert.deepEqual(Object.keys(htmlHelper).sort(),
  ['restoreOwnedFeedEditAccountHtml', 'restoreOwnedFeedEditAppHtml'].sort());
for (const fn of [...Object.values(appHelper), ...Object.values(htmlHelper)]) {
  assert.equal(typeof fn, 'function');
}
const styles = ['LF', 'CRLF'];
const styled = (text, style) => style === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
function replaceUnique(text, from, to) {
  const at = text.indexOf(from);
  assert.ok(from.length > 0 && at >= 0 && text.indexOf(from, at + 1) === -1,
    'independent literal DATA match must occur exactly once');
  return text.slice(0, at) + to + text.slice(at + from.length);
}
function checkedOutput(result, expected, style, label) {
  assert.equal(typeof result, 'string', label);
  const raw = Buffer.from(result, 'utf8'), view = textView(raw);
  assert.equal(view.crlf, style === 'CRLF', 'restored physical EOL preserved');
  assert.equal(result, styled(view.lf, style));
  assertIdentity(Buffer.from(view.lf, 'utf8'), expected, label);
  return view.lf;
}
function ownerRoundTrip(fn, index, style) {
  const row = INPUTS[index], input = styled(source[index], style);
  const restored = checkedOutput(fn(input), row.before95, style, 'known95 restoration ' + row.relative);
  let forward = restored;
  for (const port of row.ports) forward = replaceUnique(forward, port.before, port.after);
  assert.equal(forward, source[index], 'independent whole forward from restored95');
  assert.equal(styled(forward, style), input, 'forward restores exact physical input');
}

test('owner-only app/feed restore95 while combined app retains3F7', { timeout: 5000 }, () => {
  for (const style of styles) {
    ownerRoundTrip(appHelper.restoreOwnedFeedEditAccountApp, 0, style);
    ownerRoundTrip(appHelper.restoreOwnedFeedEditAccountFeed, 1, style);
    checkedOutput(appHelper.restoreOwnedFeedEditModalLifetime(styled(source[0], style)),
      INPUTS[0].before3f7, style, 'combined app original434541 identity');
  }
});

test('three owner-only HTML restore95 and combined HTML retain3F7', { timeout: 5000 }, () => {
  for (const index of [2, 3, 4]) {
    for (const style of styles) {
      ownerRoundTrip(htmlHelper.restoreOwnedFeedEditAccountHtml, index, style);
      checkedOutput(htmlHelper.restoreOwnedFeedEditAppHtml(styled(source[index], style)),
        INPUTS[index].before3f7, style, 'combined original HTML identity');
    }
  }
});

test('strict public type errors and unknown malformed inputs pass through unchanged', { timeout: 5000 }, () => {
  const contracts = [
    { fn: appHelper.restoreOwnedFeedEditAccountApp, indexes: [0],
      message: 'FEED_EDIT_OWNER_INVERSE_STRING_REQUIRED', other: 1 },
    { fn: appHelper.restoreOwnedFeedEditAccountFeed, indexes: [1],
      message: 'FEED_EDIT_OWNER_INVERSE_STRING_REQUIRED', other: 0 },
    { fn: appHelper.restoreOwnedFeedEditModalLifetime, indexes: [0],
      message: 'FEED_EDIT_MODAL_LIFETIME_INVERSE_STRING_REQUIRED', other: 1 },
    { fn: htmlHelper.restoreOwnedFeedEditAccountHtml, indexes: [2, 3, 4],
      message: 'FEED_EDIT_ACCOUNT_HTML_INVERSE_STRING_REQUIRED', other: 0 },
    { fn: htmlHelper.restoreOwnedFeedEditAppHtml, indexes: [2, 3, 4],
      message: 'FEED_EDIT_APP_HTML_INVERSE_STRING_REQUIRED', other: 1 }
  ];
  let coercions = 0;
  const poison = {
    [Symbol.toPrimitive]() { coercions++; throw new Error('COERCION_FORBIDDEN'); },
    toString() { coercions++; throw new Error('COERCION_FORBIDDEN'); },
    valueOf() { coercions++; throw new Error('COERCION_FORBIDDEN'); }
  };
  const nonstrings = [undefined, null, false, 42, 1n, Symbol('not-source'),
    [], {}, function notSource() {}, new String('boxed source'), Buffer.from('buffer source'), poison];
  for (const contract of contracts) {
    for (const value of nonstrings) {
      assert.throws(() => contract.fn(value),
        error => error instanceof TypeError && error.message === contract.message,
        'exact public TypeError, never coerce');
      assert.equal(coercions, 0);
    }
    for (const index of contract.indexes) {
      for (const style of styles) {
        const input = styled(source[index], style);
        const row = INPUTS[index], owned = styled(row.ports[0].after, style);
        const firstEol = style === 'CRLF' ? '\r\n' : '\n';
        const variants = [
          ['empty', ''],
          ['unknown', 'unknown source\n'],
          ['malformed', 'function unfinished( {\n'],
          ['BOM', '\uFEFF' + input],
          ['mixed-EOL', input.replace(firstEol, style === 'CRLF' ? '\n' : '\r\n')],
          ['bare-CR', input.replace(firstEol, '\r')],
          ['unpaired-high', input + '\uD800'],
          ['unpaired-low', input + '\uDC00'],
          ['trailing-newline', input + firstEol],
          ['trailing-mutation', input + 'x'],
          ['owned-mutation', replaceUnique(input, owned, '!' + owned.slice(1))],
          ['outside-mutation', (input[0] === 'X' ? 'Y' : 'X') + input.slice(1)],
          ['duplicate-owned', input + owned]
        ];
        for (const [name, value] of variants) {
          assert.equal(contract.fn(value), value, 'unknown pass-through: ' + name + '/' + style);
        }
        const wrongKind = styled(source[contract.other], style);
        assert.equal(contract.fn(wrongKind), wrongKind, 'wrong-kind full source remains unknown');
      }
    }
  }
  assert.equal(coercions, 0);
});
