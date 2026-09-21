import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class StoryAuthoredImportDto {
  @IsUUID() manuscriptVersionId!: string;
  @IsUUID() releaseId!: string;
  @Matches(/^[a-f0-9]{64}$/) expectedReleaseChecksum!: string;
  @Matches(/^[a-f0-9]{64}$/) expectedManuscriptHash!: string;
  // Declared provenance pin only; the original package bytes are not uploaded.
  @Matches(/^[a-f0-9]{64}$/) expectedPackageSha256!: string;
  @Matches(/^[a-f0-9]{64}$/) expectedSourceMapSha256!: string;
  @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @IsIn(['author_main', 'author_sub']) endingKey!: 'author_main' | 'author_sub';
  @IsInt() @Min(0) @Max(19999) endingEvidenceSegment!: number;
  @IsOptional() @IsBoolean() apply?: boolean;
}
