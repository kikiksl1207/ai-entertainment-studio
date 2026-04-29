import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserGiftDto {
  @IsUUID()
  recipientUserId!: string;

  @Transform(normalizeString)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  amountLumina!: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(120)
  message?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey?: string;
}
