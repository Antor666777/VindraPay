# vindrapay-sdk

Official TypeScript SDK for the VindraPay payment-verification API. Covers all three
surfaces of a VindraPay deployment:

| Client | Auth | Unlocks |
| ------ | ---- | ------- |
| `vp.management(key)` | Management API key (`.env`: `MANAGEMENT_API_KEY`) | `/manage/v1/*` — businesses, keys, devices, all data views, stats |
| `vp.merchant(key)` | Merchant API key (`vpk_…`) | `/api/v1/*` — orders, providers, calibration |
| `vp.device(token)` | Device token (`vdt_…`) | `/device/v1/*` — heartbeat, SMS ingest |

Zero runtime dependencies. Node >= 18 (native fetch). Dual ESM/CJS builds with full types.

## Install

```bash
pnpm add vindrapay-sdk
```

## Quickstart

### Operator (management key)

```ts
import { VindraPay } from "vindrapay-sdk";

const vp = new VindraPay({ baseUrl: "http://localhost:8080" });
const mgmt = vp.management(process.env.MANAGEMENT_API_KEY!);

const biz = await mgmt.businesses.create({
  name: "Acme",
  ownerEmail: "owner@acme.test",
});

const { token } = await mgmt.apiKeys.create(biz.id, { label: "prod" });
console.log("Merchant key (shown once):", token);

const stats = await mgmt.stats.get();
console.log(`${stats.transactionsToday} transactions today`);

for await (const tx of mgmt.transactions.listAll({ businessId: biz.id })) {
  console.log(tx.trxId, tx.amount, tx.direction);
}
```

### Merchant server

```ts
const merchant = vp.merchant(process.env.MERCHANT_API_KEY!);

await merchant.orders.create({
  externalOrderId: "order-42",
  expectedAmount: "500",
});

const order = await merchant.orders.get("order-42");
if (order.status === "pending") {
  // ask the customer for their TrxID, then:
  const verify = await merchant.orders.verify("order-42", { trxId: customerTrxId });
  console.log(verify.result); // success | already_used | amount_mismatch | …
}
```

### SMS-gateway integrations (device domain)

```ts
const device = vp.device(process.env.DEVICE_TOKEN!);
await device.heartbeat({ appVersion: "gateway-1" });
await device.sendMessages([
  {
    clientMsgId: crypto.randomUUID(),
    senderId: "bKash",
    body: smsText,
    deviceReceivedAt: new Date().toISOString(),
  },
]);
```

## Error handling

Every failure throws a typed `VindraPayError` subclass:

```ts
import {
  AuthenticationError,
  ConflictError,
  RateLimitError,
} from "vindrapay-sdk";

try {
  await merchant.orders.verify("order-1", { trxId });
} catch (e) {
  if (e instanceof RateLimitError) retryLater(e.retryAfterSeconds);
  else if (e instanceof ConflictError) console.log(e.code); // already_used, …
  else throw e;
}
```

## Pagination

List endpoints return `{ items, total }`; every list has a `listAll()` async iterator
that walks all pages for you:

```ts
for await (const provider of mgmt.providers.listAll()) {
  console.log(provider.name, provider.matchMode);
}
```

## Live end-to-end tests

Against a real backend (creates a business + key + device, runs a full payment,
cleans up after itself):

```bash
SDK_E2E_URL=http://localhost:8080 \
SDK_E2E_MANAGEMENT_KEY=<management key> \
pnpm test:e2e
```

## License

MIT
