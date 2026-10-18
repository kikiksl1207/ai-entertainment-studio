'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/fan-engagement/fan-engagement.service.ts');
const source = fs.readFileSync(file, 'utf8');
const built = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true, emitDecoratorMetadata: true } });
assert.equal((built.diagnostics || []).length, 0);
class BadRequestException extends Error {
  constructor(response) { super(response.message); this.response = response; }
  getStatus() { return 400; }
}
class NotFoundException extends BadRequestException { getStatus() { return 404; } }
const moduleValue = { exports: {} };
const imports = {
  '@nestjs/common': { BadRequestException, NotFoundException, Injectable: () => value => value },
  '@prisma/client': { Prisma: { TransactionIsolationLevel: { RepeatableRead: 'RepeatableRead' } } },
  '../prisma/prisma.service': { PrismaService: class PrismaService {} },
};
vm.runInNewContext(built.outputText, { module: moduleValue, exports: moduleValue.exports,
  require(name) { assert(Object.hasOwn(imports, name), 'Only closed synthetic dependencies are admitted'); return imports[name]; } },
{ filename: 'actual-whole-fan-mission-uuid.js', timeout: 1000 });
const Service = moduleValue.exports.FanEngagementService;
assert.equal(typeof Service, 'function');
const actor = '00000000-0000-4000-8000-000000000001';
const otherActor = '00000000-0000-4000-8000-000000000002';
const mission = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const differentMission = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'synthetic-mission-replay-key';
const plain = value => JSON.parse(JSON.stringify(value));
const body = () => ({ action: 'complete', idempotencyKey: key });
function fixture() {
  const row = Object.freeze({ id: '00000000-0000-4000-8000-000000000003',
    missionId: mission, userId: actor, status: 'accepted', moderationStatus: 'not_required',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), sourceType: null, sourceId: null,
    metadata: Object.freeze({}) });
  const before = JSON.stringify(row), calls = { lookups: [], missionReads: 0, writes: 0 };
  const forbidden = () => { calls.writes++; throw new Error('Replay must not enter a write path'); };
  const prisma = {
    fanMissionParticipation: {
      async findUnique(request) {
        const query = plain(request.where.userId_idempotencyKey); calls.lookups.push(query);
        assert.equal(query.idempotencyKey, key);
        return query.userId === actor ? row : null;
      },
      create: forbidden,
    },
    fanMission: { async findUnique(request) { calls.missionReads++; assert.equal(request.where.id, mission); return null; } },
    fanEngagementPointLedger: { create: forbidden, findUnique: forbidden },
    $transaction: forbidden,
  };
  return { service: new Service(prisma), row, calls,
    unchanged() { assert.equal(JSON.stringify(row), before); assert.equal(calls.writes, 0); } };
}
async function reject(f, actorId, id, input, code, status = 400) {
  await assert.rejects(f.service.createMissionParticipation(actorId, id, input),
    error => error.getStatus() === status && error.response.code === code);
  f.unchanged();
}

// Whole current service with synthetic rows/adapters, not authentication or SQL.
test('mission UUID replay accepts case variants with one existing receipt and no duplicate write', async () => {
  const f = fixture();
  const expected = plain(await f.service.createMissionParticipation(actor, mission, body()));
  assert.equal(expected.idempotentReplay, true);
  assert.equal(expected.participation.id, f.row.id);
  assert.equal(expected.rewards.pointsGranted, 0);
  assert.equal(expected.rewards.cashLike, false);
  for (const id of [mission.toUpperCase(), 'AbCdEfAb-CdEf-4aBc-8DeF-AbCdEfAbCdEf'])
    assert.deepEqual(plain(await f.service.createMissionParticipation(actor, id, body())), expected);
  assert.deepEqual(f.calls.lookups, Array(3).fill({ userId: actor, idempotencyKey: key }));
  assert.equal(f.calls.missionReads, 0); f.unchanged();
});
test('mission UUID replay keeps different mission changed body and unrelated owner separated', async () => {
  const f = fixture();
  await reject(f, actor, differentMission.toUpperCase(), body(), 'IDEMPOTENCY_KEY_REUSED');
  await reject(f, actor, mission.toUpperCase(), { ...body(), sourceType: 'different' }, 'IDEMPOTENCY_BODY_MISMATCH');
  await reject(f, otherActor, mission.toUpperCase(), body(), 'MISSION_NOT_FOUND', 404);
  assert.deepEqual(f.calls.lookups, [
    { userId: actor, idempotencyKey: key }, { userId: actor, idempotencyKey: key },
    { userId: otherActor, idempotencyKey: key },
  ]);
  assert.equal(f.calls.missionReads, 1); f.unchanged();
});
test('mission UUID replay preserves invalid UUID and body rejection before any lookup', async () => {
  const f = fixture();
  await reject(f, actor, 'not-a-uuid', null, 'INVALID_UUID');
  await reject(f, actor, mission.toUpperCase(), null, 'INVALID_REQUEST');
  await reject(f, actor, mission.toUpperCase(), { idempotencyKey: 7 }, 'INVALID_FIELD_TYPE');
  await reject(f, actor, mission.toUpperCase(), { ...body(), action: 'erase' }, 'INVALID_MISSION_ACTION');
  assert.deepEqual(f.calls.lookups, []); assert.equal(f.calls.missionReads, 0); f.unchanged();
});
