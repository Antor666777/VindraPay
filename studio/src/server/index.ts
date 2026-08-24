import { spawn } from 'node:child_process';
import { CliError, maskApiKey, mergeDotEnv, resolveConfig } from './config.js';
import { buildServer } from './server.js';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function fail(message: string): never {
  console.error(`${RED}${message}${RESET}`);
  process.exit(1);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      }).on('error', () => {});
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore' }).on('error', () => {});
    }
  } catch {}
}

function displayHostOf(host: string): string {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host;
}

async function main(): Promise<void> {
  const mergedEnv = mergeDotEnv(process.cwd(), process.env);
  const outcome = resolveConfig(process.argv.slice(2), mergedEnv);
  if (outcome instanceof CliError) {
    if (outcome.exitCode === 0) {
      console.log(outcome.message);
      process.exit(0);
    }
    fail(outcome.message);
  }
  const cfg = outcome;

  const app = await buildServer(cfg);

  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
      fail(
        `Port ${cfg.port} is already in use on ${cfg.host}. Stop the other process or pick another port with --port <n> (or the STUDIO_PORT env var).`,
      );
    }
    fail(`Failed to start VindraPay Studio: ${(error as Error).message}`);
  }

  const displayHost = displayHostOf(cfg.host);
  const displayUrl = `http://${displayHost}:${cfg.port}`;
  console.log(`VindraPay Studio ready at ${displayUrl}`);
  console.log(`Backend: ${cfg.backendUrl}`);
  console.log(`API key: ${maskApiKey(cfg.apiKey)}`);
  console.log(`UI gate: ${cfg.authPassword ? 'enabled' : 'disabled'}`);

  if (cfg.open) openBrowser(displayUrl);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, closing VindraPay Studio...`);
    app.server.closeIdleConnections();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  fail(`Unexpected startup error: ${(error as Error)?.message ?? String(error)}`);
});
