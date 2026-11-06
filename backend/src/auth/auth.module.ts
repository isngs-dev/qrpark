import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** Copied from eparking backend/src/auth/auth.module.ts; the secret is now required. */

/** Shortest secret accepted. */
const MIN_SECRET_LENGTH = 32;

/**
 * The signing secret is infrastructure, from the environment. There is no
 * fallback: a default secret would let a deployment that forgot the variable
 * sign tokens anyone can forge. The app refuses to start instead.
 */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set, at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        signOptions: { issuer: 'qrpark', algorithm: 'HS256' },
        verifyOptions: { issuer: 'qrpark', algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
