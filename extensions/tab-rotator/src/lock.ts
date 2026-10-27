import type { LockSettings } from './engine/types.ts';

// PBKDF2 makes a copied settings file useless for guessing the PIN offline at any useful speed. It is
// still a deterrent for floor staff, not a security boundary: anyone with DevTools controls the browser.
const ITERATIONS = 100_000;
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 60_000;

export const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

export async function createLock(pin: string): Promise<LockSettings> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4–8 digits.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { enabled: true, salt, hash: await hashPin(pin, salt) };
}

export async function verifyPin(lock: LockSettings, pin: string): Promise<boolean> {
  return isValidPin(pin) && (await hashPin(pin, lock.salt)) === lock.hash;
}

export interface Attempts {
  failures: number;
  lockedUntil: number;
}

export const NO_ATTEMPTS: Attempts = { failures: 0, lockedUntil: 0 };

/** After MAX_FAILURES wrong PINs, refuse for LOCKOUT_MS (doubling each further round). */
export function recordAttempt(attempts: Attempts, ok: boolean, now: number): Attempts {
  if (ok) return NO_ATTEMPTS;
  const failures = attempts.failures + 1;
  if (failures % MAX_FAILURES !== 0) return { failures, lockedUntil: attempts.lockedUntil };
  const rounds = failures / MAX_FAILURES;
  return { failures, lockedUntil: now + LOCKOUT_MS * 2 ** (rounds - 1) };
}

export const isLockedOut = (attempts: Attempts, now: number) => now < attempts.lockedUntil;
