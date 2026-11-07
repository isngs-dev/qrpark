import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { CurrentActor, Public, Roles, type Actor } from './auth.guard';

/** Copied from eparking backend/src/auth/auth.controller.ts; username, and logout added. */

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(64)
  username!: string;

  @IsString() @MinLength(1) @MaxLength(256)
  password!: string;
}

class RefreshDto {
  @IsString() @MinLength(1)
  refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.username, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  /** Ends every session of the caller, on every device. */
  @Roles('ADMIN', 'ENTRY_OPERATOR', 'PAYMENT_OPERATOR', 'EXIT_OPERATOR')
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor): Promise<void> {
    await this.auth.logout(actor.id);
  }
}
