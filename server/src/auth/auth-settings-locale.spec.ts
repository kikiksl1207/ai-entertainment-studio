import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { renderAuthEmail } from './auth-email-template';
import { SUPPORTED_LOCALES, UpdateSettingsDto } from './dto/auth.dto';

const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];
const userId = '00000000-0000-4000-8000-000000000001';

function service() {
  const prisma = {
    user: { findFirst: jest.fn(async () => ({ id: userId })) },
    userSettings: { upsert: jest.fn(async ({ update }: { update: Record<string, unknown> }) => ({
      userId, locale: 'ko-KR', timezone: 'Asia/Seoul', ...update,
    })) },
  };
  const auth = Object.assign(Object.create(AuthService.prototype), { prisma }) as AuthService;
  return { auth, prisma };
}

describe('auth settings five-language locale boundary', () => {
  it('advertises exactly the frontend canonical locales', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(locales);
    expect(service().auth.getLocalizationPolicy().supportedLocales).toEqual(locales);
  });

  it.each(locales)('validates and preserves canonical %s', async locale => {
    const dto = plainToInstance(UpdateSettingsDto, { locale });
    expect(await validate(dto)).toEqual([]);
    const { auth, prisma } = service();
    const response = await auth.updateSettings(userId, dto);
    expect(response.settings.locale).toBe(locale);
    expect(response.policy.locale.supported).toEqual(locales);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: userId, status: 'active', deletedAt: null }, select: { id: true } });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId },
      create: expect.objectContaining({ userId, locale }), update: expect.objectContaining({ locale }) }));
  });

  it.each(['zh-Hant-extra', 'zh-TW', 'zh-hant', '', 'fr-FR', 'zh-Hant<script>', 1, {}, []])(
    'rejects unsupported setting input %p', async locale => {
      expect((await validate(plainToInstance(UpdateSettingsDto, { locale }))).some(error => error.property === 'locale')).toBe(true);
    });

  it.each(['zh-Hant', 'zh-hant', 'zh_Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-TW', 'zh-TW;q=0.9,en-US;q=0.8'])(
    'detects traditional browser locale %s without switching to simplified', header => {
      expect(service().auth.getLocalizationPolicy(header).detectedLocale).toBe('zh-Hant');
    });

  it.each([['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-Hans', 'zh-CN'], ['en', 'en-US'],
    ['ja', 'ja-JP'], ['ko', 'ko-KR'], ['fr-FR', 'ko-KR'], ['zh-Hant<script>', 'ko-KR']])(
    'retains existing browser locale %s as %s', (header, expected) => {
      expect(service().auth.getLocalizationPolicy(header).detectedLocale).toBe(expected);
    });

  it('normalizes setting whitespace without altering the canonical script', async () => {
    const dto = plainToInstance(UpdateSettingsDto, { locale: ' zh-Hant ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.locale).toBe('zh-Hant');
  });

  it('does not write settings for an inactive account', async () => {
    const { auth, prisma } = service();
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(auth.updateSettings(userId, { locale: 'ko-KR' })).rejects.toMatchObject({ status: 401 });
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
  });

  it('preserves existing rejection of an empty settings command', async () => {
    const { auth, prisma } = service();
    await expect(auth.updateSettings(userId, {})).rejects.toMatchObject({ status: 400 });
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
  });

  it('reads persisted canonical Traditional settings without a language change', async () => {
    const { auth, prisma } = service();
    prisma.userSettings.upsert.mockResolvedValueOnce({ userId, locale: 'zh-Hant', timezone: 'Asia/Seoul' });
    const response = await auth.getSettings(userId);
    expect(response.settings.locale).toBe('zh-Hant');
    expect(response.policy.locale.supported).toEqual(locales);
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith({ where: { userId }, update: {}, create: { userId } });
  });

  it('renders canonical Traditional authentication email copy without a provider', () => {
    for (const purpose of ['email_verification', 'password_reset'] as const) {
      const input = { purpose, actionUrl: 'https://example.invalid/auth-action', brandHomeUrl: 'https://example.invalid',
        expiresAt: new Date('2026-10-06T06:00:00Z') };
      const canonical = renderAuthEmail({ ...input, locale: 'zh-Hant' });
      const regional = renderAuthEmail({ ...input, locale: 'zh-TW' });
      expect(canonical.locale).toBe('zh-TW');
      expect(canonical.html).toContain('lang="zh-Hant"');
      expect(canonical.subject).toBe(regional.subject);
      expect(canonical.text).toBe(regional.text);
    }
  });
});
