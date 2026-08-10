/**
 * Authentication primitives — password hashing and JWT issue/verify.
 *
 * No native dependencies: password hashing uses Node's built-in scrypt (crypto),
 * matching the platform's "no compiled modules" stance. JWTs are signed with
 * jsonwebtoken (already a dependency) and carried in an httpOnly cookie so a
 * full-page navigation to the gated dashboard is authenticated by the browser.
 */

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ROLE_MATRIX, type AuthedUser, type Role, type User } from '@efip/shared';

const SECRET: string = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TTL: string = process.env.JWT_TTL || '12h';

if (process.env.NODE_ENV === 'production' && SECRET === 'dev-insecure-secret-change-me') {
  // Fail loud rather than run a production login on a known secret.
  throw new Error('JWT_SECRET must be set in production (see .env.example).');
}

const KEYLEN = 64;

/** Store as `saltHex:keyHex`. */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, KEYLEN);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, keyHex] = String(stored).split(':');
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, 'hex');
  const test = scryptSync(pw, Buffer.from(saltHex, 'hex'), KEYLEN);
  return key.length === test.length && timingSafeEqual(key, test);
}

/**
 * Constant-work stand-in used when the email is unknown. Running a real scrypt
 * makes an "unknown user" response take the same time as a "wrong password" one,
 * so login timing cannot be used to enumerate valid accounts. Result discarded.
 */
export function dummyVerify(pw: string): void {
  scryptSync(pw, DUMMY_SALT, KEYLEN);
}

const DUMMY_SALT = randomBytes(16);

export interface TokenClaims {
  sub: string;
  email: string;
  role: Role;
}

export function signToken(u: User): string {
  const claims: TokenClaims = { sub: u.id, email: u.email, role: u.role };
  return jwt.sign(claims, SECRET, { expiresIn: TTL as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): TokenClaims | null {
  try {
    return jwt.verify(token, SECRET) as TokenClaims;
  } catch {
    return null;
  }
}

/** Attach the role's capabilities so the UI can decide what to offer. */
export function toAuthedUser(u: User): AuthedUser {
  return { ...u, capabilities: ROLE_MATRIX[u.role] ?? [] };
}
