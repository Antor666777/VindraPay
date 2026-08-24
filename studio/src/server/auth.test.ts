import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LoginThrottle,
  SESSION_MAX_AGE_SECONDS,
  decodeSessionToken,
  deriveSessionSecret,
  encodeSessionToken,
  passwordsMatch,
} from './auth.js';

describe('session tokens', () => {
  const secret = deriveSessionSecret('hunter2', 'boot-secret');

  it('round-trips a freshly issued token', () => {
    const claims = { exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 };
    const verdict = decodeSessionToken(encodeSessionToken(claims, secret), secret);
    expect(verdict.valid).toBe(true);
    if (verdict.valid) {
      expect(verdict.claims.exp).toBe(claims.exp);
    }
  });

  it('rejects expired tokens', () => {
    const token = encodeSessionToken({ exp: Date.now() - 1000 }, secret);
    expect(decodeSessionToken(token, secret).valid).toBe(false);
  });

  it('rejects tampered signatures', () => {
    const token = encodeSessionToken({ exp: Date.now() + 60_000 }, secret);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    const payload = parts[0] ?? '';
    const signature = parts[1] ?? '';
    const tampered = `${payload}.${(signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)}`;
    expect(decodeSessionToken(tampered, secret).valid).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const token = encodeSessionToken({ exp: Date.now() + 60_000 }, secret);
    const otherPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 600_000 })).toString(
      'base64url',
    );
    const signature = token.split('.')[1] ?? '';
    expect(decodeSessionToken(`${otherPayload}.${signature}`, secret).valid).toBe(false);
  });

  it('rejects tokens signed with a different secret', () => {
    const token = encodeSessionToken({ exp: Date.now() + 60_000 }, secret);
    const otherSecret = deriveSessionSecret('another-password', 'boot-secret');
    expect(decodeSessionToken(token, otherSecret).valid).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(decodeSessionToken(undefined, secret).valid).toBe(false);
    expect(decodeSessionToken('', secret).valid).toBe(false);
    expect(decodeSessionToken('garbage', secret).valid).toBe(false);
    expect(decodeSessionToken('a.b', secret).valid).toBe(false);
  });
});

describe('password comparison', () => {
  it('accepts the correct password only', () => {
    expect(passwordsMatch('hunter2', 'hunter2')).toBe(true);
    expect(passwordsMatch('hunter3', 'hunter2')).toBe(false);
    expect(passwordsMatch('', 'hunter2')).toBe(false);
  });
});

describe('LoginThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks the 6th attempt from the same ip within the window', () => {
    const throttle = new LoginThrottle(5, 5 * 60_000);
    for (let i = 0; i < 5; i += 1) {
      expect(throttle.isBlocked('10.0.0.1')).toBe(false);
      throttle.recordFailure('10.0.0.1');
    }
    expect(throttle.isBlocked('10.0.0.1')).toBe(true);
  });

  it('does not block other ips', () => {
    const throttle = new LoginThrottle(5, 5 * 60_000);
    for (let i = 0; i < 5; i += 1) throttle.recordFailure('10.0.0.1');
    expect(throttle.isBlocked('10.0.0.2')).toBe(false);
  });

  it('lifts the block once the window elapses', () => {
    const throttle = new LoginThrottle(5, 5 * 60_000);
    for (let i = 0; i < 5; i += 1) throttle.recordFailure('10.0.0.1');
    expect(throttle.isBlocked('10.0.0.1')).toBe(true);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(throttle.isBlocked('10.0.0.1')).toBe(false);
  });

  it('resets failures after success', () => {
    const throttle = new LoginThrottle(5, 5 * 60_000);
    for (let i = 0; i < 3; i += 1) throttle.recordFailure('10.0.0.1');
    throttle.reset('10.0.0.1');
    expect(throttle.isBlocked('10.0.0.1')).toBe(false);
  });
});
