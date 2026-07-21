import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtService } from './jwt.service';

const V1_KEY = '5B6F7D3E2A9C4B8E0A1F6D9B3E7A2C9D4F8E5B6C3A7B1D6F4C9A3E8D2B5F7A1';

const CUST = 'test-customer';

// customer is a per-call argument now (not config), so the mock only needs to serve the jwt config.
function svc(overrides: Partial<{ secretBase64: string; expiresIn: string; resetExpiresIn: string }> = {}): JwtService {
  const config = {
    get: () => ({ secretBase64: V1_KEY, expiresIn: '24h', resetExpiresIn: '15m', ...overrides }),
  } as unknown as ConfigService;
  return new JwtService(config as never);
}

describe('JwtService (v1-compatible)', () => {
  it('issues an HS256 token with { username, sub, customer, iat, exp }', () => {
    const token = svc().generateToken('alice', CUST);
    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header.alg).toBe('HS256');
    const payload = decoded.payload as jwt.JwtPayload;
    expect(payload.username).toBe('alice');
    expect(payload.sub).toBe('alice');
    expect(payload.customer).toBe(CUST);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    // ~24h expiry
    expect(payload.exp! - payload.iat!).toBe(24 * 3600);
  });

  it('uses the base64-decoded key (must match v1 byte-for-byte)', () => {
    const token = svc().generateToken('bob', CUST);
    // A token verified with the same base64-decoded key succeeds.
    const key = Buffer.from(V1_KEY, 'base64');
    expect(() => jwt.verify(token, key, { algorithms: ['HS256'] })).not.toThrow();
    // The decoded key length is what v1 produces (63-char base64 -> 47 bytes, RFC4648; Java's
    // Decoders.BASE64 and Node's Buffer agree here, so the HMAC keys are byte-identical).
    expect(key.length).toBe(47);
  });

  it('extractUsername round-trips and rejects garbage/expired tokens', () => {
    const s = svc();
    expect(s.extractUsername(s.generateToken('carol', CUST))).toBe('carol');
    expect(s.extractUsername('not-a-token')).toBeNull();
    const expired = svc({ expiresIn: '-1s' }).generateToken('dave', CUST);
    expect(s.extractUsername(expired)).toBeNull();
  });

  it('password-reset token carries type=PASSWORD_RESET + customer and validates to both', () => {
    const s = svc();
    const token = s.generatePasswordResetToken('erin', CUST);
    expect(s.validatePasswordResetToken(token)).toEqual({ username: 'erin', customer: CUST });
    // A login token is not a valid reset token.
    expect(() => s.validatePasswordResetToken(s.generateToken('erin', CUST))).toThrow(UnauthorizedException);
  });

  it('a v1-shaped token (signed externally with the same key) verifies under v2', () => {
    // Simulate a token the Java service would issue: { username, sub, iat, exp } / HS256.
    const key = Buffer.from(V1_KEY, 'base64');
    const v1Token = jwt.sign({ username: 'frank' }, key, { algorithm: 'HS256', subject: 'frank', expiresIn: '24h' });
    expect(svc().extractUsername(v1Token)).toBe('frank');
  });
});
