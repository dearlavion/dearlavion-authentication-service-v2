import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AppConfig } from '../config/configuration';

/**
 * Issues and verifies JWTs, byte-compatible with the Java v1 JwtService:
 * - HS256, key = the base64-decoded secret (v1 does `Decoders.BASE64.decode(...)`).
 * - Login token payload: { username, sub: username, iat, exp } (24h).
 * - Reset token: { sub: username, type: 'PASSWORD_RESET', iat, exp } (15m).
 * Using the same key + algorithm + claims means v1- and v2-issued tokens verify on either stack.
 */
@Injectable()
export class JwtService {
  private readonly key: Buffer;
  private readonly expiresIn: string;
  private readonly resetExpiresIn: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const j = config.get('jwt', { infer: true });
    this.key = Buffer.from(j.secretBase64, 'base64');
    this.expiresIn = j.expiresIn;
    this.resetExpiresIn = j.resetExpiresIn;
  }

  /** Login token, stamped with the caller's customer/tenant. */
  generateToken(username: string, customer: string): string {
    return jwt.sign({ username, customer }, this.key, {
      algorithm: 'HS256',
      subject: username,
      expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  /** Verify a login token and return its claims, or null if invalid/expired. */
  verifyToken(token: string): { username: string; customer?: string } | null {
    try {
      const d = jwt.verify(token, this.key, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const username = d.sub ?? (d.username as string | undefined) ?? null;
      if (!username) return null;
      return { username, customer: d.customer as string | undefined };
    } catch {
      return null;
    }
  }

  generatePasswordResetToken(username: string, customer: string): string {
    return jwt.sign({ type: 'PASSWORD_RESET', customer }, this.key, {
      algorithm: 'HS256',
      subject: username,
      expiresIn: this.resetExpiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  /** Returns the subject (username) if valid and not expired, else null. */
  extractUsername(token: string): string | null {
    try {
      const decoded = jwt.verify(token, this.key, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      return decoded.sub ?? null;
    } catch {
      return null;
    }
  }

  /** Validates a reset token and returns its username + customer, or throws 401. */
  validatePasswordResetToken(token: string): { username: string; customer?: string } {
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, this.key, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (decoded.type !== 'PASSWORD_RESET') {
      throw new UnauthorizedException('Invalid token type');
    }
    return { username: decoded.sub as string, customer: decoded.customer as string | undefined };
  }
}
