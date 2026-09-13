// Offline only: one local manuscript, current parser/controller/store, in-memory DB double.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [sourcePath, dependenciesDirectory] = process.argv.slice(2);
assert(sourcePath && dependenciesDirectory, 'usage: node verifier.mjs INPUT_JSON SERVER_NODE_MODULES');
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = createRequire(resolve(dependenciesDirectory, '../package.json'));
const ts = dependencies('typescript');
dependencies('reflect-metadata');
const require = createRequire(import.meta.url);
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, filename) => {
  assert(filename.startsWith(resolve(server, 'src')));
  module.paths = [resolve(dependenciesDirectory), ...module.paths];
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, emitDecoratorMetadata: true },
  }).outputText, filename);
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const bytes = readFileSync(sourcePath);
  const before = { sha256: hash(bytes), mtime: statSync(sourcePath).mtimeMs };
  const { StoryManuscriptFileController } = require(resolve(server, 'src/story-production/story-manuscript-file.controller.ts'));
  const userId = '00000000-0000-4000-8000-000000000001';
  const workId = '00000000-0000-4000-8000-000000000002';
  let stored;
  let inserts = 0;
  let transactions = 0;
  const tx = {
    $queryRaw: async sql => { assert.deepEqual(sql.values, [workId, userId]); return [{ id: workId }]; },
    storyWork: { findFirst: async query => {
      assert.deepEqual(query.where, { id: workId, ownerUserId: userId }); return { id: workId };
    } },
    storyManuscriptVersion: {
      findUnique: async query => stored?.contentHash === query.where.workId_contentHash.contentHash ? stored : null,
      findFirst: async () => stored ? { version: stored.version } : null,
      create: async ({ data }) => {
        assert(!stored); inserts++;
        return stored = { ...data, id: '00000000-0000-4000-8000-000000000003', createdAt: new Date('2026-09-14T00:00:00Z') };
      },
    },
  };
  const prisma = { storyWork: tx.storyWork, $transaction: async (action, options) => {
    transactions++;
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2000, timeout: 10000 });
    return action(tx);
  } };
  const controller = new StoryManuscriptFileController(prisma);
  const file = { fieldname: 'manuscript', originalname: 'manuscript.json', mimetype: 'application/json', size: bytes.length, buffer: bytes };
  const first = await controller.create({ id: userId }, workId, file);
  assert.equal(first.received.sha256, before.sha256);
  assert.equal(first.rawSource, 'stored_with_version');
  assert.deepEqual(stored.structuredBody.parts, JSON.parse(bytes).parts);
  assert.equal(hash(Buffer.from(stored.structuredBody.intake.source.rawText)), before.sha256);
  const storedBytes = Buffer.byteLength(JSON.stringify(stored.structuredBody));
  const replay = await controller.create({ id: userId }, workId, file);
  assert.deepEqual(replay.manuscript, first.manuscript);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(inserts, 1);
  assert.equal(first.analysisStarted, false);
  assert(!/rawText|structuredBody|storageKey|ownerUserId/.test(JSON.stringify(first)));
  assert.deepEqual({ sha256: hash(readFileSync(sourcePath)), mtime: statSync(sourcePath).mtimeMs }, before);
  console.log(JSON.stringify({ offline: true, testDoubleOnly: true, sourceBytes: bytes.length,
    sourceSha256: before.sha256, parts: first.received.parts, paragraphs: first.received.paragraphs,
    contentHash: first.manuscript.contentHash, storedJsonBytes: storedBytes,
    storedToSourceRatio: Number((storedBytes / bytes.length).toFixed(3)), inserts, transactions,
    completeProjectionAndRawRoundtrip: true, replaySameVersion: true, sourceHashAndMtimeUnchanged: true,
    analysisStarted: false, databaseOrNetworkUsed: false, publicationReady: false }));
} finally {
  if (previous) Module._extensions['.ts'] = previous;
  else delete Module._extensions['.ts'];
}
