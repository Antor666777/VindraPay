import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { registerAuth } from './auth.js';
import { BODY_LIMIT_BYTES, type Config } from './config.js';
import { registerProxy } from './proxy.js';
import { requestPath } from './request-url.js';
import { NOT_BUILT_HTML, registerStaticUi } from './static.js';

const STUDIO_API_PREFIX = '/studio-api';
const ASSET_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;

const LOG_LEVELS: ReadonlySet<string> = new Set([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]);

function resolveLogLevel(nodeEnv: string | undefined): string {
  if (nodeEnv && LOG_LEVELS.has(nodeEnv)) return nodeEnv;
  return 'warn';
}

export async function buildServer(cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: resolveLogLevel(process.env.NODE_ENV) },
    bodyLimit: BODY_LIMIT_BYTES,
  });

  const bootSecret = randomBytes(32).toString('hex');

  await app.register(cookie, { secret: bootSecret });
  registerAuth(app, { config: cfg, bootSecret });
  const ui = await registerStaticUi(app);
  await registerProxy(app, cfg);

  app.setNotFoundHandler((request, reply) => {
    const rawPath = requestPath(request.raw.url);
    if (rawPath === STUDIO_API_PREFIX || rawPath.startsWith(`${STUDIO_API_PREFIX}/`)) {
      return reply.code(404).send({ success: false, error: 'not found' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ success: false, error: 'not found' });
    }
    if (ASSET_EXTENSION_PATTERN.test(rawPath)) {
      return reply.code(404).send({ success: false, error: 'not found' });
    }
    if (ui.built) {
      return reply.sendFile('index.html');
    }
    return reply.code(200).type('text/html; charset=utf-8').send(NOT_BUILT_HTML);
  });

  return app;
}
