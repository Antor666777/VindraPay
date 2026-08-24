import { describe, expect, it } from 'vitest';
import { mapUpstreamError } from './proxy.js';

const EXPECTED_502_ENVELOPE = {
  statusCode: 502,
  payload: { success: false, error: 'backend unreachable' },
};

describe('mapUpstreamError', () => {
  it.each([
    ['ENOTFOUND'],
    ['ECONNREFUSED'],
    ['ECONNRESET'],
    ['ETIMEDOUT'],
    ['EAI_AGAIN'],
    ['EHOSTUNREACH'],
    ['UND_ERR_CONNECT_TIMEOUT'],
    ['UND_ERR_HEADERS_TIMEOUT'],
  ])('normalizes network error %s to the 502 envelope', (code) => {
    expect(mapUpstreamError(code)).toEqual(EXPECTED_502_ENVELOPE);
  });

  it.each([['FOO_BAR'], [''], [undefined]])(
    'returns null for unrecognized code %s',
    (code) => {
      expect(mapUpstreamError(code)).toBeNull();
    },
  );
});
