import { describe, expect, it } from 'vitest';
import { CliError, resolveConfig, type Config } from './config.js';

function expectConfig(result: Config | CliError): Config {
  if (result instanceof CliError) {
    throw new Error(`expected config, got CliError: ${result.message}`);
  }
  return result;
}

function expectCliError(result: Config | CliError): CliError {
  if (!(result instanceof CliError)) {
    throw new Error('expected a CliError but got a Config');
  }
  return result;
}

describe('resolveConfig', () => {
  it('applies defaults when only the api key is provided', () => {
    const cfg = expectConfig(resolveConfig(['--api-key', 'secret'], {}));
    expect(cfg.port).toBe(5175);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.backendUrl).toBe('http://localhost:8080');
    expect(cfg.timeoutMs).toBe(10000);
    expect(cfg.authPassword).toBeNull();
    expect(cfg.open).toBe(false);
  });

  it('prefers flags over env over defaults for port', () => {
    const flagWins = expectConfig(
      resolveConfig(['--api-key', 'k', '--port', '3000'], { STUDIO_PORT: '4000' }),
    );
    expect(flagWins.port).toBe(3000);

    const envWins = expectConfig(resolveConfig(['--api-key', 'k'], { STUDIO_PORT: '4000' }));
    expect(envWins.port).toBe(4000);
  });

  it('prefers flags over env for backend-url and strips one trailing slash from env values too', () => {
    const flagWins = expectConfig(
      resolveConfig(
        ['--api-key', 'k', '--backend-url', 'http://flag.example'],
        { STUDIO_BACKEND_URL: 'http://env.example' },
      ),
    );
    expect(flagWins.backendUrl).toBe('http://flag.example');

    const envUsed = expectConfig(
      resolveConfig(['--api-key', 'k'], { STUDIO_BACKEND_URL: 'http://env.example/' }),
    );
    expect(envUsed.backendUrl).toBe('http://env.example');
  });

  it('reads the api key from the environment when the flag is absent', () => {
    const cfg = expectConfig(resolveConfig([], { STUDIO_API_KEY: 'envkey' }));
    expect(cfg.apiKey).toBe('envkey');
  });

  it('fails on missing api key mentioning both --api-key and STUDIO_API_KEY', () => {
    const err = expectCliError(resolveConfig([], {}));
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('--api-key');
    expect(err.message).toContain('STUDIO_API_KEY');
  });

  it('strips a single trailing slash from backend-url', () => {
    const one = expectConfig(
      resolveConfig(['--api-key', 'k', '--backend-url', 'http://x.test/'], {}),
    );
    expect(one.backendUrl).toBe('http://x.test');

    const two = expectConfig(
      resolveConfig(['--api-key', 'k', '--backend-url', 'http://x.test//'], {}),
    );
    expect(two.backendUrl).toBe('http://x.test/');
  });

  it('rejects invalid ports and names the offending flag', () => {
    for (const bad of ['abc', '0', '70000']) {
      const err = expectCliError(resolveConfig(['--api-key', 'k', '--port', bad], {}));
      expect(err.message).toContain('--port');
      expect(err.message).toContain(bad);
    }
    const negative = expectCliError(resolveConfig(['--api-key', 'k', '--port=-3'], {}));
    expect(negative.message).toContain('--port');
  });

  it('rejects invalid ports coming from the environment', () => {
    const err = expectCliError(resolveConfig([], { STUDIO_API_KEY: 'k', STUDIO_PORT: 'nope' }));
    expect(err.message).toContain('STUDIO_PORT');
  });

  it('rejects non-http(s) backend urls', () => {
    const notUrl = expectCliError(
      resolveConfig(['--api-key', 'k', '--backend-url', 'not a url'], {}),
    );
    expect(notUrl.message).toContain('--backend-url');

    const wrongScheme = expectCliError(
      resolveConfig(['--api-key', 'k', '--backend-url', 'ftp://x.test'], {}),
    );
    expect(wrongScheme.message).toContain('--backend-url');
  });

  it('clamps timeout-ms into 1000..120000', () => {
    const low = expectConfig(resolveConfig(['--api-key', 'k', '--timeout-ms', '5'], {}));
    expect(low.timeoutMs).toBe(1000);

    const high = expectConfig(resolveConfig(['--api-key', 'k', '--timeout-ms', '500000'], {}));
    expect(high.timeoutMs).toBe(120000);

    const mid = expectConfig(resolveConfig(['--api-key', 'k', '--timeout-ms', '30000'], {}));
    expect(mid.timeoutMs).toBe(30000);
  });

  it('rejects non-numeric timeout-ms', () => {
    const err = expectCliError(resolveConfig(['--api-key', 'k', '--timeout-ms', 'soon'], {}));
    expect(err.message).toContain('--timeout-ms');
  });

  it('maps unknown long flags to a friendly error pointing at --help', () => {
    const err = expectCliError(resolveConfig(['--nonsense'], { STUDIO_API_KEY: 'k' }));
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('--nonsense');
    expect(err.message).toContain('--help');
  });

  it('maps unknown short flags to a friendly error pointing at --help', () => {
    const err = expectCliError(resolveConfig(['-z'], { STUDIO_API_KEY: 'k' }));
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('--help');
  });

  it('returns a zero-exit usage error for --help even without an api key', () => {
    for (const argv of [['--help'], ['-h']]) {
      const err = expectCliError(resolveConfig(argv, {}));
      expect(err.exitCode).toBe(0);
      expect(err.message).toContain('--port');
      expect(err.message).toContain('--api-key');
    }
  });

  it('parses auth-password and open from flags or env', () => {
    const flagged = expectConfig(
      resolveConfig(['--api-key', 'k', '--auth-password', 'pw', '--open'], {}),
    );
    expect(flagged.authPassword).toBe('pw');
    expect(flagged.open).toBe(true);

    const viaEnv = expectConfig(
      resolveConfig([], { STUDIO_API_KEY: 'k', STUDIO_AUTH_PASSWORD: 'envpw' }),
    );
    expect(viaEnv.authPassword).toBe('envpw');
    expect(viaEnv.open).toBe(false);
  });
});
