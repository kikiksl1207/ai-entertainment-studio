import { FanEngagementService } from './fan-engagement.service';

const userId = '00000000-0000-4000-8000-000000000001';
const voteId = '00000000-0000-4000-8000-000000000a01';
const optionId = '00000000-0000-4000-8000-000000000b01';
const otherOptionId = '00000000-0000-4000-8000-000000000b02';
const missionId = '00000000-0000-4000-8000-000000000c01';
const artistId = '00000000-0000-4000-8000-000000000d01';
const createdAt = new Date('2026-10-12T00:00:00Z');

function fixture() {
  const vote = {
    id: voteId, artistId, status: 'active', visibility: 'public', startsAt: null, endsAt: null,
    artist: { id: artistId, slug: 'synthetic', displayName: 'Synthetic' },
    options: [{ id: optionId }, { id: otherOptionId }],
  };
  const mission = {
    id: missionId, artistId, missionType: 'vote_concept', actionType: 'concept_vote',
    actionTargetId: voteId, status: 'active', startsAt: null, endsAt: null,
    resetPolicy: 'once', rewardPolicy: { points: 5 },
  };
  const ballot = {
    id: '00000000-0000-4000-8000-000000000e01', userId, voteId, optionId,
    missionId, idempotencyKey: 'synthetic-key', createdAt, vote,
  };
  const participation = {
    id: '00000000-0000-4000-8000-000000000f01', missionId, userId, status: 'accepted',
    moderationStatus: 'not_required', createdAt,
  };
  const locks: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      locks.push({ sql: parts.join('?'), values }); return [{ id: values[0] }];
    }),
    conceptVote: { findUnique: jest.fn().mockResolvedValue(vote) },
    fanMission: { findUnique: jest.fn().mockResolvedValue(mission) },
    conceptVoteBallot: { create: jest.fn().mockResolvedValue(ballot) },
    fanMissionParticipation: { create: jest.fn().mockResolvedValue(participation) },
    fanEngagementPointLedger: {
      findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'synthetic-ledger' }),
    },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ optionId, ballotCount: BigInt(1) }]),
    conceptVote: { findUnique: jest.fn().mockResolvedValue(vote) },
    fanMission: { findUnique: jest.fn().mockResolvedValue(mission) },
    conceptVoteBallot: {
      findUnique: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([{ optionId, _count: { _all: 1 } }]),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new FanEngagementService(prisma as never);
  const body = { optionId, missionId, idempotencyKey: 'synthetic-key' };
  const noWrites = () => {
    expect(tx.conceptVoteBallot.create).not.toHaveBeenCalled();
    expect(tx.fanMissionParticipation.create).not.toHaveBeenCalled();
    expect(tx.fanEngagementPointLedger.create).not.toHaveBeenCalled();
  };
  return { vote, mission, ballot, participation, locks, tx, prisma, service, body, noWrites };
}

describe('Concept ballot current-state boundary (mocked client, not native SQL)', () => {
  it('locks vote, selected option and linked mission before reading the current transaction state', async () => {
    const f = fixture();
    const result = await f.service.submitConceptVoteBallot(userId, voteId, f.body);
    expect(f.locks).toEqual([
      { sql: 'SELECT id FROM public.concept_votes WHERE id = ?::uuid FOR SHARE', values: [voteId] },
      { sql: 'SELECT id FROM public.concept_vote_options WHERE id = ?::uuid AND vote_id = ?::uuid FOR SHARE', values: [optionId, voteId] },
      { sql: 'SELECT id FROM public.fan_missions WHERE id = ?::uuid FOR SHARE', values: [missionId] },
    ]);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(f.tx.conceptVote.findUnique.mock.invocationCallOrder[0]);
    expect(f.tx.conceptVote.findUnique.mock.invocationCallOrder[0]).toBeLessThan(f.tx.conceptVoteBallot.create.mock.invocationCallOrder[0]);
    expect(f.tx.fanMission.findUnique).toHaveBeenCalledWith({ where: { id: missionId } });
    expect(result).toMatchObject({ ballot: { voteId, optionId }, viewer: { hasVoted: true, selectedOptionId: optionId },
      missionParticipation: { missionId, status: 'accepted' }, rewards: { pointsGranted: 5, cashLike: false, luminaAmount: 0 }, idempotentReplay: false });
    expect(f.tx.conceptVoteBallot.create).toHaveBeenCalledTimes(1);
    expect(f.tx.fanMissionParticipation.create).toHaveBeenCalledTimes(1);
    expect(f.tx.fanEngagementPointLedger.create).toHaveBeenCalledTimes(1);
  });

  it('accepts an exact same-owner retry without transaction or extra reward', async () => {
    const f = fixture(); f.prisma.conceptVoteBallot.findUnique.mockResolvedValue(f.ballot);
    const result = await f.service.submitConceptVoteBallot(userId, voteId.toUpperCase(), {
      ...f.body, optionId: optionId.toUpperCase(), missionId: missionId.toUpperCase(),
    });
    expect(f.prisma.conceptVoteBallot.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_idempotencyKey: { userId, idempotencyKey: f.body.idempotencyKey } },
    }));
    expect(result).toMatchObject({ idempotentReplay: true, missionParticipation: null, rewards: { pointsGranted: 0 } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled(); f.noWrites();
  });

  it.each([
    [1, 'CONCEPT_VOTE_NOT_FOUND'], [2, 'OPTION_NOT_IN_VOTE'], [3, 'MISSION_NOT_FOUND'],
  ])('rejects an empty lock result at query %i even when the later current state is valid', async (query, code) => {
    const f = fixture();
    for (let index = 1; index < query; index++) {
      f.tx.$queryRaw.mockResolvedValueOnce([{ id: index === 1 ? voteId : optionId }]);
    }
    f.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code } });
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(query);
    expect(f.tx.conceptVote.findUnique).not.toHaveBeenCalled(); f.noWrites();
  });

  it.each([
    [1, voteId, 'CONCEPT_VOTE_NOT_FOUND'], [2, optionId, 'OPTION_NOT_IN_VOTE'], [3, missionId, 'MISSION_NOT_FOUND'],
  ])('rejects duplicate or mismatched lock rows at query %i', async (query, expected, code) => {
    for (const rows of [[{ id: otherOptionId }], [{ id: expected }, { id: expected }]]) {
      const f = fixture();
      for (let index = 1; index < query; index++) {
        f.tx.$queryRaw.mockResolvedValueOnce([{ id: index === 1 ? voteId : optionId }]);
      }
      f.tx.$queryRaw.mockResolvedValueOnce(rows);
      await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
        .rejects.toMatchObject({ response: { code } });
      expect(f.tx.$queryRaw).toHaveBeenCalledTimes(query);
      expect(f.tx.conceptVote.findUnique).not.toHaveBeenCalled(); f.noWrites();
    }
  });

  it.each([
    ['other-option', { optionId: otherOptionId }],
    ['other-mission', { missionId: '00000000-0000-4000-8000-000000000c02' }],
    ['missing-mission', { missionId: null }],
  ])('rejects key reuse with a changed %s', async (_name, override) => {
    const f = fixture(); f.prisma.conceptVoteBallot.findUnique.mockResolvedValue(f.ballot);
    await expect(f.service.submitConceptVoteBallot(userId, voteId, { ...f.body, ...override }))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_BODY_MISMATCH' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled(); f.noWrites();
  });

  it('keeps key reuse for another vote distinct from a changed body', async () => {
    const f = fixture(); f.prisma.conceptVoteBallot.findUnique.mockResolvedValue({ ...f.ballot,
      voteId: '00000000-0000-4000-8000-000000000a02' });
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } }); f.noWrites();
  });

  it('rejects a private vote before entering the write transaction', async () => {
    const f = fixture(); f.prisma.conceptVote.findUnique.mockResolvedValue({ ...f.vote, visibility: 'private' });
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code: 'VOTE_NOT_ACTIVE' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled(); f.noWrites();
  });

  it.each([
    ['private', { visibility: 'private' }], ['closed', { status: 'closed' }],
    ['expired', { endsAt: new Date('2000-01-01T00:00:00Z') }],
  ])('rejects a vote that becomes %s after preflight', async (_name, override) => {
    const f = fixture(); f.tx.conceptVote.findUnique.mockResolvedValue({ ...f.vote, ...override });
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code: 'VOTE_NOT_ACTIVE' } }); f.noWrites();
  });

  it('rejects a selected option removed after preflight', async () => {
    const f = fixture(); f.tx.conceptVote.findUnique.mockResolvedValue({ ...f.vote, options: [{ id: otherOptionId }] });
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code: 'OPTION_NOT_IN_VOTE' } }); f.noWrites();
  });

  it.each([
    ['closed', { status: 'closed' }, 'MISSION_NOT_ACTIVE'],
    ['relinked', { actionTargetId: '00000000-0000-4000-8000-000000000a02' }, 'MISSION_NOT_LINKED_TO_VOTE'],
    ['other-artist', { artistId: '00000000-0000-4000-8000-000000000d02' }, 'MISSION_NOT_LINKED_TO_VOTE'],
  ])('rejects the %s linked mission read inside the transaction', async (_name, override, code) => {
    const f = fixture(); f.tx.fanMission.findUnique.mockResolvedValue({ ...f.mission, ...override });
    await expect(f.service.submitConceptVoteBallot(userId, voteId, f.body))
      .rejects.toMatchObject({ response: { code } }); f.noWrites();
  });

  it.each([null, [], false])('rejects a non-object request before reads or writes (%j)', async body => {
    const f = fixture();
    await expect(f.service.submitConceptVoteBallot(userId, voteId, body as never))
      .rejects.toMatchObject({ response: { code: 'INVALID_REQUEST' } });
    expect(f.prisma.conceptVoteBallot.findUnique).not.toHaveBeenCalled(); f.noWrites();
  });

  it.each(['optionId', 'missionId', 'idempotencyKey'])('rejects a malformed %s without silently dropping it', async field => {
    const f = fixture();
    await expect(f.service.submitConceptVoteBallot(userId, voteId, { ...f.body, [field]: { fake: true } }))
      .rejects.toMatchObject({ response: { code: 'INVALID_FIELD_TYPE' } }); f.noWrites();
  });
});
