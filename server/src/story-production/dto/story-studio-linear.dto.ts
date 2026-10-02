import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export class StudioOriginalRouteDto {
  @IsString() @MaxLength(80)
  partKey: string;

  @IsOptional() @IsString() @MaxLength(120)
  label?: string;
}

export class MaterializeStudioLinearDto {
  @IsUUID()
  manuscriptVersionId: string;

  @Matches(/^[a-f0-9]{64}$/)
  expectedManuscriptHash: string;

  @IsBoolean()
  originalRoutesReviewed: boolean;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000)
  @ValidateNested({ each: true }) @Type(() => StudioOriginalRouteDto)
  originalRoutes: StudioOriginalRouteDto[];
}

function resetConsentBindingPresent(value: ResetStudioChoicesDto) {
  return [value.expectedConsentId, value.expectedConsentRevision, value.expectedBatchHash,
    value.consentChangeConfirmed].some(field => field !== undefined);
}

export class ResetStudioChoicesDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedManuscriptHash: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedApprovedFingerprint: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedProfilePinHash: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedReleaseChecksum: string;

  @Equals(true)
  resetConfirmed: boolean;

  @ValidateIf(resetConsentBindingPresent) @IsUUID()
  expectedConsentId?: string;

  @ValidateIf(resetConsentBindingPresent) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  expectedConsentRevision?: number;

  @ValidateIf(resetConsentBindingPresent) @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedBatchHash?: string;

  @ValidateIf(resetConsentBindingPresent) @Equals(true)
  consentChangeConfirmed?: boolean;
}

export class ReapproveStudioChoicesDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedManuscriptHash: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedApprovedFingerprint: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedProfilePinHash: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedReleaseChecksum: string;

  @IsUUID()
  expectedConsentId: string;

  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  expectedConsentRevision: number;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedBatchHash: string;

  @Equals(true)
  choicesReviewed: boolean;

  @Equals(true)
  currentConsentConfirmed: boolean;
}

export class StudioVisualReferenceIdentityDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedManuscriptHash: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedSourceChecksum: string;
}

export class StudioVisualReferencePageDto extends StudioVisualReferenceIdentityDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2000)
  offset = 0;
}

export class StudioVisualReferenceDetailDto extends StudioVisualReferenceIdentityDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  textOffset = 0;
}
