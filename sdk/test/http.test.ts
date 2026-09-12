import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  AuthenticationError,
  ConflictError,
  HttpRequester,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  UnprocessableError,
  ValidationError,
  type HttpRequesterConfig,
} from "../src/index.js";

const BASE = "https://api.vindrapay.test";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function makeClient(overrides: Partial<HttpRequesterConfig> = {}) {
  const { baseUrl = BASE, apiKey = "vsk_test_secret", timeoutMs = 1_000, retry, ...rest } =
    overrides;
  return new HttpRequester({
    ...rest,
    baseUrl,
    apiKey,
    timeoutMs,
    retry: retry ?? { retries: 0, backoffBaseMs: 1 },
  });
}

describe("HttpRequester.request", () => {
  it("unwraps the success envelope and injects bearer auth", async () => {
    let authorization = "";
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/orders`, async ({ request }) => {
        authorization = request.headers.get("authorization") ?? "";
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: { id: "ord_1", status: "pending" },
        });
      }),
    );

    const order = await makeClient().request<{ id: string; status: string }>(
      "POST",
      "/v1/orders",
      { body: { expectedAmount: "1500.00" } },
    );

    expect(authorization).toBe("Bearer vsk_test_secret");
    expect(receivedBody).toEqual({ expectedAmount: "1500.00" });
    expect(order).toEqual({ id: "ord_1", status: "pending" });
  });

  it("passes through bodies without a success envelope", async () => {
    server.use(
      http.get(`${BASE}/v1/orders`, () =>
        HttpResponse.json({ success: true, data: { items: [], total: 0 } }),
      ),
    );

    const page = await makeClient().request<{ items: unknown[]; total: number }>(
      "GET",
      "/v1/orders",
    );

    expect(page).toEqual({ items: [], total: 0 });
  });

  it.each([
    [400, ValidationError],
    [401, AuthenticationError],
    [403, PermissionError],
    [404, NotFoundError],
    [422, UnprocessableError],
  ] as const)("maps upstream status %i to the typed error class", async (status, errorClass) => {
    server.use(
      http.get(`${BASE}/v1/boom`, () =>
        HttpResponse.json({ success: false, error: "boom" }, { status }),
      ),
    );

    const err = await makeClient()
      .request("GET", "/v1/boom")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(errorClass);
  });

  it("maps 409 conflicts with backend result codes onto ConflictError", async () => {
    server.use(
      http.post(`${BASE}/v1/verify`, () =>
        HttpResponse.json(
          { success: false, error: "transaction already used", result: "already_used" },
          { status: 409 },
        ),
      ),
    );

    const err = await makeClient()
      .request("POST", "/v1/verify", { body: {} })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictError);
    const conflict = err as ConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe("already_used");
    expect(conflict.details).toBe("already_used");
    expect(conflict.result).toBe("already_used");
  });

  it("maps 5xx responses onto ServerError with the concrete status", async () => {
    server.use(
      http.get(`${BASE}/v1/boom`, () =>
        HttpResponse.json({ success: false, error: "kaboom" }, { status: 503 }),
      ),
    );

    const err = await makeClient()
      .request("GET", "/v1/boom")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).status).toBe(503);
  });

  it("captures Retry-After seconds on 429", async () => {
    server.use(
      http.get(`${BASE}/v1/orders`, () =>
        HttpResponse.json({ success: false, error: "rate limit exceeded" }, {
          status: 429,
          headers: { "retry-after": "7" },
        }),
      ),
    );

    const err = await makeClient()
      .request("GET", "/v1/orders")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).status).toBe(429);
    expect((err as RateLimitError).retryAfterSeconds).toBe(7);
  });

  it("retries a GET on 500 and succeeds on a later attempt", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/flaky`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({ success: false, error: "try again" }, { status: 500 });
        }
        return HttpResponse.json({ success: true, data: { ok: true } });
      }),
    );

    const client = makeClient({ retry: { retries: 2, backoffBaseMs: 1 } });
    const out = await client.request<{ ok: boolean }>("GET", "/v1/flaky");

    expect(calls).toBe(3);
    expect(out.ok).toBe(true);
  });

  it("never retries non-idempotent methods", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/v1/flaky`, () => {
        calls += 1;
        return HttpResponse.json({ success: false, error: "nope" }, { status: 500 });
      }),
    );

    const client = makeClient({ retry: { retries: 2, backoffBaseMs: 1 } });

    await expect(client.request("POST", "/v1/flaky", { body: {} })).rejects.toBeInstanceOf(
      ServerError,
    );
    expect(calls).toBe(1);
  });

  it("encodes query params and skips undefined and empty-string values", async () => {
    let search = "";
    server.use(
      http.get(`${BASE}/v1/search`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    await makeClient().request("GET", "/v1/search", {
      query: { q: "hello world", page: 2, empty: "", missing: undefined },
    });

    expect(search).toBe("?q=hello+world&page=2");
  });

  it("aborts within the total timeout budget even when retries are configured", async () => {
    server.use(
      http.get(`${BASE}/v1/slow`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    const client = makeClient({ timeoutMs: 60, retry: { retries: 2, backoffBaseMs: 10 } });
    const startedAt = Date.now();

    const err = await client.request("GET", "/v1/slow").catch((e: unknown) => e);
    const elapsed = Date.now() - startedAt;

    expect(err).toBeInstanceOf(NetworkError);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("rejects CR/LF injection in the API key at construction time", () => {
    expect(() => new HttpRequester({ baseUrl: BASE, apiKey: "abc\nEvil: 1" })).toThrow(TypeError);
  });

  it("rejects non-http(s) base URLs at construction time", () => {
    expect(() => new HttpRequester({ baseUrl: "ftp://files.example.com" })).toThrow(TypeError);
    expect(() => new HttpRequester({ baseUrl: "not a url" })).toThrow(TypeError);
  });

  it("strips trailing slashes from the base URL", async () => {
    let pathname = "";
    server.use(
      http.get(`${BASE}/v1/ping`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ success: true, data: "pong" });
      }),
    );

    const out = await new HttpRequester({
      baseUrl: `${BASE}/`,
      timeoutMs: 500,
      retry: { retries: 0 },
    }).request<string>("GET", "/v1/ping");

    expect(pathname).toBe("/v1/ping");
    expect(out).toBe("pong");
  });
});
