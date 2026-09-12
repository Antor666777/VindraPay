import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type {
  BalancePoint,
  Calibration,
  DeviceCreated,
  DeviceView,
} from "../../core/types.js";
import { mapBalancePoint, mapCalibration, mapDeviceCreated, mapDeviceView } from "../mapping.js";

/** Filters for {@link DevicesResource.list}. */
export interface DeviceListFilters {
  /** Restrict to devices paired with this business. */
  businessId?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

/** Input for {@link DevicesResource.register}. */
export interface DeviceRegisterInput {
  name: string;
}

/** Input for {@link DevicesResource.calibrate}. */
export interface CalibrateBalanceInput {
  providerId: string;
  /** Observed balance as a decimal string (e.g. `"24500.50"`). */
  balance: string;
  note?: string;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Management-domain access to paired devices (`/manage/v1/devices`).
 *
 * There is no single-device GET endpoint; use {@link list} instead.
 * Requires a management key.
 */
export class DevicesResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of devices as `{items,total}`. */
  async list(filters: DeviceListFilters = {}): Promise<Paged<DeviceView>> {
    const query: QueryParams = {
      business_id: filters.businessId,
      limit: filters.limit,
      offset: filters.offset,
    };
    const payload = await this.http.request<unknown>("GET", "/manage/v1/devices", { query });
    const record = payload as { items?: unknown[]; total?: number };
    return {
      items: (record.items ?? []).map(mapDeviceView),
      total: record.total ?? record.items?.length ?? 0,
    };
  }

  /** Iterate over every device across all pages. */
  listAll(filters: DeviceListFilters = {}): AsyncGenerator<DeviceView, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }

  /**
   * Pair a new device with a business. The raw `token` is returned exactly
   * once and must be stored on the device.
   */
  async register(businessId: string, input: DeviceRegisterInput): Promise<DeviceCreated> {
    const payload = await this.http.request<unknown>(
      "POST",
      `/manage/v1/businesses/${encodeURIComponent(businessId)}/devices`,
      { body: { name: input.name } },
    );
    return mapDeviceCreated(payload);
  }

  /** Deactivate a device; its token stops authenticating immediately. */
  async deactivate(deviceId: string): Promise<DeviceView> {
    const payload = await this.http.request<unknown>(
      "DELETE",
      `/manage/v1/devices/${encodeURIComponent(deviceId)}`,
    );
    return mapDeviceView(payload);
  }

  /** Latest known balance for the device/provider pair. */
  async balance(deviceId: string, providerId: string): Promise<BalancePoint> {
    const payload = await this.http.request<unknown>(
      "GET",
      `/manage/v1/devices/${encodeURIComponent(deviceId)}/balance`,
      { query: { provider_id: providerId } },
    );
    return mapBalancePoint(payload);
  }

  /** Record an explicit balance calibration for the device/provider pair. */
  async calibrate(deviceId: string, input: CalibrateBalanceInput): Promise<Calibration> {
    const payload = await this.http.request<unknown>(
      "POST",
      `/manage/v1/devices/${encodeURIComponent(deviceId)}/calibrate-balance`,
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
