import { IsOptional, IsUUID } from 'class-validator';
export class StoryAnalysisPageDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
