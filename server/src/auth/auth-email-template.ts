export type AuthEmailPurpose = 'email_verification' | 'password_reset';

export type AuthEmailTemplateInput = {
  purpose: AuthEmailPurpose;
  actionUrl: string;
  expiresAt: Date;
  locale?: string;
  brandHomeUrl: string;
};

type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP' | 'zh-CN' | 'zh-TW';

type AuthEmailCopy = {
  htmlLang: string;
  subject: string;
  preheader: string;
  kicker: string;
  title: string;
  intro: string;
  helper: string;
  actionLabel: string;
  expiryLabel: string;
  fallback: string;
  ignoreLabel: string;
  ignore: string;
  footer: string;
};

const EMAIL_COPY: Record<SupportedLocale, Record<AuthEmailPurpose, AuthEmailCopy>> = {
  'ko-KR': {
    email_verification: {
      htmlLang: 'ko',
      subject: '이메일 주소를 한 번만 확인해 주세요',
      preheader: '이메일 인증을 완료하고 Lumina Stage를 시작해 보세요.',
      kicker: 'ACCOUNT CHECK',
      title: '이메일 주소를 확인해 주세요',
      intro: 'Lumina Stage 가입이 거의 끝났어요.',
      helper: '아래 버튼을 누르면 이메일 인증이 완료되고 바로 서비스를 시작할 수 있어요.',
      actionLabel: '이메일 인증 완료하기',
      expiryLabel: '인증 가능 시간',
      fallback: '버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.',
      ignoreLabel: '내가 가입하지 않았다면',
      ignore: '이 메일을 닫아도 괜찮아요. 계정에는 아무 변경도 생기지 않아요.',
      footer: 'Lumina Stage 계정 안내 메일입니다.',
    },
    password_reset: {
      htmlLang: 'ko',
      subject: '비밀번호 재설정 링크가 도착했어요',
      preheader: '안전하게 새 비밀번호를 설정해 주세요.',
      kicker: 'SECURITY',
      title: '새 비밀번호를 설정해 주세요',
      intro: '비밀번호 재설정 요청을 받았어요.',
      helper: '아래 버튼을 누르면 안전하게 새 비밀번호를 만들 수 있어요.',
      actionLabel: '비밀번호 재설정하기',
      expiryLabel: '링크 만료 시간',
      fallback: '버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.',
      ignoreLabel: '내가 요청하지 않았다면',
      ignore: '이 메일을 닫아도 괜찮아요. 기존 비밀번호는 그대로 유지돼요.',
      footer: 'Lumina Stage 계정 보안 안내 메일입니다.',
    },
  },
  'en-US': {
    email_verification: {
      htmlLang: 'en',
      subject: 'Verify your Lumina Stage email',
      preheader: 'Verify your email and step into Lumina Stage.',
      kicker: 'ACCOUNT CHECK',
      title: 'Verify your email address',
      intro: 'You are almost ready to join Lumina Stage.',
      helper: 'Select the button below to verify your email and finish setting up your account.',
      actionLabel: 'Verify email',
      expiryLabel: 'Link available until',
      fallback: 'If the button does not open, paste this address into your browser.',
      ignoreLabel: 'Did not create an account?',
      ignore: 'You can safely ignore this email. No changes will be made to an account.',
      footer: 'This is an account notice from Lumina Stage.',
    },
    password_reset: {
      htmlLang: 'en',
      subject: 'Reset your Lumina Stage password',
      preheader: 'Create a new password securely.',
      kicker: 'SECURITY',
      title: 'Set a new password',
      intro: 'We received a request to reset your password.',
      helper: 'Select the button below to create a new password securely.',
      actionLabel: 'Reset password',
      expiryLabel: 'Link expires',
      fallback: 'If the button does not open, paste this address into your browser.',
      ignoreLabel: 'Did not request this?',
      ignore: 'You can safely ignore this email. Your current password will not change.',
      footer: 'This is a security notice from Lumina Stage.',
    },
  },
  'ja-JP': {
    email_verification: {
      htmlLang: 'ja',
      subject: 'Lumina Stageのメールアドレスを確認してください',
      preheader: 'メール認証を完了してLumina Stageを始めましょう。',
      kicker: 'ACCOUNT CHECK',
      title: 'メールアドレスを確認してください',
      intro: 'Lumina Stageの登録完了まであと少しです。',
      helper: '下のボタンを押すとメール認証が完了し、すぐにサービスを利用できます。',
      actionLabel: 'メール認証を完了する',
      expiryLabel: '認証リンクの有効期限',
      fallback: 'ボタンが開かない場合は、下のURLをブラウザに貼り付けてください。',
      ignoreLabel: '登録した覚えがない場合',
      ignore: 'このメールは無視してかまいません。アカウントに変更はありません。',
      footer: 'Lumina Stageからのアカウント案内です。',
    },
    password_reset: {
      htmlLang: 'ja',
      subject: 'Lumina Stageのパスワードを再設定してください',
      preheader: '新しいパスワードを安全に設定してください。',
      kicker: 'SECURITY',
      title: '新しいパスワードを設定してください',
      intro: 'パスワード再設定のリクエストを受け付けました。',
      helper: '下のボタンから新しいパスワードを安全に設定できます。',
      actionLabel: 'パスワードを再設定する',
      expiryLabel: 'リンクの有効期限',
      fallback: 'ボタンが開かない場合は、下のURLをブラウザに貼り付けてください。',
      ignoreLabel: 'リクエストしていない場合',
      ignore: 'このメールは無視してかまいません。現在のパスワードは変更されません。',
      footer: 'Lumina Stageからのセキュリティ案内です。',
    },
  },
  'zh-CN': {
    email_verification: {
      htmlLang: 'zh-CN',
      subject: '请验证您的 Lumina Stage 邮箱',
      preheader: '完成邮箱验证，开始使用 Lumina Stage。',
      kicker: 'ACCOUNT CHECK',
      title: '请验证您的邮箱地址',
      intro: '您的 Lumina Stage 注册即将完成。',
      helper: '点击下方按钮即可完成邮箱验证并开始使用服务。',
      actionLabel: '完成邮箱验证',
      expiryLabel: '验证链接有效期至',
      fallback: '如果按钮无法打开，请将下方地址粘贴到浏览器中。',
      ignoreLabel: '如果您没有注册',
      ignore: '您可以忽略此邮件，账户不会发生任何更改。',
      footer: '这是来自 Lumina Stage 的账户通知。',
    },
    password_reset: {
      htmlLang: 'zh-CN',
      subject: '重置您的 Lumina Stage 密码',
      preheader: '请安全设置新密码。',
      kicker: 'SECURITY',
      title: '请设置新密码',
      intro: '我们收到了密码重置请求。',
      helper: '点击下方按钮即可安全设置新密码。',
      actionLabel: '重置密码',
      expiryLabel: '链接有效期至',
      fallback: '如果按钮无法打开，请将下方地址粘贴到浏览器中。',
      ignoreLabel: '如果并非您本人请求',
      ignore: '您可以忽略此邮件，当前密码不会被更改。',
      footer: '这是来自 Lumina Stage 的账户安全通知。',
    },
  },
  'zh-TW': {
    email_verification: {
      htmlLang: 'zh-Hant',
      subject: '請驗證您的 Lumina Stage 電子郵件',
      preheader: '完成電子郵件驗證，開始使用 Lumina Stage。',
      kicker: 'ACCOUNT CHECK',
      title: '請驗證您的電子郵件地址',
      intro: '您的 Lumina Stage 註冊即將完成。',
      helper: '點選下方按鈕即可完成驗證並開始使用服務。',
      actionLabel: '完成電子郵件驗證',
      expiryLabel: '驗證連結有效期限',
      fallback: '如果按鈕無法開啟，請將下方網址貼到瀏覽器中。',
      ignoreLabel: '如果您沒有註冊',
      ignore: '您可以忽略此郵件，帳戶不會有任何變更。',
      footer: '這是來自 Lumina Stage 的帳戶通知。',
    },
    password_reset: {
      htmlLang: 'zh-Hant',
      subject: '重設您的 Lumina Stage 密碼',
      preheader: '請安全地設定新密碼。',
      kicker: 'SECURITY',
      title: '請設定新密碼',
      intro: '我們收到了密碼重設要求。',
      helper: '點選下方按鈕即可安全地設定新密碼。',
      actionLabel: '重設密碼',
      expiryLabel: '連結有效期限',
      fallback: '如果按鈕無法開啟，請將下方網址貼到瀏覽器中。',
      ignoreLabel: '如果不是您本人要求',
      ignore: '您可以忽略此郵件，目前的密碼不會變更。',
      footer: '這是來自 Lumina Stage 的帳戶安全通知。',
    },
  },
};

export function renderAuthEmail(input: AuthEmailTemplateInput) {
  const locale = normalizeLocale(input.locale);
  const copy = EMAIL_COPY[locale][input.purpose];
  const actionUrl = escapeHtml(input.actionUrl);
  const brandHomeUrl = escapeHtml(input.brandHomeUrl);
  const expires = escapeHtml(formatExpiry(input.expiresAt, locale));

  const text = [
    'Lumina Stage',
    '',
    copy.title,
    copy.intro,
    copy.helper,
    '',
    `[${copy.actionLabel}]`,
    input.actionUrl,
    '',
    `${copy.expiryLabel}: ${formatExpiry(input.expiresAt, locale)}`,
    '',
    copy.fallback,
    input.actionUrl,
    '',
    `${copy.ignoreLabel}: ${copy.ignore}`,
    '',
    copy.footer,
  ].join('\n');

  const html = `<!doctype html>
<html lang="${copy.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(copy.subject)}</title>
  <style>
    @media only screen and (max-width: 520px) {
      .page-pad { padding: 12px !important; }
      .content-pad { padding: 28px 22px !important; }
      .brand-pad { padding: 20px 22px !important; }
      .action-cell, .action-link { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      .email-title { font-size: 27px !important; line-height: 1.28 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;color:#17181b;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f3f5;">
    <tr>
      <td class="page-pad" align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3e5e8;border-radius:8px;overflow:hidden;">
          <tr>
            <td class="brand-pad" style="padding:22px 32px;background:#111216;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:42px;height:42px;background:#f43f8f;border-radius:6px;text-align:center;vertical-align:middle;color:#ffffff;font-size:18px;font-weight:800;line-height:42px;">LS</td>
                  <td style="padding-left:13px;vertical-align:middle;">
                    <a href="${brandHomeUrl}" style="color:#ffffff;text-decoration:none;font-size:18px;font-weight:800;letter-spacing:0;">Lumina Stage</a>
                    <div style="margin-top:3px;color:#afb3bc;font-size:11px;line-height:1.3;letter-spacing:0;">ENTERTAINMENT, REIMAGINED</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="content-pad" style="padding:38px 42px 34px;">
              <div style="margin:0 0 12px;color:#d91f75;font-size:12px;font-weight:800;line-height:1.4;letter-spacing:0;">${escapeHtml(copy.kicker)}</div>
              <h1 class="email-title" style="margin:0;color:#17181b;font-size:32px;font-weight:800;line-height:1.3;letter-spacing:0;">${escapeHtml(copy.title)}</h1>
              <p style="margin:20px 0 0;color:#34373d;font-size:16px;font-weight:700;line-height:1.7;">${escapeHtml(copy.intro)}</p>
              <p style="margin:7px 0 0;color:#62666f;font-size:15px;line-height:1.75;">${escapeHtml(copy.helper)}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 20px;">
                <tr>
                  <td class="action-cell" align="center" bgcolor="#17181b" style="border-radius:6px;background:#17181b;">
                    <a class="action-link" href="${actionUrl}" style="display:inline-block;padding:15px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;line-height:1.3;">${escapeHtml(copy.actionLabel)}</a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;background:#fff3f8;border-left:4px solid #f43f8f;border-radius:4px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <div style="color:#8f1750;font-size:12px;font-weight:800;line-height:1.4;">${escapeHtml(copy.expiryLabel)}</div>
                    <div style="margin-top:4px;color:#34373d;font-size:14px;font-weight:700;line-height:1.5;">${expires}</div>
                  </td>
                </tr>
              </table>

              <div style="padding-top:24px;border-top:1px solid #eceef0;">
                <p style="margin:0;color:#747982;font-size:12px;line-height:1.65;">${escapeHtml(copy.fallback)}</p>
                <p style="margin:8px 0 0;padding:11px 12px;background:#f7f8f9;border:1px solid #e7e9ec;border-radius:4px;font-size:11px;line-height:1.6;word-break:break-all;">
                  <a href="${actionUrl}" style="color:#50555e;text-decoration:none;word-break:break-all;">${actionUrl}</a>
                </p>
              </div>

              <div style="margin-top:22px;padding:16px;background:#f7f8f9;border-radius:6px;">
                <div style="color:#34373d;font-size:13px;font-weight:800;line-height:1.5;">${escapeHtml(copy.ignoreLabel)}</div>
                <div style="margin-top:4px;color:#6a6f78;font-size:12px;line-height:1.65;">${escapeHtml(copy.ignore)}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f7f8f9;border-top:1px solid #eceef0;text-align:center;color:#838892;font-size:11px;line-height:1.6;">
              ${escapeHtml(copy.footer)}<br>
              <a href="${brandHomeUrl}" style="color:#50555e;text-decoration:none;font-weight:700;">www.lumina-stage.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: copy.subject, preheader: copy.preheader, text, html, locale };
}

function normalizeLocale(locale?: string): SupportedLocale {
  const normalized = locale?.trim().toLowerCase();

  if (!normalized || normalized.startsWith('ko')) return 'ko-KR';
  if (normalized.startsWith('ja')) return 'ja-JP';
  if (normalized.startsWith('en')) return 'en-US';
  if (
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-mo') ||
    normalized.includes('hant')
  ) {
    return 'zh-TW';
  }
  if (normalized.startsWith('zh')) return 'zh-CN';

  return 'ko-KR';
}

function formatExpiry(date: Date, locale: SupportedLocale) {
  return `${new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date)} KST`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
