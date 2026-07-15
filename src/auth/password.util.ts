import * as bcrypt from 'bcryptjs';

/**
 * bcrypt hashing, interoperable with Spring's BCryptPasswordEncoder (both produce/verify $2a/$2b
 * hashes at strength 10), so v1-hashed passwords verify under v2 and vice versa.
 */
export function hashPassword(raw: string): string {
  return bcrypt.hashSync(raw, 10);
}

export function matchesPassword(raw: string, hash?: string): boolean {
  if (!hash) return false;
  return bcrypt.compareSync(raw, hash);
}
