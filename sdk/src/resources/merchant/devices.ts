import type { HttpRequester } from "../../core/http.js";
import type { BalancePoint, Calibration } from "../../core/types.js";
import { mapBalancePoint, mapCalibration } from "../mapping.js";

/** Input for {@link DevicesMerchantResource.calibrate}. */
export interface MerchantCalibrateBalanceInput {
  providerId: string;
  /** Observed balance as a decimal string (e.g. `"24500.50"`). */
  balance: string;
  note?: string;
}

/**
 * Merchant-domain device-balance operations under `/api/v1/devices`.
 * Requires a business API key and ownership of the targeted device.
 */
export class DevicesMerchantResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Latest known balance for the device/provider pair. */
  async balance(deviceId: string, providerId: string): Promise<BalancePoint> {
    const payload = await this.http.request<unknown>(
      "GET",
      `/api/v1/devices/${encodeURIComponent(deviceId)}/balance`,
      { query: { provider_id: providerId } },
    );
    return mapBalancePoint(payload);
  }

  /** Record an explicit balance calibration for the device/provider pair. */
  async calibrate(deviceId: string, input: MerchantCalibrateBalanceInput): Promise<Calibration> {
    const payload = await this.http.request<unknown>(
      "POST",
      `/api/v1/devices/${encodeURIComponent(deviceId)}/calibrate-balance`,
      {
        body: {
          provider_id: input.providerId,
          balance: input.balance,
          ...(input.note !== undefined && input.note !== "" && { note: input.note }),
        },
      },
    );
    return mapCalibration(payload);
  }
}
