import { CommunityService } from './community.service';

describe('Community notification failure logging', () => {
  const input = {
    userId: 'synthetic-recipient', type: 'feed.reply', title: 'Synthetic private title',
    body: 'Synthetic private body', actorUserId: 'synthetic-actor',
    metadata: { syntheticSecret: 'synthetic-not-a-real-secret' },
  };

  function fixture() {
    const createNotification = jest.fn();
    const warn = jest.fn();
    const service = Object.create(CommunityService.prototype) as any;
    service.notificationsService = { createNotification };
    service.logger = { warn };
    return { service, createNotification, warn };
  }

  it('passes the unchanged notification to the existing delivery service', async () => {
    const { service, createNotification, warn } = fixture();
    createNotification.mockResolvedValue({ id: 'synthetic-notification' });
    await expect(service.createNotificationSafely(input)).resolves.toBeUndefined();
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(input);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['error', new Error('Synthetic provider payload containing private content')],
    ['string', 'Synthetic token-like failure text'],
    ['null', null],
    ['object', { syntheticSecret: 'Synthetic private error object' }],
  ])('contains a %s failure without logging its data or retrying', async (_, reason) => {
    const { service, createNotification, warn } = fixture();
    createNotification.mockRejectedValue(reason);
    await expect(service.createNotificationSafely(input)).resolves.toBeUndefined();
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([['Failed to create community notification']]);
  });

  it('does not read or stringify an untrusted error', async () => {
    const { service, createNotification, warn } = fixture();
    const inspect = jest.fn(() => { throw new Error('Must not inspect synthetic error'); });
    const reason = Object.create(Error.prototype);
    Object.defineProperty(reason, 'message', { get: inspect });
    reason.toString = inspect;
    reason[Symbol.toPrimitive] = inspect;
    createNotification.mockRejectedValue(reason);
    await expect(service.createNotificationSafely(input)).resolves.toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([['Failed to create community notification']]);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
