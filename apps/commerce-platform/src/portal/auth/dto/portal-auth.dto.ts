import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class PortalRegisterDto {
  @ApiProperty({ example: 'dev@example.com' })
  @IsEmail() email: string;

  @ApiProperty({ example: 'hunter2pass', minLength: 8 })
  @IsString() @MinLength(8) password: string;
}

export class PortalLoginDto {
  @ApiProperty({ example: 'dev@example.com' })
  @IsEmail() email: string;

  @ApiProperty({ example: 'hunter2pass' })
  @IsString() password: string;
}
