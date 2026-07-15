import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { AppConfig } from '../config/configuration';

/**
 * Verifies Google ID tokens (equivalent to the Java GoogleTokenVerifierService). Injectable so it
 * can be mocked in tests — the live Google path can't be exercised offline.
 */
@Injectable()
export class GoogleVerifierService {
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.clientId = config.get('google', { infer: true }).clientId;
    this.client = new OAuth2Client(this.clientId);
  }

  async verify(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('empty payload');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
  }
}
