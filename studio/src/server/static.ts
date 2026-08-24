import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const NOT_BUILT_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>VindraPay Studio</title></head>',
  '<body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 40rem;">',
  '<h1>VindraPay Studio</h1>',
  '<p>The web UI has not been built yet.</p>',
  '<p>Run:</p>',
  '<pre><code>pnpm build</code></pre>',
  '</body>',
  '</html>',
].join('\n');

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate package.json above ${startDir}`);
    }
    dir = parent;
  }
}

export interface StaticUiResult {
  built: boolean;
  webRoot: string;
}

export async function registerStaticUi(app: FastifyInstance): Promise<StaticUiResult> {
  const packageRoot = findPackageRoot(currentDir());
  const webRoot = path.join(packageRoot, 'dist', 'web');
  const built = existsSync(path.join(webRoot, 'index.html'));
  if (built) {
    await app.register(fastifyStatic, { root: webRoot, index: 'index.html' });
  } else {
    app.get('/', (_request, reply) => {
      return reply.code(200).type('text/html; charset=utf-8').send(NOT_BUILT_HTML);
    });
  }
  return { built, webRoot };
}
