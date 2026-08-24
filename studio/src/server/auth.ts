import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { STUDIO_VERSION, type Config } from './config.js';
import { requestPath } from './request-url.js';

export const SESSION_COOKIE = 'vp_studio_session';
export const SESSION_MAX_AGE_SECONDS = 604800;

const LOGIN_PATH = '/studio-api/login';
const STUDIO_API_PREFIX = '/studio-api';
const THROTTLE_MAX_FAILURES = 5;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX_TRACKED_IPS = 10_000;

export interface SessionClaims {
  exp: number;
}

export type SessionVerdict = { valid: true; claims: SessionClaims } | { valid: false };

export function deriveSessionSecret(password: string, bootSecret: string): Buffer {
  return createHash('sha256').update(`${password}:${bootSecret}`).digest();
}

export function encodeSessionToken(claims: SessionClaims, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSessionToken(token: string | undefined, secret: Buffer): SessionVerdict {
  if (!token) return { valid: false };
  const separatorIndex = token.indexOf('.');
  if (separatorIndex <= 0) return { valid: false };
  const payload = token.slice(0, separatorIndex);
  const givenSignature = token.slice(separatorIndex + 1);
  const expectedSignature = createHmac('sha256', secret).update(payload).digest();
  let givenBuffer: Buffer;
  try {
    givenBuffer = Buffer.from(givenSignature, 'base64url');
  } catch {
    return { valid: false };
  }
  if (givenBuffer.length !== expectedSignature.length) return { valid: false };
  if (!timingSafeEqual(givenBuffer, expectedSignature)) return { valid: false };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false };
  }
  if (typeof claims !== 'object' || claims === null) return { valid: false };
  const exp = (claims as { exp?: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return { valid: false };
  if (exp <= Date.now()) return { valid: false };
  return { valid: true, claims: { exp } };
}

export function passwordsMatch(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export class LoginThrottle {
  private readonly hits = new Map<string, { fails: number; windowStart: number }>();

  constructor(
    private readonly maxFailures: number = THROTTLE_MAX_FAILURES,
    private readonly windowMs: number = THROTTLE_WINDOW_MS,
  ) {}

  isBlocked(ip: string): boolean {
    const entry = this.hits.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.windowStart > this.windowMs) {
      this.hits.delete(ip);
      return false;
    }
    return entry.fails >= this.maxFailures;
  }

  recordFailure(ip: string): void {
    const now = Date.now();
    const entry = this.hits.get(ip);
    if (!entry || now - entry.windowStart > this.windowMs) {
      if (!this.hits.has(ip) && this.hits.size >= THROTTLE_MAX_TRACKED_IPS) {
        const oldest = this.hits.keys().next();
        if (!oldest.done) {
          this.hits.delete(oldest.value);
        }
      }
      this.hits.set(ip, { fails: 1, windowStart: now });
      return;
    }
    entry.fails += 1;
  }

  reset(ip: string): void {
    this.hits.delete(ip);
  }
}

interface AuthOptions {
  config: Config;
  bootSecret: string;
}

export function registerAuth(app: FastifyInstance, options: AuthOptions): void {
  const { config, bootSecret } = options;
  const authPassword =
    typeof config.authPassword === 'string' && config.authPassword.length > 0
      ? config.authPassword
      : null;
  const sessionSecret = authPassword ? deriveSessionSecret(authPassword, bootSecret) : null;
  const throttle = new LoginThrottle();

  app.addHook(
    'onRequest',
    (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      if (!authPassword || !sessionSecret) {
        done();
        return;
      }
      const rawPath = requestPath(request.raw.url);
      if (!rawPath.startsWith(STUDIO_API_PREFIX)) {
        done();
        return;
      }
      if (rawPath === LOGIN_PATH) {
        done();
        return;
      }
      const verdict = decodeSessionToken(request.cookies[SESSION_COOKIE], sessionSecret);
      if (!verdict.valid) {
        reply.code(401).send({ success: false, error: 'unauthorized' });
        return;
      }
      done();
    },
  );

  app.post(LOGIN_PATH, async (request, reply) => {
    if (!authPassword || !sessionSecret) {
      return reply.code(404).send({ success: false, error: 'not found' });
    }
    const body = request.body as { password?: unknown } | undefined;
    const candidate = typeof body?.password === 'string' ? body.password : null;
    if (candidate === null) {
      return reply.code(400).send({ success: false, error: 'invalid body' });
    }
    if (throttle.isBlocked(request.ip)) {
      return reply.code(429).send({ success: false, error: 'too many attempts' });
    }
    if (!passwordsMatch(candidate, authPassword)) {
      throttle.recordFailure(request.ip);
      return reply.code(401).send({ success: false, error: 'invalid password' });
    }
    throttle.reset(request.ip);
    const claims: SessionClaims = { exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 };
    const token = encodeSessionToken(claims, sessionSecret);
    return reply
      .setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_MAX_AGE_SECONDS,
        secure: false,
      })
      .send({ success: true });
  });

  app.get('/studio-api/meta', async () => ({
    backendUrl: config.backendUrl,
    authenticated: config.apiKey.length > 0,
    version: STUDIO_VERSION,
  }));
}
