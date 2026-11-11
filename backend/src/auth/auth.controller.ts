import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { clientAddressOf } from './client-address';
import { SignInThrottledException } from './login-throttle.service';
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
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      // The browser's address when the portal signs in for it and its signed header verifies (T13);
      // else req.ip, the caller as the one trusted proxy hop (Caddy) saw it (app.setup.ts).
      return await this.auth.login(body.username, body.password, clientAddressOf(req));
    } catch (error) {
      if (error instanceof SignInThrottledException) res.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
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
