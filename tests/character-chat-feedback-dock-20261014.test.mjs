import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

// SOURCE-authored and UNRUN by the author. Parse inert HTML; never load page scripts.
const defaultCandidate = fileURLToPath(new URL('../character-chat.html', import.meta.url));
const fixturePath = fileURLToPath(new URL('./fixtures/character-chat-feedback-original-20261014.html', import.meta.url));
const originalSha = 'e7780a7790ad195fd2fb2dba7487e93005fa6f5f98221ea9a0278bfc07a6eb37';
const candidateSha = 'aebcc7763450d80f88db111e12fb7bfca6a3f43ced207cf096f0e22c942fffe4';
const productPins = {
  'styles/character-chat.css': '201596eabe33c4d074642b84e616524597fdee37b90b07443de36ea28ee3bedb',
  'pages/character-chat.js': '8ecdef980c15d25d15ef7b6a9f5661bb1c0dab07ad69d18665754d4cf297a532',
};
const sharedPaths = ['character-chat.html', ...Object.keys(productPins)];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const crlf = bytes => Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
function checkedInBytes(rawBytes, canonicalSha, label) {
  if (sha(rawBytes) === canonicalSha) return { bytes: rawBytes, format: 'lf' };
  const bytes = Buffer.from(rawBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  assert.equal(sha(bytes), canonicalSha, 'Frozen LF source: ' + label);
  assert.ok(rawBytes.equals(crlf(bytes)), 'Only exact CRLF equivalence is allowed: ' + label);
  return { bytes, format: 'crlf' };
}
function originalFixture(rawBytes) {
  const { bytes } = checkedInBytes(rawBytes, originalSha, 'original repository fixture');
  assert.equal(bytes.length, 43093, 'Original fixture is exactly 43,093 canonical LF bytes');
  assert.equal(sha(bytes), originalSha, 'Original fixture canonical LF SHA256');
  return bytes;
}
function selectCandidate(path, hash, { checkedInPath = defaultCandidate, read = readFileSync } = {}) {
  assert.ok(path === undefined ? hash === undefined :
    typeof path === 'string' && path && /^[a-f0-9]{64}$/i.test(hash || ''),
  'An explicit candidate path requires its paired raw SHA256');
  if (path === undefined) {
    const rawBytes = read(checkedInPath);
    return { path: checkedInPath, rawBytes, mode: 'checked_in',
      ...checkedInBytes(rawBytes, candidateSha, 'checked-in character-chat.html') };
  }
  assert.match(path, /^E:[\\/]/i, 'Explicit local overlay must be an absolute E-drive path');
  const rawBytes = read(path);
  assert.equal(sha(rawBytes), hash.toLowerCase(), 'Selected raw bytes');
  assert.equal(sha(rawBytes), candidateSha, 'Only the exact frozen local candidate is accepted');
  return { path, rawBytes, bytes: rawBytes, mode: 'local_overlay', format: 'lf' };
}
function sharedHashes() {
  return Object.fromEntries(sharedPaths.map(path =>
    [path, sha(readFileSync(new URL('../' + path, import.meta.url)))]));
}
function readProductSources() {
  return Object.fromEntries(Object.entries(productPins).map(([path, hash]) =>
    [path, checkedInBytes(readFileSync(new URL('../' + path, import.meta.url)), hash, path).bytes]));
}
const localMode = process.env.CHAT_FEEDBACK_DOCK_CANDIDATE !== undefined;
const sharedBefore = localMode ? sharedHashes() : null;
const candidate = selectCandidate(process.env.CHAT_FEEDBACK_DOCK_CANDIDATE,
  process.env.CHAT_FEEDBACK_DOCK_SHA256);
const productBytes = readProductSources();
const originalBytes = originalFixture(readFileSync(fixturePath));

// Installed Python stdlib HTMLParser supplies tokens; require an explicit balanced tree.
// Locations are UTF-8 byte offsets, so Korean/emoji cannot corrupt byte-span comparisons.
const pythonParser = String.raw`
import json
import sys
from html.parser import HTMLParser

class TreeParser(HTMLParser):
    void = set('area base br col embed hr img input link meta param source track wbr'.split())

    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0] + [i + 1 for i, ch in enumerate(source) if ch == '\n']
        self.root = {'type': 'document', 'children': []}
        self.stack = [self.root]

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def byte(self, offset):
        return len(self.source[:offset].encode('utf-8'))

    def start(self, tag, attrs, closed):
        offset = self.source_offset()
        end = offset + len(self.get_starttag_text())
        node = {'type': 'element', 'tag': tag, 'attrs': attrs, 'children': [],
                'location': {'start': self.byte(offset), 'startTagEnd': self.byte(end)}}
        self.stack[-1]['children'].append(node)
        if closed or tag in self.void:
            node['location']['end'] = self.byte(end)
        else:
            self.stack.append(node)

    def handle_starttag(self, tag, attrs):
        self.start(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self.start(tag, attrs, True)

    def handle_endtag(self, tag):
        if len(self.stack) == 1 or self.stack[-1]['tag'] != tag:
            raise ValueError('Unbalanced explicit HTML end tag: ' + tag)
        offset = self.source_offset()
        end = self.source.index('>', offset) + 1
        self.stack[-1]['location'].update(endTagStart=self.byte(offset), end=self.byte(end))
        self.stack.pop()

    def leaf(self, kind, value):
        self.stack[-1]['children'].append({'type': kind, 'value': value})

    def handle_data(self, value):
        self.leaf('text', value)

    def handle_comment(self, value):
        self.leaf('comment', value)

    def handle_decl(self, value):
        self.leaf('declaration', value)

    def handle_entityref(self, value):
        self.leaf('entity', value)

    def handle_charref(self, value):
        self.leaf('character-reference', value)

    def handle_pi(self, value):
        self.leaf('processing-instruction', value)

source = sys.stdin.buffer.read().decode('utf-8', errors='strict')
parser = TreeParser(source)
parser.feed(source)
parser.close()
if len(parser.stack) != 1:
    raise ValueError('Unclosed explicit HTML elements')
print(json.dumps(parser.root, ensure_ascii=True))
`;
function parse(bytes) {
  return JSON.parse(execFileSync(process.env.CHAT_FEEDBACK_DOCK_PYTHON || 'python',
    ['-B', '-I', '-c', pythonParser], { input: bytes, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
}
const original = parse(originalBytes), overlay = parse(candidate.bytes);
const attr = (node, name) => node.attrs?.find(([key]) => key === name)?.[1];
const hasAttr = (node, name) => node.attrs?.some(([key]) => key === name) || false;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => all(child, predicate))];
}
function one(tree, predicate, label) {
  const nodes = all(tree, predicate);
  assert.equal(nodes.length, 1, 'Exactly one ' + label);
  return nodes[0];
}
const byId = (tree, id) => one(tree, node => attr(node, 'id') === id, '#' + id);
const feedback = tree => one(tree, node => hasClass(node, 'dm-send-feedback'), 'feedback block');
const elements = node => (node.children || []).filter(child => child.type === 'element');
const parent = (tree, child) => one(tree, node => node.children?.includes(child), 'direct parent');
const raw = (bytes, node) => bytes.subarray(node.location.start, node.location.end);
function project(node, omitFeedback = false) {
  if (omitFeedback && hasClass(node, 'dm-send-feedback') ||
      node.type === 'text' && !node.value.trim()) return null;
  const { location, children, ...fields } = node;
  return { ...fields, ...(children ? { children: children.map(child => project(child, omitFeedback)).filter(Boolean) } : {}) };
}
function lineSpan(bytes, node) {
  const start = bytes.lastIndexOf(10, node.location.start - 1) + 1;
  const newline = bytes.indexOf(10, node.location.end);
  assert.ok(newline >= node.location.end, 'Block has its original trailing newline');
  assert.match(bytes.subarray(start, node.location.start).toString('ascii'), /^ *$/);
  assert.match(bytes.subarray(node.location.end, newline).toString('ascii'), /^ *$/);
  return { start, end: newline + 1 };
}
function idList(tree) {
  const ids = [];
  for (const node of all(tree, node => node.type === 'element')) {
    const attributes = node.attrs.filter(([name]) => name === 'id');
    assert.ok(attributes.length <= 1, 'No duplicated id attribute on one element');
    if (attributes.length) { assert.ok(attributes[0][1]); ids.push(attributes[0][1]); }
  }
  assert.equal(new Set(ids).size, ids.length, 'Every id is unique');
  return ids.sort();
}
function assertSourcesUnchanged() {
  assert.deepEqual(readProductSources(), productBytes, 'Checked-in CSS/JS canonical source pins remain unchanged');
  if (localMode) {
    assert.deepEqual(sharedHashes(), sharedBefore, 'Explicit-local shared product raw bytes remain untouched');
  } else {
    assert.deepEqual(selectCandidate(undefined, undefined).bytes, candidate.bytes, 'Checked-in candidate pin remains unchanged');
  }
  assert.deepEqual(originalFixture(readFileSync(fixturePath)), originalBytes, 'Repository fixture remains untouched');
}
after(assertSourcesUnchanged);

test('repository baseline fixture and selected candidate are pinned without shared dirty HTML as baseline', () => {
  assert.equal(originalBytes.length, 43093);
  assert.equal(candidate.bytes.length, originalBytes.length);
  assert.equal(sha(candidate.bytes), candidateSha);
  assert.equal(sha(originalBytes), originalSha);
  assert.equal(candidate.mode, localMode ? 'local_overlay' : 'checked_in');
  const localPath = 'E:/synthetic-qa/character-chat.candidate.html';
  const read = path => { assert.equal(path, localPath); return candidate.bytes; };
  assert.deepEqual(selectCandidate(localPath, candidateSha.toUpperCase(), { read }).bytes, candidate.bytes);
  for (const [path, hash] of [[undefined, candidateSha], [candidate.path, undefined], ['', candidateSha]])
    assert.throws(() => selectCandidate(path, hash), /paired raw SHA256/);
  assert.throws(() => selectCandidate(localPath, '0'.repeat(64), { read }), /Selected raw bytes/);
});

test('all ids remain unique and the baseline id inventory is preserved', () => {
  assert.deepEqual(idList(overlay), idList(original));
  for (const id of ['chatInputForm', 'chatInput', 'chatSendBtn', 'chatSendStatus', 'chatCheckMessages', 'chatBasicNote'])
    byId(overlay, id);
});

test('feedback retains the same status live region, empty paragraph and readonly button', () => {
  const before = feedback(original), after = feedback(overlay);
  assert.deepEqual(project(after), project(before));
  assert.equal(attr(after, 'role'), 'status');
  assert.equal(attr(after, 'aria-live'), 'polite');
  const status = byId(overlay, 'chatSendStatus'), check = byId(overlay, 'chatCheckMessages');
  assert.deepEqual(elements(after), [status, check]);
  assert.equal(status.tag, 'p');
  assert.deepEqual(status.children, [], 'No whitespace/text added inside :empty paragraph');
  assert.equal(check.tag, 'button');
  assert.equal(attr(check, 'type'), 'button');
  assert.ok(hasAttr(check, 'hidden'));
  assert.ok(!hasAttr(check, 'form'), 'Readonly control has no alternate form target');
});

test('feedback moves from the room sibling to the last direct composer child', () => {
  const beforeForm = byId(original, 'chatInputForm'), form = byId(overlay, 'chatInputForm');
  const beforeFeedback = feedback(original), afterFeedback = feedback(overlay);
  assert.equal(form.tag, 'form');
  assert.ok(hasClass(form, 'dm-dock'));
  assert.equal(parent(original, beforeFeedback), parent(original, beforeForm));
  assert.equal(parent(overlay, afterFeedback), form);
  assert.deepEqual(elements(form).slice(0, -1).map(node => project(node)),
    elements(beforeForm).map(node => project(node)));
  assert.equal(elements(form).at(-1), afterFeedback);
  assert.equal(elements(form).at(-2), byId(overlay, 'chatSendBtn'));
  assert.equal(parent(overlay, byId(overlay, 'chatCheckMessages')), afterFeedback);
  assert.ok(afterFeedback.location.end < form.location.endTagStart);
  assert.match(candidate.bytes.subarray(afterFeedback.location.end, form.location.endTagStart).toString('utf8'), /^\s*$/);
  const roomChildren = elements(parent(overlay, form));
  assert.equal(roomChildren[roomChildren.indexOf(form) + 1], byId(overlay, 'chatBasicNote'));
});

test('the complete candidate is precisely one original feedback byte-span relocation', () => {
  const oldSpan = lineSpan(originalBytes, feedback(original));
  const newSpan = lineSpan(candidate.bytes, feedback(overlay));
  const moved = originalBytes.subarray(oldSpan.start, oldSpan.end);
  assert.deepEqual(candidate.bytes.subarray(newSpan.start, newSpan.end), moved, 'No reindentation or content edits');
  const form = byId(original, 'chatInputForm');
  const insert = originalBytes.lastIndexOf(10, form.location.endTagStart - 1) + 1;
  assert.ok(insert < oldSpan.start, 'Baseline block is outside the composer');
  const expected = Buffer.concat([originalBytes.subarray(0, insert), moved,
    originalBytes.subarray(insert, oldSpan.start), originalBytes.subarray(oldSpan.end)]);
  assert.deepEqual(candidate.bytes, expected, 'All other canonical LF bytes and trailing newline are unchanged');
});

test('the remaining complete parsed document is unchanged after omitting the moved subtree', () => {
  assert.deepEqual(project(overlay, true), project(original, true));
});

test('scripts, styles, notes, footers, form attributes and initial input bytes are preserved', () => {
  for (const predicate of [node => node.tag === 'script', node => node.tag === 'link',
    node => node.tag === 'footer', node => hasClass(node, 'dm-foot-note')]) {
    assert.deepEqual(all(overlay, predicate).map(node => raw(candidate.bytes, node)),
      all(original, predicate).map(node => raw(originalBytes, node)));
  }
  assert.deepEqual(byId(overlay, 'chatInputForm').attrs, byId(original, 'chatInputForm').attrs);
  for (const id of ['chatInput', 'chatSendBtn', 'chatSendStatus', 'chatCheckMessages'])
    assert.deepEqual(raw(candidate.bytes, byId(overlay, id)), raw(originalBytes, byId(original, id)));
  assert.equal(attr(byId(overlay, 'chatSendBtn'), 'type'), 'submit');
  assert.equal(attr(byId(overlay, 'chatCheckMessages'), 'type'), 'button');
});

test('existing pinned grid, empty-feedback, mobile-fixed and observed-height premises still apply', () => {
  const css = productBytes['styles/character-chat.css'].toString('utf8');
  assert.match(css, /\.dm-dock\s*\{[^}]*display:\s*grid;/);
  assert.ok(css.includes('.dm-dock .dm-send-feedback { grid-column: 1 / -1; margin: 0; }'));
  assert.ok(css.includes('.dm-dock .dm-send-feedback:has(> #chatSendStatus:empty):has(> #chatCheckMessages[hidden]) { display: none; }'));
  assert.match(css, /@media \(max-width: 767px\)\s*\{\s*\.page-character-chat:has\(#chatRoomShell:not\(\[hidden\]\)\)/);
  assert.match(css, /\.page-character-chat #chatRoomShell \.dm-dock\s*\{\s*position: fixed;\s*inset: auto 0 0;/);
  assert.ok(css.includes('padding-bottom: var(--chat-dock-space, 80px);'));
  const js = productBytes['pages/character-chat.js'].toString('utf8');
  assert.ok(js.includes('Math.max(80, Math.ceil(form.getBoundingClientRect().height) + 16)'));
  assert.ok(js.includes('document.documentElement.style.setProperty("--chat-dock-space", space + "px")'));
  assert.ok(js.includes('dockObserver.observe(form);'));
  assert.ok(js.includes('check.addEventListener("click", checkBasicChatMessages);'));
});

test('selected checked-in sources stay pinned and explicit-local shared files stay untouched', () => {
  assertSourcesUnchanged();
});

test('default selection works on D and non-E checkouts with no external QA reads', () => {
  for (const checkedInPath of ['D:/a/shallow-repo/character-chat.html', '/ci/shallow-repo/character-chat.html']) {
    for (const rawBytes of [candidate.bytes, crlf(candidate.bytes)]) {
      const reads = [];
      const read = path => { reads.push(path); assert.equal(path, checkedInPath); return rawBytes; };
      const selected = selectCandidate(undefined, undefined, { checkedInPath, read });
      assert.equal(selected.mode, 'checked_in');
      assert.equal(selected.path, checkedInPath);
      assert.deepEqual(selected.bytes, candidate.bytes);
      assert.deepEqual(reads, [checkedInPath], 'One repository HTML read, no sibling QA or Git lookup');
    }
  }
});

test('explicit local overlay rejects non-E paths, hash mismatch, altered bytes and CRLF substitution', () => {
  const read = () => { assert.fail('Invalid explicit selector must fail before reading'); };
  for (const path of ['D:/qa/candidate.html', 'C:/qa/candidate.html', '/qa/candidate.html', 'E:relative.html'])
    assert.throws(() => selectCandidate(path, candidateSha, { read }), /absolute E-drive path/);
  const localPath = 'E:/synthetic-qa/candidate.html';
  const changed = Buffer.from(candidate.bytes); changed[0] ^= 1;
  for (const rawBytes of [changed, crlf(candidate.bytes)])
    assert.throws(() => selectCandidate(localPath, sha(rawBytes), { read: () => rawBytes }), /exact frozen local candidate/);
  assert.throws(() => selectCandidate(localPath, '0'.repeat(64), { read: () => candidate.bytes }), /Selected raw bytes/);
});

test('checked-in HTML CSS and JS accept only frozen LF or exact CRLF equivalence', () => {
  for (const [label, bytes, hash] of [['character-chat.html', candidate.bytes, candidateSha],
    ...Object.entries(productBytes).map(([path, bytes]) => [path, bytes, productPins[path]])]) {
    assert.equal(checkedInBytes(bytes, hash, label).format, 'lf');
    const windows = checkedInBytes(crlf(bytes), hash, label);
    assert.equal(windows.format, 'crlf');
    assert.deepEqual(windows.bytes, bytes);
    const firstNewline = bytes.indexOf(10);
    assert.ok(firstNewline >= 0 && bytes.indexOf(10, firstNewline + 1) >= 0);
    const mixed = Buffer.concat([bytes.subarray(0, firstNewline), Buffer.from('\r\n'), bytes.subarray(firstNewline + 1)]);
    assert.throws(() => checkedInBytes(mixed, hash, label), /Only exact CRLF equivalence/);
    const bareCarriageReturn = Buffer.concat([bytes.subarray(0, firstNewline), Buffer.from('\r'), bytes.subarray(firstNewline + 1)]);
    assert.throws(() => checkedInBytes(bareCarriageReturn, hash, label), /Frozen LF source/);
  }
});

test('semantic and unrelated byte changes in every checked-in source are rejected', () => {
  for (const [label, bytes, hash] of [['character-chat.html', candidate.bytes, candidateSha],
    ...Object.entries(productBytes).map(([path, bytes]) => [path, bytes, productPins[path]])]) {
    const changed = Buffer.from(bytes); changed[0] ^= 1;
    for (const invalid of [changed, crlf(changed), Buffer.concat([bytes, Buffer.from(' ')]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]), bytes.subarray(0, -1)])
      assert.throws(() => checkedInBytes(invalid, hash, label), /Frozen LF source/);
  }
});

test('the original fixture accepts exact LF CRLF equivalence but rejects mixed EOL content changes BOM and truncation', () => {
  assert.deepEqual(originalFixture(originalBytes), originalBytes);
  assert.deepEqual(originalFixture(crlf(originalBytes)), originalBytes);
  const changed = Buffer.from(originalBytes); changed[0] ^= 1;
  assert.throws(() => originalFixture(changed), /Frozen LF source/);
  const newline = originalBytes.indexOf(10);
  const mixed = Buffer.concat([originalBytes.subarray(0, newline), Buffer.from('\r\n'), originalBytes.subarray(newline + 1)]);
  assert.throws(() => originalFixture(mixed), /Only exact CRLF equivalence/);
  const bareCarriageReturn = Buffer.concat([originalBytes.subarray(0, newline), Buffer.from('\r'), originalBytes.subarray(newline + 1)]);
  for (const invalid of [bareCarriageReturn, crlf(changed), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), originalBytes]),
    originalBytes.subarray(0, -1), Buffer.concat([originalBytes, Buffer.from(' ')])])
    assert.throws(() => originalFixture(invalid), /Frozen LF source/);
});
