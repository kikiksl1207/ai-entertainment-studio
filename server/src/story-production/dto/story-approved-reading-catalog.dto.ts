import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';
import { STORY_LOCALES, type StoryLocale } from '../story-production.policy';

export const APPROVED_READING_CATALOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const APPROVED_READING_CATALOG_LIMITS = { page: 20, title: 256, responseBytes: 8192 } as const;

function strictLimit(value: unknown): unknown {
  return typeof value === 'string' && /^(?:[1-9]|1[0-9]|20)$/.test(value) ? Number(value) : value;
}

export class StoryApprovedReadingCatalogQueryDto {
  @IsIn(STORY_LOCALES)
  locale: StoryLocale = 'ko';

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(APPROVED_READING_CATALOG_UUID)
  cursor?: string;

  @Transform(({ value }) => strictLimit(value))
  @IsInt()
  @Min(1)
  @Max(APPROVED_READING_CATALOG_LIMITS.page)
  limit = 12;
}

export function parseApprovedReadingCatalogQuery(query: unknown): { locale: StoryLocale; limit: number; cursor?: string } {
  const invalid = () => new BadRequestException({ code: 'STORY_APPROVED_READING_CATALOG_INPUT_INVALID' });
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['locale', 'limit', 'cursor'].includes(key))) throw invalid();
  const input = query as Record<string, unknown>;
  const locale = input.locale === undefined ? 'ko' : input.locale;
  const limit = input.limit === undefined ? 12 : strictLimit(input.limit);
  const cursor = input.cursor;
  if (typeof locale !== 'string' || !STORY_LOCALES.includes(locale as StoryLocale)
    || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > APPROVED_READING_CATALOG_LIMITS.page
    || (cursor !== undefined && (typeof cursor !== 'string' || !APPROVED_READING_CATALOG_UUID.test(cursor)))) throw invalid();
  return { locale: locale as StoryLocale, limit, ...(cursor === undefined ? {} : { cursor: (cursor as string).toLowerCase() }) };
}
