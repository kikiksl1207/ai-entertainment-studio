import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

describe('private story draft creation', () => {
  const rows = new Map<string, any>();
  const prisma = { storyWork: {
    findUnique: jest.fn(async ({ where: { slug } }) => rows.get(slug) ?? null),
    create: jest.fn(async ({ data }) => {
      const row = { id: '44444444-4444-4444-8444-444444444444', ...data };
      rows.set(data.slug, row);
      return row;
    }),
  } };
  const service = new StoryProductionService(prisma as never);

  beforeEach(() => { rows.clear(); jest.clearAllMocks(); });

  it('creates only a private owner-scoped work without release or AI activation', async () => {
    const created = await service.createDraft(owner, { requestId, title: '  내 작품  ', locale: 'ko' });
    expect(created).toEqual({ workId: '44444444-4444-4444-8444-444444444444',
      slug: `draft-${requestId}`, status: 'draft' });
    expect(prisma.storyWork.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: owner, status: 'draft', title: { ko: '내 작품' }, summary: {},
      fixtureSource: false, supportedLocales: ['ko'],
    }) });
    expect(prisma.storyWork.create.mock.calls[0][0].data).not.toHaveProperty('activeReleaseId');
  });

  it('replays the same request without creating another work and rejects a different owner', async () => {
    const input = { requestId, title: '내 작품', locale: 'ko' };
    const first = await service.createDraft(owner, input);
    expect(await service.createDraft(owner, input)).toEqual(first);
    expect(prisma.storyWork.create).toHaveBeenCalledTimes(1);
    await expect(service.createDraft(other, input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an empty title and changed data under the same request id', async () => {
    await expect(service.createDraft(owner, { requestId, title: '   ', locale: 'ko' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createDraft(owner, { requestId, title: '첫 줄\n둘째 줄', locale: 'ko' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await service.createDraft(owner, { requestId, title: '처음', locale: 'ko' });
    await expect(service.createDraft(owner, { requestId, title: '변경', locale: 'ko' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('story draft creator-studio access', () => {
  const createDraft = jest.fn(async () => ({ workId: 'draft-id', status: 'draft' }));
  const getStudio = jest.fn();
  const controller = new StoryProductionController({ createDraft } as never, {} as never,
    undefined, undefined, { getStudio } as never);
  const user = { id: owner };
  const body = { requestId, title: '내 작품', locale: 'ko' };

  beforeEach(() => { jest.clearAllMocks(); });

  it('denies a signed-in account without existing creator-studio approval', async () => {
    getStudio.mockResolvedValue({ access: { enabled: false } });
    await expect(controller.createDraft(user, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('lets an approved studio account create only its own private draft', async () => {
    getStudio.mockResolvedValue({ access: { enabled: true } });
    await expect(controller.createDraft(user, body)).resolves.toMatchObject({ status: 'draft' });
    expect(createDraft).toHaveBeenCalledWith(owner, body);
  });
});
