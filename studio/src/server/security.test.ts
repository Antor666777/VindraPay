import { describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE } from './auth.js';
import { CliError, resolveConfig } from './config.js';
import { MANAGE_API_PREFIX } from './proxy.js';
import { hasUnsafeSegments, queryOf, requestPath } from './request-url.js';
import { buildServer } from './server.js';

const UNREACHABLE_BACKEND = ['--backend-url', 'http://127.0.0.1:9'];

interface RawResponse {
  status: number;
  body: string;
}

function rawGet(port: number, requestTarget: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: '127.0.0.1', port });
    let raw = '';
    socket.on('connect', () => {
      socket.write(
        `GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      raw += chunk.toString();
    });
    socket.on('end', () => {
      const statusLine = raw.split('\r\n')[0] ?? '';
      const status = Number.parseInt(statusLine.split(' ')[1] ?? '0', 10);
      const bodyStart = raw.indexOf('\r\n\r\n');
      resolve({ status, body: bodyStart >= 0 ? raw.slice(bodyStart + 4) : '' });
    });
    socket.on('error', reject);
  });
}

async function buildTestServer(extraArgs: string[] = []): Promise<FastifyInstance> {
  const outcome = resolveConfig(['--api-key', 'test-key-0001', ...UNREACHABLE_BACKEND, ...extraArgs], {});
  if (outcome instanceof CliError) {
    throw outcome;
  }
  return buildServer(outcome);
}

describe('requestPath', () => {
  it('strips query strings from origin-form urls', () => {
    expect(requestPath('/studio-api/meta?x=1')).toBe('/studio-api/meta');
    expect(requestPath('/studio-api/meta')).toBe('/studio-api/meta');
  });

  it('resolves absolute-form urls to their pathname', () => {
    expect(requestPath('http://evil.test/studio-api/meta')).toBe('/studio-api/meta');
    expect(requestPath('https://evil.test/studio-api/login?x=1')).toBe('/studio-api/login');
  });

  it('falls back to the root path', () => {
    expect(requestPath(undefined)).toBe('/');
    expect(requestPath('')).toBe('/');
  });
});

describe('queryOf', () => {
  it('returns the raw query string including the separator', () => {
    expect(queryOf('/studio-api/orders?limit=5&offset=0')).toBe('?limit=5&offset=0');
    expect(queryOf('http://evil.test/studio-api/orders?limit=5')).toBe('?limit=5');
    expect(queryOf('/studio-api/orders')).toBe('');
    expect(queryOf(undefined)).toBe('');
  });
});

describe('hasUnsafeSegments', () => {
  it.each([
    [`${MANAGE_API_PREFIX}/businesses`, false],
    ['/studio-api/orders/', false],
    ['/studio-api//orders', false],
    ['/../healthz', true],
    ['/a/../../healthz', true],
    ['/%2e%2e/healthz', true],
    ['/%2E%2E/healthz', true],
    ['/businesses/%2fx', true],
    ['/businesses/x%5C..', true],
  ])('classifies %s as unsafe=%j', (input, expected) => {
    expect(hasUnsafeSegments(input)).toBe(expected);
  });
});

describe('proxy path confinement', () => {
  it('rejects dot-segment traversal on the wire without contacting the backend', async () => {
    const app = await buildTestServer();
    try {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('no listening port');
      }
      for (const target of [
        '/studio-api/../healthz',
        '/studio-api/../../api/v1/ping',
        '/studio-api/%2e%2e/healthz',
        '/studio-api/%2e%2e/%2e%2e/api/v1/ping',
        '/studio-api/businesses/%2f..%2f..%2fsecret',
      ]) {
        const res = await rawGet(address.port, target);
        expect(res.status, target).toBe(404);
        expect(JSON.parse(res.body), target).toEqual({ success: false, error: 'not found' });
      }
    } finally {
      await app.close();
    }
  });

  it('still forwards well-formed paths with query strings', async () => {
    const app = await buildTestServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/studio-api/backend-health?probe=1' });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ success: false, error: 'backend unreachable' });
    } finally {
      await app.close();
    }
  });
});

describe('session gate', () => {
  it('issues sessions on login and enforces them on studio-api routes', async () => {
    const app = await buildTestServer(['--auth-password', 'correct horse battery staple']);
    try {
      const anonymous = await app.inject({ method: 'GET', url: '/studio-api/meta' });
      expect(anonymous.statusCode).toBe(401);

      const badLogin = await app.inject({
        method: 'POST',
        url: '/studio-api/login',
        payload: { password: 'wrong' },
      });
      expect(badLogin.statusCode).toBe(401);

      const login = await app.inject({
        method: 'POST',
        url: '/studio-api/login',
        payload: { password: 'correct horse battery staple' },
      });
      expect(login.statusCode).toBe(200);
      const issued = login.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      expect(issued).toBeDefined();

      const authenticated = await app.inject({
        method: 'GET',
        url: '/studio-api/meta',
        headers: { cookie: `${SESSION_COOKIE}=${issued?.value ?? ''}` },
      });
      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json()).toMatchObject({ authenticated: true });
    } finally {
      await app.close();
    }
  });

  it('applies the gate to absolute-form request targets', async () => {
    const app = await buildTestServer(['--auth-password', 'pw12345']);
    try {
      for (const target of [
        'http://attacker.test/studio-api/meta',
        'http://attacker.test/studio-api/stats',
      ]) {
        const res = await app.inject({ method: 'GET', url: target });
        expect(res.statusCode, target).toBe(401);
      }
      const loginProbe = await app.inject({
        method: 'POST',
        url: 'http://attacker.test/studio-api/login',
        payload: { password: 'pw12345' },
      });
      expect(loginProbe.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('never exposes the api key through meta', async () => {
    const app = await buildTestServer(['--auth-password', 'pw12345']);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/studio-api/login',
        payload: { password: 'pw12345' },
      });
      const issued = login.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      const meta = await app.inject({
        method: 'GET',
        url: '/studio-api/meta',
        headers: { cookie: `${SESSION_COOKIE}=${issued?.value ?? ''}` },
      });
      expect(JSON.stringify(meta.json())).not.toContain('test-key-0001');
    } finally {
      await app.close();
    }
  });
});
