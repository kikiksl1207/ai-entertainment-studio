import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';

export class StudioOriginalRouteDto {
  @IsString() @MaxLength(80)
  partKey: string;

  @IsString() @MaxLength(120)
  label: string;
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
