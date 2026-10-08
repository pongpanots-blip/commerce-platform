import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ClientMeta } from '../application/refresh-token.service';

/** Body of POST …/auth/refresh and …/auth/logout (staff and portal). */
export class RefreshTokenDto {
  @ApiProperty({ description: 'The refreshToken from login or the last refresh' })
  @IsString() @MinLength(1) @MaxLength(512) refreshToken!: string;
}

type MetaRequest = { headers?: Record<string, string | string[] | undefined>; ip?: string };

/** Who asked, stored next to the refresh token for support (never secrets). */
export function clientMeta(req: MetaRequest): ClientMeta {
  const ua = req.headers?.['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null, ip: req.ip ?? null };
}
