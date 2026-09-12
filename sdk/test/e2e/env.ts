export const baseUrl = process.env.SDK_E2E_URL ?? "";
export const managementKey = process.env.SDK_E2E_MANAGEMENT_KEY ?? "";

export const e2eEnabled = Boolean(baseUrl && managementKey);
