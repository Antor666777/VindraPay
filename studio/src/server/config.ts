import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export const STUDIO_VERSION = '1.0.0';

export const BODY_LIMIT_BYTES = 1024 * 1024;

export interface Config {
  port: number;
  host: string;
  backendUrl: string;
  apiKey: string;
  authPassword: string | null;
  timeoutMs: number;
  open: boolean;
}

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, options?: { exitCode?: number }) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options?.exitCode ?? 1;
  }
}

export const USAGE = [
  'VindraPay Studio - self-hosted admin console for the VindraPay backend',
  '',
  'Usage: vindrapay-studio [options]',
  '',
  'Options:',
  '  --port <n>            Port to listen on. Env: STUDIO_PORT. Default: 5175',
  '  --host <addr>         Bind address. Env: STUDIO_HOST. Default: 127.0.0.1',
  '  --backend-url <url>   Backend base URL (http/https). Env: STUDIO_BACKEND_URL. Default: http://localhost:8080',
  '  --api-key <key>       Backend management API key (required). Env: STUDIO_API_KEY.',
  '  --auth-password <pw>  Enable the UI login gate. Env: STUDIO_AUTH_PASSWORD. Default: disabled',
  '  --timeout-ms <n>      Backend timeout in ms, clamped to 1000..120000. Env: STUDIO_TIMEOUT_MS. Default: 10000',
  '  --open                Open the browser after startup',
  '  -h, --help            Show this help and exit',
  '',
  'Precedence: flag > environment variable > .env file (studio/.env) > default.',
].join('\n');

const FLAG_OPTIONS = {
  port: { type: 'string' },
  host: { type: 'string' },
  'backend-url': { type: 'string' },
  'api-key': { type: 'string' },
  'auth-password': { type: 'string' },
  'timeout-ms': { type: 'string' },
  open: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type FlagValues = {
  port?: string;
  host?: string;
  'backend-url'?: string;
  'api-key'?: string;
  'auth-password'?: string;
  'timeout-ms'?: string;
  open?: boolean;
  help?: boolean;
};

interface Picked {
  value: string;
  source: 'flag' | 'env';
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pickString(flagValue: unknown, env: NodeJS.ProcessEnv, envKey: string): Picked | null {
  if (typeof flagValue === 'string' && flagValue.trim() !== '') {
    return { value: flagValue, source: 'flag' };
  }
  const fromEnv = envValue(env, envKey);
  if (fromEnv !== null) {
    return { value: fromEnv, source: 'env' };
  }
  return null;
}

function labelOf(picked: Picked | null, flag: string, envKey: string): string {
  if (!picked) return flag;
  return picked.source === 'flag' ? flag : envKey;
}

function fail(message: string): never {
  throw new CliError(message);
}

function unknownFlagMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /(?:option|argument)\s+'?"?([^\s'"]+)"?'?/i.exec(raw);
  const token = match?.[1];
  if (!token) {
    return `${raw.replace(/\.$/, '')}. Run with --help to see the available options.`;
  }
  const dashed = token.startsWith('-')
    ? token
    : token.length === 1
      ? `-${token}`
      : `--${token}`;
  return `Unknown option ${dashed}. Run with --help to see the available options.`;
}

function parseInto(rawArgs: string[], env: NodeJS.ProcessEnv): Config {
  let values: FlagValues;
  try {
    const parsed = parseArgs({ args: rawArgs, options: FLAG_OPTIONS, strict: true });
    values = parsed.values as FlagValues;
  } catch (error) {
    throw new CliError(unknownFlagMessage(error));
  }

  if (values.help) {
    throw new CliError(USAGE, { exitCode: 0 });
  }

  const apiKeyPick = pickString(values['api-key'], env, 'STUDIO_API_KEY');
  if (!apiKeyPick) {
    fail(
      'Missing required API key: pass --api-key <key> or set the STUDIO_API_KEY environment variable (the same value as the backend MANAGEMENT_API_KEY). Run with --help for details.',
    );
  }

  const portPick = pickString(values.port, env, 'STUDIO_PORT');
  const portRaw = portPick?.value ?? '5175';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(
      `Invalid ${labelOf(portPick, '--port', 'STUDIO_PORT')} value "${portRaw}": expected an integer between 1 and 65535.`,
    );
  }

  const hostPick = pickString(values.host, env, 'STUDIO_HOST');
  const host = hostPick?.value ?? '127.0.0.1';

  const urlPick = pickString(values['backend-url'], env, 'STUDIO_BACKEND_URL');
  const backendUrlRaw = urlPick?.value ?? 'http://localhost:8080';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(backendUrlRaw);
  } catch {
    fail(
      `Invalid ${labelOf(urlPick, '--backend-url', 'STUDIO_BACKEND_URL')} value "${backendUrlRaw}": must be a valid http:// or https:// URL.`,
    );
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    fail(
      `Invalid ${labelOf(urlPick, '--backend-url', 'STUDIO_BACKEND_URL')} value "${backendUrlRaw}": must be a valid http:// or https:// URL.`,
    );
  }
  const backendUrl = backendUrlRaw.endsWith('/') ? backendUrlRaw.slice(0, -1) : backendUrlRaw;

  const passwordPick = pickString(values['auth-password'], env, 'STUDIO_AUTH_PASSWORD');
  const authPassword = passwordPick?.value ?? null;

  const timeoutPick = pickString(values['timeout-ms'], env, 'STUDIO_TIMEOUT_MS');
  const timeoutRaw = timeoutPick?.value ?? '10000';
  const timeoutNumber = Number(timeoutRaw);
  if (!Number.isFinite(timeoutNumber)) {
    fail(
      `Invalid ${labelOf(timeoutPick, '--timeout-ms', 'STUDIO_TIMEOUT_MS')} value "${timeoutRaw}": expected a number of milliseconds.`,
    );
  }
  const timeoutMs = Math.min(120000, Math.max(1000, Math.round(timeoutNumber)));

  return {
    port,
    host,
    backendUrl,
    apiKey: apiKeyPick.value,
    authPassword,
    timeoutMs,
    open: values.open === true,
  };
}

export function loadDotEnv(dir: string = process.cwd()): Record<string, string> {
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

export function mergeDotEnv(
  dir: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...loadDotEnv(dir), ...env };
}

export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv): Config | CliError {
  try {
    return parseInto(argv, env);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length >= 4) return `***${apiKey.slice(-4)}`;
  return '***';
}
