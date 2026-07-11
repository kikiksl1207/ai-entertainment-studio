import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class StoryUploadIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsIn(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])
  originalLocale!: string;

  @IsIn(['original', 'public_domain', 'licensed_ip'])
  sourceClass!: string;

  @ValidateIf(
    (value: StoryUploadIntakeDto) =>
      value.sourceClass === 'licensed_ip' || value.rightsReference !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  rightsReference?: string;

  @IsOptional()
  @IsIn(['final'])
  submissionType = 'final' as const;
}
