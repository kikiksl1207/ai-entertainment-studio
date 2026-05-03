import { Injectable } from '@nestjs/common';

type ModerationMatch = {
  type: string;
  severity: 'block' | 'watch';
};

const BLOCK_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'email', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { type: 'phone_number', regex: /(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-.\s.]?\d{4}/ },
  { type: 'external_payment', regex: /(bank account|wire transfer|paypal|venmo|cashapp|deposit|계좌|입금|송금|후원계좌)/i },
  { type: 'external_contact', regex: /(openchat|telegram|discord|line|kakaotalk|instagram|dm me|오픈채팅|카카오톡|카톡|텔레그램|라인|디스코드|인스타)/i },
];

const WATCH_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'offline_meeting', regex: /(meet offline|meet in person|private meeting|hotel|address|오프라인|직접 만나|호텔|주소)/i },
  { type: 'adult_boundary', regex: /(adult only|explicit|nsfw|sexual)/i },
  { type: 'settlement_risk', regex: /(refund outside|direct sponsor|cash sponsor)/i },
];

@Injectable()
export class ModerationService {
  preview(input: { surface?: string; body: string }) {
    const body = input.body.trim();
    const matches = this.findMatches(body);
    const hasBlock = matches.some((match) => match.severity === 'block');
    const hasWatch = matches.some((match) => match.severity === 'watch');
    const decision = hasBlock ? 'block' : hasWatch ? 'watch' : 'allow';

    return {
      decision,
      riskLevel: hasBlock ? 'high' : hasWatch ? 'medium' : 'low',
      matchedTypes: matches.map((match) => match.type),
      userMessage:
        decision === 'allow'
          ? null
          : decision === 'block'
            ? 'This message contains content that cannot be posted or sent.'
            : 'This message may need additional review before publishing.',
      surface: input.surface ?? 'generic',
      policy: {
        mode: 'keyword_preview_mvp',
        hardBlockTypes: BLOCK_PATTERNS.map((pattern) => pattern.type),
        reviewTypes: WATCH_PATTERNS.map((pattern) => pattern.type),
        note: 'Preview only. Persisted moderation queues can be added with a later schema migration.',
      },
    };
  }

  private findMatches(body: string): ModerationMatch[] {
    const matches: ModerationMatch[] = [];

    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.regex.test(body)) {
        matches.push({ type: pattern.type, severity: 'block' });
      }
    }

    for (const pattern of WATCH_PATTERNS) {
      if (pattern.regex.test(body)) {
        matches.push({ type: pattern.type, severity: 'watch' });
      }
    }

    return matches;
  }
}
