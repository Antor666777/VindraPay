import { VindraPay } from "vindrapay-sdk";

const vp = new VindraPay({ baseUrl: process.env.VINDRAPAY_URL ?? "http://localhost:8080" });

// Operator: create a business and issue its first merchant key.
const mgmt = vp.management(process.env.MANAGEMENT_API_KEY!);
const biz = await mgmt.businesses.create({ name: "My Shop", ownerEmail: "me@example.com" });
const { token } = await mgmt.apiKeys.create(biz.id, { label: "first-key" });
console.log("Store this merchant key safely:", token);

// Merchant: take an order and verify the customer's payment.
const merchant = vp.merchant(token);
await merchant.orders.create({
  externalOrderId: "order-1001",
  expectedAmount: "500",
});
const verify = await merchant.orders.verify("order-1001", { trxId: "9B7ACXYZ99" });
console.log("payment result:", verify.result);
