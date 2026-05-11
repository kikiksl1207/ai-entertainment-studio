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
    const title = isVerification
      ? 'Lumina Stage email verification'
      : 'Lumina Stage password reset';
    const actionLabel = isVerification ? 'Verify email' : 'Reset password';
    const urlBase = isVerification
      ? config.verificationUrlBase
      : config.passwordResetUrlBase;
    const actionUrl = this.actionUrl(urlBase, input.actionToken);
    const expiresText = input.expiresAt.toISOString();
    const text = [
      title,
      '',
      `${actionLabel}: ${actionUrl}`,
      `Expires at: ${expiresText}`,
      '',
      'If you did not request this email, you can ignore it.',
    ].join('\n');

    return {
      to: input.to,
      subject: title,
      text,
      html: [
        '<p>Hello from Lumina Stage.</p>',
        `<p><a href="${this.escapeHtml(actionUrl)}">${this.escapeHtml(actionLabel)}</a></p>`,
        `<p>Expires at: ${this.escapeHtml(expiresText)}</p>`,
        '<p>If you did not request this email, you can ignore it.</p>',
      ].join(''),
    };
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
