import { ConfigService } from '@nestjs/config';
import { AuthEmailDeliveryService } from './auth-email-delivery.service';

type FetchMock = jest.Mock<Promise<{ status: number }>, [string, RequestInit]>;

function serviceWith(fetchMock: FetchMock, overrides: Record<string, string> = {}) {
  global.fetch = fetchMock as unknown as typeof fetch;

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        EMAIL_DELIVERY_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-api-key',
        AUTH_EMAIL_FROM: 'Lumina Stage <no-reply@example.test>',
        FRONTEND_PUBLIC_BASE_URL: 'https://www.lumina-stage.example',
        ...overrides,
      };

      return values[key];
    }),
  };

  return new AuthEmailDeliveryService(config as unknown as ConfigService);
}

function sentBody(fetchMock: FetchMock) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
    subject: string;
    text: string;
    html: string;
  };
}

describe('AuthEmailDeliveryService branded templates', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends email verification copy with a human-readable KST expiry', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue({ status: 200 });
    const service = serviceWith(fetchMock);

    await service.sendActionEmail({
      to: 'fan@example.com',
      purpose: 'email_verification',
      actionToken: 'test-token',
      expiresAt: new Date('2026-05-14T05:30:00.000Z'),
    });

    const body = sentBody(fetchMock);

    expect(body.subject).toBe('이메일 주소를 한 번만 확인해 주세요');
    expect(body.text).toContain('이메일 주소를 확인해 주세요');
    expect(body.text).toContain('이메일 인증 완료하기');
    expect(body.text).toContain('KST');
    expect(body.html).toContain('ENTERTAINMENT, REIMAGINED');
    expect(body.html).toContain('@media only screen and (max-width: 520px)');
    expect(body.html).toContain('background:#fff3f8');
    expect(body.html).toContain('word-break:break-all');
    expect(body.html).toContain('이메일 인증을 완료하고 Lumina Stage를 시작해 보세요.');
  });

  it('sends password reset copy without raw technical wording in body text', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue({ status: 200 });
    const service = serviceWith(fetchMock);

    await service.sendActionEmail({
      to: 'fan@example.com',
      purpose: 'password_reset',
      actionToken: 'test-token',
      expiresAt: new Date('2026-05-14T15:05:00.000Z'),
    });

    const body = sentBody(fetchMock);

    expect(body.subject).toBe('비밀번호 재설정 링크가 도착했어요');
    expect(body.text).toContain('비밀번호 재설정하기');
    expect(body.text).toContain('KST');
    expect(body.text).toContain('기존 비밀번호는 그대로 유지돼요.');
    expect(body.text).not.toContain('provider');
    expect(body.text).not.toContain('API');
    expect(body.html).toContain('새 비밀번호를 설정해 주세요');
    expect(body.html).toContain('class="action-link"');
  });

  it.each([
    ['en-US', 'Reset password', 'lang="en"'],
    ['ja-JP', 'パスワードを再設定する', 'lang="ja"'],
    ['zh-CN', '重置密码', 'lang="zh-CN"'],
    ['zh-TW', '重設密碼', 'lang="zh-Hant"'],
  ])('uses the account locale for %s', async (locale, actionLabel, htmlLang) => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue({ status: 200 });
    const service = serviceWith(fetchMock);

    await service.sendActionEmail({
      to: 'fan@example.com',
      purpose: 'password_reset',
      actionToken: 'test-token',
      expiresAt: new Date('2026-05-14T15:05:00.000Z'),
      locale,
    });

    const body = sentBody(fetchMock);

    expect(body.text).toContain(actionLabel);
    expect(body.html).toContain(htmlLang);
  });

  it('fails closed when an explicit public action URL is invalid', () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue({ status: 200 });
    const service = serviceWith(fetchMock, {
      FRONTEND_PUBLIC_BASE_URL: '',
      AUTH_EMAIL_VERIFICATION_URL_BASE: 'not-a-url',
      AUTH_PASSWORD_RESET_URL_BASE: 'https://www.lumina-stage.example/reset-password',
    });

    expect(service.requestStatus()).toEqual({
      status: 'not_configured',
      channel: 'email',
    });
  });
});
