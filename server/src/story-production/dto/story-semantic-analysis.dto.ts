import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class RecoverStoryAnalysisProfileDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedSourceContentHash!: string;
}

export class StoryAnalysisPageDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @IsIn(['semantic', 'structural'])
  view?: 'semantic' | 'structural';
}
