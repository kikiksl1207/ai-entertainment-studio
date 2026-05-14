import { ConfigService } from '@nestjs/config';
import { AuthEmailDeliveryService } from './auth-email-delivery.service';

type FetchMock = jest.Mock<Promise<{ status: number }>, [string, RequestInit]>;

function serviceWith(fetchMock: FetchMock) {
  global.fetch = fetchMock as unknown as typeof fetch;

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        EMAIL_DELIVERY_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-api-key',
        AUTH_EMAIL_FROM: 'Lumina Stage <no-reply@example.test>',
        FRONTEND_PUBLIC_BASE_URL: 'https://www.lumina-stage.example',
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

describe('AuthEmailDeliveryService Korean templates', () => {
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
    expect(body.text).toContain('안녕하세요. Lumina Stage예요.');
    expect(body.text).toContain('이메일 인증 완료하기');
    expect(body.text).toContain('이 링크는 2026-05-14 14:30 KST까지 열려 있어요.');
    expect(body.text).toContain('— Lumina Stage 팀');
    expect(body.html).toContain('인증 링크는 24시간 동안 열려 있어요.');
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
    expect(body.text).toContain('2026-05-15 00:05 KST');
    expect(body.text).toContain('비밀번호는 바뀌지 않아요.');
    expect(body.text).not.toContain('provider');
    expect(body.text).not.toContain('API');
  });
});
