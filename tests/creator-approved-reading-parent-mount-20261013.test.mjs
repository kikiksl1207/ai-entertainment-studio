import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../pages/creator-approved-reading-handoff.js', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('../pages/creator-approved-readonly-transport.js', import.meta.url), 'utf8');
const options = { timeout: 2500 };
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) {
      const list = listeners.get(type) || []; list.push({ fn, once: options?.once === true }); listeners.set(type, list);
    },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn)); },
    emit(type, event = {}) {
      for (const item of [...listeners.get(type) || []]) {
        if (item.once) this.removeEventListener(type, item.fn);
        item.fn({ ...event, type, target: event.target || this });
      }
    },
    count(type) { return (listeners.get(type) || []).length; }
  };
}

function element(tag) {
  const node = { ...events(), tagName: tag.toUpperCase(), parentNode: null, children: [], dataset: {},
    attributes: {}, className: '', hidden: false, disabled: false, value: '', selectionStart: 0, selectionEnd: 0 };
  let text = '';
  node.classList = {
    contains: value => node.className.split(/\s+/).includes(value),
    add(value) { if (!this.contains(value)) node.className = [node.className, value].filter(Boolean).join(' '); },
    remove(value) { node.className = node.className.split(/\s+/).filter(item => item !== value).join(' '); }
  };
  node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
  node.getAttribute = name => node.attributes[name] ?? null;
  node.append = (...children) => { for (const child of children) { child.parentNode = node; node.children.push(child); } };
  node.contains = child => node === child || node.children.some(item => item.contains(child));
  node.closest = selector => {
    assert.equal(selector, 'label', 'Only the actual parent mount label lookup is modeled');
    for (let item = node; item; item = item.parentNode) if (item.tagName === 'LABEL') return item;
    return null;
  };
  node.insertAdjacentElement = (position, child) => {
    assert.equal(position, 'afterend'); assert(node.parentNode, 'Insertion has a real synthetic parent');
    const siblings = node.parentNode.children, index = siblings.indexOf(node); assert(index >= 0);
    child.parentNode = node.parentNode; siblings.splice(index + 1, 0, child); return child;
  };
  Object.defineProperty(node, 'textContent', {
    get: () => text + node.children.map(child => child.textContent).join(''),
    set(value) { text = String(value); for (const child of node.children) child.parentNode = null; node.children = []; }
  });
  Object.defineProperty(node, 'labels', { get: () => { const label = node.closest('label'); return label ? [label] : []; } });
  return node;
}
const descendants = root => [root, ...root.children.flatMap(descendants)];

// Actual sender mount and actual readonly facade; DOM, auth, popup and network are synthetic.
// Label association/text assertions are structural, not a browser AccName implementation.
function fixture({ labelText = '\uC791\uD488', nested = false, labelPresent = true, parentPage = true,
  selectorTag = 'select', disabled = false, hidden = false, active = true, shellPresent = true,
  popup = true, workId = id(2), sourceLocale = 'ko', ownerId = id(1) } = {}) {
  const body = element('body'), shell = element('main'), section = element('section'), grid = element('div');
  body.className = parentPage ? 'page-creator-studio' : '';
  shell.hidden = hidden; section.className = active ? 'is-active' : '';
  body.append(shell); shell.append(section); section.append(grid);
  const label = element(labelPresent ? 'label' : 'div'), labelSpan = element('span'), selector = element(selectorTag);
  labelSpan.textContent = labelText; label.className = 'is-wide'; label.append(labelSpan);
  selector.value = workId; selector.disabled = disabled; selector.id = 'writerManuscriptWork';
  selector.setAttribute('aria-describedby', 'writerManuscriptState');
  selector.selectedOptions = [{ textContent: 'Synthetic selected work' }];
  const selectorParent = nested ? element('span') : label;
  if (nested) label.append(selectorParent);
  selectorParent.append(selector);
  const locale = element('select'); locale.value = sourceLocale;
  const draftTitle = element('input'), draft = element('textarea'), existingStatus = element('p');
  draftTitle.value = 'Untouched title'; draft.value = 'Original draft\r\n<not markup>\n\uC6D0\uBCF8';
  draft.selectionStart = 3; draft.selectionEnd = 8; existingStatus.textContent = 'Existing status';
  grid.append(label, locale, draftTitle, draft, existingStatus);
  const nodes = new Map([['writer-manuscript', section], ['writerManuscriptWork', selector],
    ['writerManuscriptLocale', locale], ['writerDraftTitle', draftTitle], ['writerManuscriptBody', draft],
    ['writerManuscriptState', existingStatus], ...(shellPresent ? [['studioShell', shell]] : [])]);
  const state = { creates: 0, disposed: 0, opens: [], storageWrites: 0, requests: [], constructed: [], messages: [] };
  const originalApi = Object.freeze({ sentinel: 'existing-studio-api' }), originalAuth = () => 'existing-auth-reader';
  const child = { postMessage(data, origin) { state.messages.push({ data, origin }); } };
  const window = { ...events(), getAuth: originalAuth, LuminaCreatorStudioApi: originalApi,
    localStorage: {
      getItem(key) { assert.equal(key, 'lumina_auth'); return ownerId ? JSON.stringify({ accessToken: 'synthetic-reader-token', user: { id: ownerId } }) : null; },
      setItem() { state.storageWrites++; assert.fail('No auth write'); },
      removeItem() { state.storageWrites++; assert.fail('No auth delete'); }
    },
    fetch(url, request) { state.requests.push({ url, request }); assert.fail('Mount/open must not dispatch an API request'); },
    open(url, target) { state.opens.push({ url, target }); return popup ? child : null; }
  };
  const document = { ...events(), body, readyState: 'complete',
    getElementById: name => nodes.get(name) || null,
    createElement(tag) {
      assert(['button', 'span', 'div'].includes(tag), 'No iframe, hidden opener or unrelated form construction');
      state.constructed.push(tag); return element(tag);
    }
  };
  const context = { window, document, location: { origin: 'https://www.lumina-stage.com' }, AbortController };
  runInNewContext(transportSource, context, { filename: 'actual-readonly-parent-transport.js' });
  const factory = window.LuminaCreatorApprovedReadonlyTransport;
  window.LuminaCreatorApprovedReadonlyTransport = Object.freeze({ create() {
    state.creates++; const facade = factory.create();
    return Object.freeze({ ...facade, dispose() { state.disposed++; facade.dispose(); } });
  } });
  const mount = () => runInNewContext(source, context, { filename: 'actual-reading-parent-mount.js' });
  const commandGroups = () => descendants(body).filter(item => item.className === 'writer-actions');
  const buttons = () => descendants(body).filter(item => item.tagName === 'BUTTON');
  return { body, shell, section, grid, label, selectorParent, selector, locale, draftTitle, draft, existingStatus,
    state, window, document, originalApi, originalAuth, mount, commandGroups, buttons,
    close: () => window.emit('pagehide') };
}

for (const [labelText, nested] of [['\uC791\uD488', true], ['\uB0B4 \uC791\uD488', false]]) {
  test(`parent command stays outside the nearest label and preserves ${labelText}`, options, () => {
    const h = fixture({ labelText, nested }), labelChildren = [...h.label.children], association = h.selector.labels[0];
    h.mount();
    assert.equal(h.label.textContent, labelText); assert.deepEqual(h.label.children, labelChildren);
    assert.equal(h.selector.labels[0], association); assert.equal(association, h.label);
    const [commands] = h.commandGroups(), [button] = h.buttons(); assert(commands); assert(button);
    assert.equal(h.commandGroups().length, 1); assert.equal(h.buttons().length, 1);
    assert.equal(commands.parentNode, h.label.parentNode);
    assert.equal(h.grid.children.indexOf(commands), h.grid.children.indexOf(h.label) + 1);
    assert.equal(button.closest('label'), null); assert.equal(commands.children.length, 2);
    assert.equal(commands.children[1].getAttribute('role'), 'status'); assert.equal(button.type, 'button');
    assert.equal(h.state.opens.length, 0); assert.equal(h.state.requests.length, 0); h.close();
  });
}

test('a second actual mount invocation creates no second button group facade or document listener', options, () => {
  const h = fixture(); h.mount(); const commands = h.commandGroups()[0], button = h.buttons()[0];
  const eventCount = h.document.count('change'), constructed = [...h.state.constructed];
  h.mount();
  assert.equal(h.selector.dataset.readingHandoffMounted, 'true'); assert.equal(h.state.creates, 1);
  assert.deepEqual(h.commandGroups(), [commands]); assert.deepEqual(h.buttons(), [button]);
  assert.equal(h.document.count('change'), eventCount); assert.deepEqual(h.state.constructed, constructed);
  assert.equal(h.state.requests.length, 0); h.close();
});

test('mount and explicit open preserve draft inputs selection source locale and parent auth/API globals', options, () => {
  const h = fixture(), value = h.draft.value, title = h.draftTitle.value, beforeChildren = [...h.grid.children];
  h.mount(); h.buttons()[0].emit('click');
  assert.deepEqual(h.state.opens, [{ url: '/creator-studio/approved-reading/', target: '_blank' }]);
  assert.equal(h.draft.value, value); assert.equal(h.draftTitle.value, title);
  assert.equal(h.draft.selectionStart, 3); assert.equal(h.draft.selectionEnd, 8);
  assert.equal(h.selector.value, id(2)); assert.equal(h.locale.value, 'ko');
  assert.equal(h.existingStatus.textContent, 'Existing status');
  assert.deepEqual(h.grid.children.filter(item => item !== h.commandGroups()[0]), beforeChildren);
  assert.equal(h.window.getAuth, h.originalAuth); assert.equal(h.window.LuminaCreatorStudioApi, h.originalApi);
  assert.equal(h.state.storageWrites, 0); assert.equal(h.state.requests.length, 0); h.close();
});

test('blocked popup adds only an outside-label status and no fallback or API request', options, () => {
  const h = fixture({ popup: false }); h.mount(); h.buttons()[0].emit('click');
  assert.equal(h.state.opens.length, 1); assert.equal(h.state.requests.length, 0); assert.equal(h.state.storageWrites, 0);
  assert.equal(h.state.messages.length, 0); assert.equal(h.commandGroups().length, 1);
  const status = h.commandGroups()[0].children[1]; assert(status.textContent.length > 0);
  assert.equal(status.closest('label'), null); assert.equal(h.label.textContent, '\uC791\uD488');
  assert.deepEqual(h.state.constructed, ['button', 'span', 'div']); h.close();
});

for (const [name, config] of [['disabled selector', { disabled: true }], ['hidden shell', { hidden: true }],
  ['inactive manuscript', { active: false }], ['missing shell', { shellPresent: false }]]) {
  test(`${name} blocks the source command without popup or transport`, options, () => {
    const h = fixture(config); h.mount(); h.buttons()[0].emit('click');
    assert.equal(h.state.opens.length, 0); assert.equal(h.state.requests.length, 0);
    assert(h.commandGroups()[0].children[1].textContent.length > 0);
    assert.equal(h.label.textContent, '\uC791\uD488'); h.close();
  });
}

for (const [name, config] of [['reader body', { parentPage: false, selectorTag: 'input' }],
  ['hidden-input work control', { parentPage: true, selectorTag: 'input' }]]) {
  test(`${name} keeps the child mount guard and never creates a parent command`, options, () => {
    const h = fixture(config); h.mount();
    assert.equal(h.state.creates, 0); assert.equal(h.buttons().length, 0); assert.equal(h.commandGroups().length, 0);
    assert.equal(h.selector.dataset.readingHandoffMounted, undefined);
    assert.equal(h.state.opens.length, 0); assert.equal(h.state.requests.length, 0);
  });
}

test('unconfirmed work source locale or owner prevents opening without clearing the draft', options, () => {
  for (const config of [{ workId: '' }, { sourceLocale: 'zh' }, { ownerId: null }]) {
    const h = fixture(config), value = h.draft.value; h.mount(); h.buttons()[0].emit('click');
    assert.equal(h.state.opens.length, 0); assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.storageWrites, 0); assert.equal(h.draft.value, value);
    assert(h.commandGroups()[0].children[1].textContent.length > 0); h.close();
  }
});

test('without an enclosing label the command is inserted after the existing selector parent', options, () => {
  const h = fixture({ labelPresent: false }); h.mount(); const commands = h.commandGroups()[0];
  assert.equal(commands.parentNode, h.selector.parentNode.parentNode);
  assert.equal(h.grid.children.indexOf(commands), h.grid.children.indexOf(h.selector.parentNode) + 1);
  assert.equal(h.label.textContent, '\uC791\uD488'); assert.equal(h.buttons()[0].closest('label'), null);
  assert.equal(h.state.requests.length, 0); h.close();
});
