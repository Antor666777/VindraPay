import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VindraPay } from "../../src/index.js";
import { baseUrl, e2eEnabled, managementKey } from "./env.js";

const d = e2eEnabled ? describe : describe.skip;

let suffix = "";
let bizId = "";
let merchantKey = "";
let deviceToken = "";
let mgmt: ReturnType<VindraPay["management"]>;

d("VindraPay SDK live E2E", () => {
  const vp = new VindraPay({ baseUrl });

  beforeAll(async () => {
    suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    mgmt = vp.management(managementKey);

    const biz = await mgmt.businesses.create({
      name: `sdk-e2e-${suffix}`,
      ownerEmail: `sdk-e2e-${suffix}@example.com`,
    });
    bizId = biz.id;

    const key = await mgmt.apiKeys.create(bizId, { label: "sdk-e2e" });
    merchantKey = key.token;

    const dev = await mgmt.devices.register(bizId, {
      name: `sdk-e2e-device-${suffix}`,
    });
    deviceToken = dev.token;

    await mgmt.providers.create({
      businessId: bizId,
      name: `sdk-e2e-prov-${suffix}`,
      senderId: "SDK_E2E",
      smsTemplate:
        "E2E payment: Tk {amount} from {sender}, balance {balance}, ref {trxId}",
      direction: "credit",
      matchMode: "template",
    });
  });

  afterAll(async () => {
    if (!bizId) return;
    try {
      const keys = await mgmt.apiKeys.list(bizId);
      for (const k of keys.items) {
        if (!k.revokedAt) await mgmt.apiKeys.revoke(k.id).catch(() => undefined);
      }
    } catch {
      /* cleanup is best-effort */
    }
    try {
      await mgmt.businesses.setStatus(bizId, "suspended").catch(() => undefined);
    } catch {
      /* cleanup is best-effort */
    }
  });

  it("heartbeats and receives the synced provider list", async () => {
    const device = vp.device(deviceToken);
    const hb = await device.heartbeat({ appVersion: "sdk-e2e" });
    expect(Array.isArray(hb.providers)).toBe(true);
  });

  it("creates an order through the merchant key", async () => {
    const merchant = vp.merchant(merchantKey);
    const order = await merchant.orders.create({
      externalOrderId: `sdk-e2e-${suffix}`,
      expectedAmount: "500",
    });
    expect(order.status).toBe("pending");
    expect(order.expectedAmount).toBe("500");
  });

  it("ingests a payment SMS end-to-end", async () => {
    const trxId = `E2E${suffix.slice(0, 10).toUpperCase()}`;
    const device = vp.device(deviceToken);
    const ingest = await device.sendMessages([
      {
        clientMsgId: randomUUID(),
        senderId: "SDK_E2E",
        body: `E2E payment: Tk 500 from 01712345678, balance 5,000, ref ${trxId}`,
      },
    ]);
    expect(ingest[0]?.status).toBe("parsed");
    expect(ingest[0]?.status).toBe("parsed");

    const merchant = vp.merchant(merchantKey);
    const verify = await merchant.orders.verify(`sdk-e2e-${suffix}`, {
      trxId,
    });
    expect(verify.result).toBe("success");
    expect(verify.order.status).toBe("paid");
  });

  it("exposes the transaction and attempt through management views", async () => {
    const trxId = `E2E${suffix.slice(0, 10).toUpperCase()}`;
    const txs = await mgmt.transactions.list({ businessId: bizId, limit: 50 });
    const mine = txs.items.find((t) => t.trxId === trxId);
    expect(mine).toBeDefined();
    expect(mine?.amount).toBe("500");

    const attempts = await mgmt.attempts.list({
      businessId: bizId,
      limit: 50,
    });
    const mineAttempt = attempts.items.find(
      (a) => a.result === "success" && a.submittedTrxId === trxId,
    );
    expect(mineAttempt).toBeDefined();
  });

  it("reports aggregate stats", async () => {
    const stats = await mgmt.stats.get();
    expect(stats.transactionsToday).toBeGreaterThanOrEqual(1);
  });
});
