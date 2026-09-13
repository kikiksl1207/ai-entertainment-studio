import { HttpException } from '@nestjs/common';

export const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
export type Locale = (typeof LOCALES)[number];
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_DURATION_MS = 20 * 60 * 1000;
export type Cue = { startMs: number; endMs: number; text: string };
export type Subtitle = { locale: Locale; cues: Cue[] };
export type ExpectedMedia = {
  sha256: string;
  sizeBytes: number;
  mimeType: 'video/mp4';
  declaredDurationMs: number;
  audioLocale: 'ko';
};
export type VerifiedMedia = { sha256: string; sizeBytes: number; mimeType: 'video/mp4'; durationMs: number };
export type Upload = {
  id: string;
  ownerId: string;
  workId: string;
  versionId: string;
  intentKey: string;
  expected: ExpectedMedia;
  status: 'pending_upload' | 'uploaded' | 'confirmed';
  expiresAt: Date;
  verified: VerifiedMedia | null;
  subtitles: Subtitle[] | null;
  confirmationHash: string | null;
};

const MESSAGES = {
  INVALID: ['입력 형식이 올바르지 않습니다.', 'Invalid input.', '入力形式が正しくありません。', '输入格式无效。', '輸入格式無效。'],
  NOT_FOUND: ['접근 가능한 대상이 없습니다.', 'Accessible media not found.', 'アクセス可能な対象がありません。', '找不到可访问的媒体。', '找不到可存取的媒體。'],
  CONFLICT: ['등록된 원본 또는 요청과 충돌합니다.', 'The request conflicts with the registered original.', '登録済みの原本またはリクエストと競合します。', '请求与已登记的原始文件冲突。', '請求與已登記的原始檔案衝突。'],
  EXPIRED: ['요청이 만료되었습니다.', 'The request has expired.', 'リクエストの有効期限が切れました。', '请求已过期。', '請求已過期。'],
  NOT_READY: ['영상 검증이 완료되지 않았습니다.', 'Media verification is incomplete.', '動画の検証が完了していません。', '视频验证尚未完成。', '影片驗證尚未完成。'],
  STORAGE_UNAVAILABLE: ['비공개 실물 저장소를 확인할 수 없습니다.', 'Private object storage is unavailable.', '非公開の実体ストレージを確認できません。', '无法确认私有对象存储。', '無法確認私有物件儲存。'],
  PROBE_UNAVAILABLE: ['서버 영상 검증기를 사용할 수 없습니다.', 'The server media verifier is unavailable.', 'サーバーの動画検証機能を利用できません。', '服务器媒体验证器不可用。', '伺服器媒體驗證器無法使用。'],
  PERSISTENCE_UNAVAILABLE: ['영상 등록 저장소를 사용할 수 없습니다.', 'Media registration storage is unavailable.', '動画登録ストレージを利用できません。', '媒体登记存储不可用。', '媒體登記儲存無法使用。'],
  OBJECT_MISMATCH: ['실제 영상과 등록 정보가 일치하지 않습니다.', 'The media does not match its registration.', '実際の動画と登録情報が一致しません。', '实际媒体与登记信息不符。', '實際媒體與登記資訊不符。'],
  TOKEN_INVALID: ['재생 권한이 유효하지 않습니다.', 'The playback authorization is invalid.', '再生権限が無効です。', '播放授权无效。', '播放授權無效。'],
  RANGE_INVALID: ['요청한 영상 범위를 제공할 수 없습니다.', 'The requested byte range is unavailable.', '指定された動画範囲を提供できません。', '无法提供请求的视频范围。', '無法提供請求的影片範圍。'],
} as const;
export type ErrorCode = keyof typeof MESSAGES;
export function fail(code: ErrorCode): never {
  const status = code === 'RANGE_INVALID' ? 416 : code === 'NOT_FOUND' ? 404 : code === 'EXPIRED' ? 410 : code === 'TOKEN_INVALID' ? 403
    : code.endsWith('UNAVAILABLE') ? 503 : code === 'CONFLICT' || code === 'NOT_READY' ? 409 : 400;
  throw new HttpException({ code: `OTT_${code}`, messageKey: `ottMedia.${code}`, message: MESSAGES[code][0],
    details: { messages: Object.fromEntries(LOCALES.map((locale, index) => [locale, MESSAGES[code][index]])) } }, status);
}
export function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowed.includes(key))) fail('INVALID');
  return result;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail('INVALID');
  return value;
}
export function intentKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) fail('INVALID');
  return value;
}
export function expectedMedia(value: unknown): ExpectedMedia {
  const v = object(value, ['sha256', 'sizeBytes', 'mimeType', 'declaredDurationMs', 'audioLocale']);
  if (typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256) || v.mimeType !== 'video/mp4' || v.audioLocale !== 'ko'
    || !Number.isSafeInteger(v.sizeBytes) || Number(v.sizeBytes) < 16 || Number(v.sizeBytes) > MAX_BYTES
    || !Number.isSafeInteger(v.declaredDurationMs) || Number(v.declaredDurationMs) <= 0 || Number(v.declaredDurationMs) > MAX_DURATION_MS) fail('INVALID');
  return { sha256: v.sha256, sizeBytes: Number(v.sizeBytes), mimeType: 'video/mp4', declaredDurationMs: Number(v.declaredDurationMs), audioLocale: 'ko' };
}
export function subtitles(value: unknown, durationMs: number): Subtitle[] {
  if (!Array.isArray(value) || value.length > 5) fail('INVALID');
  const seen = new Set<string>();
  let totalText = 0;
  const result = value.map((item) => {
    const v = object(item, ['locale', 'cues']);
    if (!LOCALES.includes(v.locale as Locale) || seen.has(String(v.locale)) || !Array.isArray(v.cues) || !v.cues.length || v.cues.length > 2000) fail('INVALID');
    seen.add(String(v.locale));
    let end = 0;
    const cues = v.cues.map((item) => {
      const c = object(item, ['startMs', 'endMs', 'text']);
      if (!Number.isSafeInteger(c.startMs) || !Number.isSafeInteger(c.endMs) || Number(c.startMs) < end
        || Number(c.endMs) <= Number(c.startMs) || Number(c.endMs) > durationMs
        || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(c.text)) fail('INVALID');
      totalText += c.text.length;
      if (totalText > 100_000) fail('INVALID');
      end = Number(c.endMs);
      return { startMs: Number(c.startMs), endMs: end, text: c.text };
    });
    return { locale: v.locale as Locale, cues };
  });
  return result.sort((a, b) => LOCALES.indexOf(a.locale) - LOCALES.indexOf(b.locale));
}
