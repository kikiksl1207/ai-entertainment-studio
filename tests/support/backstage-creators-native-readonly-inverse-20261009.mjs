import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pinned = Object.freeze({
  scope: 'backstage-creators-native-readonly-entry-delta-v1',
  baselineHead: '76be78c2dfa35c3bf28943ddbd0233160907426c',
  beforeSHA256: 'df5f352bae0df49a066035feba1feb9806ff24c2cf35d5e263a8233ed2bf3863',
  afterSHA256: '4780764cf1325e73798af337b3b7bb074dadf96a2a892e94dbd0b36dfc2c342f',
});
const editPins = Object.freeze([
  {
    "label": "native-me-start",
    "beforeSHA256": "69133415aaa17912a42eb72f0f899de977d02b5c8a2cf96cddeffab4d471a25e",
    "afterSHA256": "79f7a9f3bc59d8e7fbd9bfab102dd74751be6318cf0a84a05285e3b90894ebf3"
  },
  {
    "label": "native-me-proof",
    "beforeSHA256": "4e75eacbc2195ff7566f54ae1033ace85c46773d0bb3dd01a3355e744e4ace2e",
    "afterSHA256": "90b8744bb87dab38c8c04a127bc06d2f77cbc31f7001d0300a124439d93cc1b9"
  },
  {
    "label": "row-details",
    "beforeSHA256": "e7e57b22d2db0cbae5ee538ad82629379153f5bcb49165bfa00c88f3fee13830",
    "afterSHA256": "2f2c8028a745aea378e294f52bb788ae3984ce3298b78a110d5788acd925230c"
  },
  {
    "label": "local-history",
    "beforeSHA256": "11cfe3962b8df44cbf5ed04426abb7c1991f3777419158542b6482d999bd2ed6",
    "afterSHA256": "9417dcf3fa4d8ec3458ee54bd105e8d4b536dc54d36e400bbd7e1185732a5f94"
  },
  {
    "label": "detail-panel",
    "beforeSHA256": "8ec9ebe7a95c765b0ca7d166e7de205dd438edc8065e021a7fcc1d15d183ce8e",
    "afterSHA256": "13da73e6fe15e9a98a1df3ec18ddb35b4898076a477d7e85545b5f1162f0b5df"
  },
  {
    "label": "quick-action",
    "beforeSHA256": "e1a3ef9205f327d3f39f8502a9183c5e5ca0d2e7b63f879ee76fafc62b3b7740",
    "afterSHA256": "95549748099775bca81197640d6bf00d15c7341b37ee1da640eab4094fcdb181"
  },
  {
    "label": "inline-action",
    "beforeSHA256": "05ee5e64fd1d75685b834042e6ac95cfa063faa82e3549f3dc995476a0225bdd",
    "afterSHA256": "51ca3709646eabefa28f7ad1e4ba0f9e5df999e3ab9d77baa5cefe2c8e7a8e70"
  },
  {
    "label": "draft",
    "beforeSHA256": "a82879d78ad7f1cb86d21e312be7538a0f4b3be3de1699fcfadb4bbfc6680937",
    "afterSHA256": "b18e7efa0eb74a48279640091dae35934702d870d0dfd0f582e5ab17c81b6c00"
  },
  {
    "label": "detail-form",
    "beforeSHA256": "3cd24d0a1f54a75d6d6fefbf5c11c835c10de2c1befdf5dc34b5c4c1442b46d6",
    "afterSHA256": "8eb513b317c3355f517c8bcaf9dc70de36e9f0ce0b947c28dc304528aacf8ed6"
  },
  {
    "label": "action-request",
    "beforeSHA256": "9211d39efde3d5a590ac4711a0d548e6b4a85c0cabda64664514550532d92f07",
    "afterSHA256": "b6ae3a45eceab19bdf432f0be600ee58aa8f43f76f2bc7e5d16c032b8462019d"
  },
  {
    "label": "preview-start",
    "beforeSHA256": "c2ce1f5c0b6f61f87930adb82e7cae4ba9fa2ed43b87424f2a3a10d014adcfb5",
    "afterSHA256": "a38d05ef83a481a9c9296beb73fe1f25ca519edff9bf361dc7a17abc92e8c15a"
  },
  {
    "label": "preview-fence",
    "beforeSHA256": "1aa919e66008942e6d33fa3fdffec653f2da2bf3b095b00c6914f153e8405963",
    "afterSHA256": "05d3156b985855c957dbba651ab3256a8c5c28f35cda95f9544f7ba2954d9faa"
  },
  {
    "label": "row-action-result",
    "beforeSHA256": "f904a21c27c9371882a656fa018f8e004c73e96caf1f9677ba91d1ed1a70c393",
    "afterSHA256": "08cb6edff3ef7ea91c97026f3b3f0d88edb5d309e84107ae71d8baa47bcf25bd"
  },
  {
    "label": "pending-start",
    "beforeSHA256": "d7388e5ab83fc29b656e4a9f8206c183e32b908456fa8a7bd4f1cef0d726c1dd",
    "afterSHA256": "512d815cdea1c5e4fe73a7056481e25a0d2303bcd4cd608792ffc57276dc6fe9"
  },
  {
    "label": "pending-late",
    "beforeSHA256": "265a4c0dd0e8020ed981cc0f9cf39c23eb46716c13267f1679e653f9723b4202",
    "afterSHA256": "7c9e7f67fba3778eb44225f5a22643a336bf26b8cc6e7baa7f76847297a1f6b9"
  },
  {
    "label": "initial-samples",
    "beforeSHA256": "a9791588f6b05f31909db20cb87edb0a71998ffa1c0ccaa5a5a95de8b39c871d",
    "afterSHA256": "8b7e09a72b90604612c7afcdecdc51287c5cdf528c451642f8ea9b2ec7a6f816"
  },
  {
    "label": "helpers",
    "beforeSHA256": "0973d085ab8ad8c90035430634e1d86ef92f68f06de953772d9747d747a4aa60",
    "afterSHA256": "8fe2f633c55a535ab6f377691203244237afd6c17b4b06555b985a35d13eb58f"
  },
  {
    "label": "entry-admission",
    "beforeSHA256": "87c5780773512f675f0850e24636eb2511e3d7912cf01d27f0dd717e5f6823a1",
    "afterSHA256": "d0cc431f312f734747e5bb9287a7929c712b9d001618abdbce04cc9b97ec6dd1"
  },
  {
    "label": "controls-sync",
    "beforeSHA256": "2b16bc25976009144eb55fb8d4617fc15ddd8ed3ae9b3ed286940fbafc6986cb",
    "afterSHA256": "c9fb9543d405f9c9deb66a1ec5020b26bc880fa8ec7564522d91af1f16753e21"
  },
  {
    "label": "read-context",
    "beforeSHA256": "6f47ccd5997b35cb52191525634957d426a05c7fa2275a5b685eacd87f822f84",
    "afterSHA256": "e4fa911d8ec873f9a7781d7625d9fd5b8151379c133a06783c1508ecdff0c8e0"
  },
  {
    "label": "read-start",
    "beforeSHA256": "3a52613232c5b1ba41c99f604f68f426737e3176625add907dc084724c9a0ba1",
    "afterSHA256": "10d23dadf14d84b409178d61cf6e4345ae0cae07f717f01c989840768d7eccac"
  },
  {
    "label": "read-state",
    "beforeSHA256": "2e3bd84375abeba852a0246b5cb01ff9ad1e647b44873d88a047cb7e36515d85",
    "afterSHA256": "64186d0d35e5691f50df921a1d5f5910be3b5fa5e6557aa051d741a89d0323df"
  },
  {
    "label": "read-current",
    "beforeSHA256": "e7ad5068d403d101140c3dc03d1c3976ad513d02238cf0862b29f2706dc0380b",
    "afterSHA256": "ceb3daf3fda14c6a8bc590c39f8f750feff4e2ff719a8ed01252b1ccf49c2c7c"
  },
  {
    "label": "read-return",
    "beforeSHA256": "0d7d0cf2ce67e49cf390c83553ba358d316211c78466a8788292a65874862a94",
    "afterSHA256": "80f26fb5399440c1270a60a4e1c4bad829e0d1aa0da7162aab836a15903bc2a2"
  },
  {
    "label": "refresh-proof",
    "beforeSHA256": "2e484266d731b56a7a1872843f8e637d8d17aa1a364d647ce6e5b983c4481cec",
    "afterSHA256": "cce4a401c8314a4d16419756fa44df10e7c745adfcac91554f91f6a35fac34aa"
  },
  {
    "label": "aux-scope",
    "beforeSHA256": "722a95ce62af657c1c03b7ba711b038aed4192e9c38840796201dcb8bc423704",
    "afterSHA256": "0d03347e1a23ea123cf7f166b918733aee26ca26b12eeabb575943101751c66e"
  },
  {
    "label": "resolve-details",
    "beforeSHA256": "2be0d52bbd6a046f3d38b0e0dad44b2a46cbb9dc4cd6e0e508a520116b771f17",
    "afterSHA256": "b0650b3c611bc957a11720e684086a42e5d4472e5bcbc63f723d06e8c259274a"
  }
]);
const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/backstage-creators-native-readonly-delta-20261009.json', import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function sourceWithoutCreatorsNativeReadonlyDelta(source, delta = fixture) {
  assert.equal(typeof source, 'string', 'Creators readonly source type');
  const { edits, ...metadata } = delta;
  assert.deepEqual(metadata, pinned, 'Exact readonly inverse metadata');
  assert(Array.isArray(edits), 'Readonly inverse edits type');
  assert.equal(edits.length, editPins.length, 'Exact readonly edit count');
  edits.forEach((edit, index) => {
    assert.deepEqual(Object.keys(edit).sort(), ['after', 'before', 'label'], 'Exact readonly edit keys');
    assert.equal(edit.label, editPins[index].label, 'Exact readonly edit order');
    assert.equal(typeof edit.before, 'string', 'Readonly before text type');
    assert.equal(typeof edit.after, 'string', 'Readonly after text type');
    assert.equal(sha(edit.before), editPins[index].beforeSHA256, 'Exact readonly before text');
    assert.equal(sha(edit.after), editPins[index].afterSHA256, 'Exact readonly after text');
  });
  source = source.replace(/\r\n/g, '\n');
  // Only the two fixed historical inputs used by the existing inverse chain may pass through.
  if ([pinned.beforeSHA256, 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341'].includes(sha(source))) return source;
  assert.equal(sha(source), pinned.afterSHA256, 'Exact readonly current LF source');
  for (const edit of edits.slice().reverse()) {
    const first = source.indexOf(edit.after);
    assert(first >= 0, 'Readonly after interval present');
    assert.equal(source.indexOf(edit.after, first + 1), -1, 'Unique readonly interval');
    source = source.slice(0, first) + edit.before + source.slice(first + edit.after.length);
  }
  assert.equal(sha(source), pinned.beforeSHA256, 'Every df5f baseline byte restored');
  return source;
}
