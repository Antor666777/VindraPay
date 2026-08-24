import type { FastifyInstance, FastifyReply } from 'fastify';
import { BODY_LIMIT_BYTES, type Config } from './config.js';
import { hasUnsafeSegments, queryOf, requestPath } from './request-url.js';

export const MANAGE_API_PREFIX = '/manage/v1';

const STUDIO_API_PREFIX = '/studio-api';
const BACKEND_HEALTH_PATH = '/studio-api/backend-health';
const STUDIO_API_WILDCARD = `${STUDIO_API_PREFIX}/*`;
const NOT_FOUND_PAYLOAD = { success: false, error: 'not found' };

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED',
  'UND_ERR_SOCKET',
]);

export interface NormalizedUpstreamError {
  statusCode: 502;
  payload: { success: false; error: 'backend unreachable' };
}

export const BACKEND_UNREACHABLE: NormalizedUpstreamError = {
  statusCode: 502,
  payload: { success: false, error: 'backend unreachable' },
};

export function mapUpstreamError(error: unknown): NormalizedUpstreamError | null {
  if (error instanceof Error && (error.name === 'TimeoutError' || error instanceof TypeError)) {
    return BACKEND_UNREACHABLE;
  }
  const code =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? ((error as NodeJS.ErrnoException).code ??
          ((error.cause as NodeJS.ErrnoException | undefined)?.code))
        : undefined;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
    return BACKEND_UNREACHABLE;
  }
  return null;
}

export async function registerProxy(app: FastifyInstance, cfg: Config): Promise<void> {
  const send = async (
    reply: FastifyReply,
    upstreamPath: string,
    init: RequestInit,
  ): Promise<FastifyReply> => {
    let response: Response;
    try {
      response = await fetch(`${cfg.backendUrl}${upstreamPath}`, {
        ...init,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (error) {
      const normalized = mapUpstreamError(error) ?? BACKEND_UNREACHABLE;
      void app.log.warn({ upstreamPath }, 'backend unreachable');
      return reply.code(normalized.statusCode).send(normalized.payload);
    }
    const text = await response.text();
    return reply.code(response.status)
      .type(response.headers.get('content-type') ?? 'application/json')
      .send(text);
  };

  app.get(BACKEND_HEALTH_PATH, (_request, reply) =>
    send(reply, '/healthz', { method: 'GET' }),
  );

  app.all(
    STUDIO_API_WILDCARD,
    { bodyLimit: BODY_LIMIT_BYTES },
    async (request, reply) => {
      const rawUrl = request.raw.url ?? '/';
      const path = requestPath(rawUrl);
      if (!path.startsWith(`${STUDIO_API_PREFIX}/`) || hasUnsafeSegments(path)) {
        return reply.code(404).send(NOT_FOUND_PAYLOAD);
      }
      const rest = path.slice(STUDIO_API_PREFIX.length);
      const query = queryOf(rawUrl);

      const headers: Record<string, string> = {
        authorization: `Bearer ${cfg.apiKey}`,
      };
      const init: RequestInit = { method: request.method, headers };
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(request.body ?? {});
      }

      return send(reply, `${MANAGE_API_PREFIX}${rest}${query}`, init);
    },
  );
}
