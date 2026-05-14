import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type AuthEmailPurpose = 'email_verification' | 'password_reset';
type AuthEmailProvider = 'resend' | 'sendgrid';

export type AuthEmailDeliveryResult = {
  status: 'not_configured' | 'accepted';
  channel: 'email';
  provider?: AuthEmailProvider;
};

type ActionEmailInput = {
  to: string;
  purpose: AuthEmailPurpose;
  actionToken: string;
  expiresAt: Date;
};

type ProviderConfig = {
  provider: AuthEmailProvider;
  apiKey: string;
  from: string;
  replyTo?: string;
  verificationUrlBase: string;
  passwordResetUrlBase: string;
};
type ActionEmailCopy = {
  subject: string;
  preheader: string;
  intro: string;
  helper?: string;
  actionLabel: string;
  fallback: string;
  expires: string;
  ignore: string;
};

@Injectable()
export class AuthEmailDeliveryService {
  constructor(private readonly configService: ConfigService) {}

  requestStatus(): AuthEmailDeliveryResult {
    const config = this.providerConfig();

    if (!config) {
      return { status: 'not_configured', channel: 'email' };
    }

    return {
      status: 'accepted',
      channel: 'email',
      provider: config.provider,
    };
  }

  async sendActionEmail(input: ActionEmailInput): Promise<AuthEmailDeliveryResult> {
    const config = this.providerConfig();

    if (!config) {
      return { status: 'not_configured', channel: 'email' };
    }

    const message = this.actionEmailMessage(config, input);

    if (config.provider === 'resend') {
      await this.sendWithResend(config, message);
    } else {
      await this.sendWithSendGrid(config, message);
    }

    return {
      status: 'accepted',
      channel: 'email',
      provider: config.provider,
    };
  }

  private providerConfig(): ProviderConfig | null {
    const provider = this.provider();

    if (!provider) {
      return null;
    }

    const apiKey =
      provider === 'resend'
        ? this.nonEmpty('RESEND_API_KEY')
        : this.nonEmpty('SENDGRID_API_KEY');
    const from = this.nonEmpty('AUTH_EMAIL_FROM') ?? this.nonEmpty('EMAIL_FROM');
    const replyTo = this.nonEmpty('AUTH_EMAIL_REPLY_TO') ?? this.nonEmpty('EMAIL_REPLY_TO');
    const verificationUrlBase = this.actionUrlBase(
      'AUTH_EMAIL_VERIFICATION_URL_BASE',
      'EMAIL_VERIFICATION_URL_BASE',
      '/verify-email',
    );
    const passwordResetUrlBase = this.actionUrlBase(
      'AUTH_PASSWORD_RESET_URL_BASE',
      'PASSWORD_RESET_URL_BASE',
      '/reset-password',
    );

    if (!apiKey || !from || !verificationUrlBase || !passwordResetUrlBase) {
      return null;
    }

    return {
      provider,
      apiKey,
      from,
      replyTo,
      verificationUrlBase,
      passwordResetUrlBase,
    };
  }

  private provider(): AuthEmailProvider | null {
    const provider = (
      this.nonEmpty('EMAIL_DELIVERY_PROVIDER') ?? this.nonEmpty('AUTH_EMAIL_PROVIDER')
    )?.toLowerCase();

    return provider === 'resend' || provider === 'sendgrid' ? provider : null;
  }

  private actionUrlBase(primaryKey: string, fallbackKey: string, defaultPath: string) {
    const explicit = this.nonEmpty(primaryKey) ?? this.nonEmpty(fallbackKey);

    if (explicit) {
      return explicit;
    }

    const frontendBase =
      this.nonEmpty('FRONTEND_PUBLIC_BASE_URL') ?? this.nonEmpty('WEB_PUBLIC_BASE_URL');

    if (!frontendBase) {
      return null;
    }

    return this.joinUrl(frontendBase, defaultPath);
  }

  private actionEmailMessage(config: ProviderConfig, input: ActionEmailInput) {
    const isVerification = input.purpose === 'email_verification';
    const urlBase = isVerification
      ? config.verificationUrlBase
      : config.passwordResetUrlBase;
    const actionUrl = this.actionUrl(urlBase, input.actionToken);
    const copy = this.actionEmailCopy(input.purpose, this.formatKstDateTime(input.expiresAt));
    const text = [
      '안녕하세요. Lumina Stage예요.',
      '',
      copy.intro,
      copy.helper,
      '',
      `[${copy.actionLabel}]`,
      '',
      copy.fallback,
      actionUrl,
      '',
      copy.expires,
      copy.ignore,
      '',
      '— Lumina Stage 팀',
    ].filter((line) => line !== undefined).join('\n');
    const escapedActionUrl = this.escapeHtml(actionUrl);

    return {
      to: input.to,
      subject: copy.subject,
      text,
      html: [
        `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${this.escapeHtml(copy.preheader)}</div>`,
        '<p>안녕하세요. Lumina Stage예요.</p>',
        `<p>${this.escapeHtml(copy.intro)}</p>`,
        copy.helper ? `<p>${this.escapeHtml(copy.helper)}</p>` : '',
        `<p><a href="${escapedActionUrl}">${this.escapeHtml(copy.actionLabel)}</a></p>`,
        `<p>${this.escapeHtml(copy.fallback)}<br><a href="${escapedActionUrl}">${escapedActionUrl}</a></p>`,
        `<p>${this.escapeHtml(copy.expires)} ${this.escapeHtml(copy.ignore)}</p>`,
        '<p>— Lumina Stage 팀</p>',
      ].join(''),
    };
  }

  private actionEmailCopy(
    purpose: AuthEmailPurpose,
    expiresHuman: string,
  ): ActionEmailCopy {
    if (purpose === 'email_verification') {
      return {
        subject: '이메일 주소를 한 번만 확인해 주세요',
        preheader: '인증 링크는 24시간 동안 열려 있어요.',
        intro:
          '회원가입을 마치기 전에, 이 메일 주소가 본인 것이 맞는지 한 번만 확인하고 싶어요.',
        helper: '아래 버튼을 누르면 인증이 끝나요.',
        actionLabel: '이메일 인증 완료하기',
        fallback:
          '버튼이 안 돌아갈 때는 아래 주소를 브라우저에 직접 붙여 넣어 주세요.',
        expires: `이 링크는 ${expiresHuman}까지 열려 있어요.`,
        ignore:
          '직접 가입한 적이 없다면 이 메일은 그냥 닫아주세요. 따로 처리할 것은 없어요.',
      };
    }

    return {
      subject: '비밀번호 재설정 링크가 도착했어요',
      preheader: '재설정 링크는 1시간 동안 열려 있어요.',
      intro:
        '비밀번호 재설정을 요청한 분이 맞다면 아래 버튼에서 새 비밀번호를 설정해 주세요.',
      actionLabel: '비밀번호 재설정하기',
      fallback:
        '버튼이 안 돌아갈 때는 아래 주소를 브라우저에 직접 붙여 넣어 주세요.',
      expires: `이 링크는 ${expiresHuman}까지 열려 있어요. 그 이후에는 보안을 위해 다시 요청해 주세요.`,
      ignore:
        '본인이 요청하지 않은 메일이라면 그냥 닫아도 괜찮아요. 비밀번호는 바뀌지 않아요.',
    };
  }

  private formatKstDateTime(date: Date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const year = kst.getUTCFullYear();
    const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    const hours = String(kst.getUTCHours()).padStart(2, '0');
    const minutes = String(kst.getUTCMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes} KST`;
  }

  private actionUrl(urlBase: string, token: string) {
    const url = new URL(urlBase);
    url.searchParams.set('token', token);

    return url.toString();
  }

  private async sendWithResend(
    config: ProviderConfig,
    message: ReturnType<AuthEmailDeliveryService['actionEmailMessage']>,
  ) {
    const body: Record<string, unknown> = {
      from: config.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    };

    if (config.replyTo) {
      body.reply_to = config.replyTo;
    }

    await this.postProvider('resend', 'https://api.resend.com/emails', config.apiKey, body, 200);
  }

  private async sendWithSendGrid(
    config: ProviderConfig,
    message: ReturnType<AuthEmailDeliveryService['actionEmailMessage']>,
  ) {
    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: config.from },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    };

    if (config.replyTo) {
      body.reply_to = { email: config.replyTo };
    }

    await this.postProvider('sendgrid', 'https://api.sendgrid.com/v3/mail/send', config.apiKey, body, 202);
  }

  private async postProvider(
    provider: AuthEmailProvider,
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
    expectedStatus: number,
  ) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw this.deliveryFailed(provider);
    }

    if (response.status !== expectedStatus) {
      throw this.deliveryFailed(provider, response.status);
    }
  }

  private deliveryFailed(provider: AuthEmailProvider, statusCode?: number) {
    return new ServiceUnavailableException({
      code: 'AUTH_EMAIL_DELIVERY_FAILED',
      message: 'Email delivery failed',
      messageKey: 'auth.email.delivery_failed',
      details: {
        provider,
        statusCode: statusCode ?? null,
      },
    });
  }

  private nonEmpty(key: string) {
    const value = this.configService.get<string>(key)?.trim();

    return value || undefined;
  }

  private joinUrl(base: string, path: string) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${normalizedBase}${normalizedPath}`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
