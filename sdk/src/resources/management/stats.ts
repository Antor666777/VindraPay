import type { HttpRequester } from "../../core/http.js";
import type { StudioStats } from "../../core/types.js";
import { mapStudioStats } from "../mapping.js";

/**
 * Management-domain Studio dashboard counters (`GET /manage/v1/stats`).
 *
 * The backend reports snake_case detail counters; the returned
 * {@link StudioStats} maps them onto the camelCase summary fields (missing
 * counters map to `0`) and keeps the wire counters as extra optional fields.
 */
export class StatsResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Load aggregate platform counters. */
  async get(): Promise<StudioStats> {
    const payload = await this.http.request<unknown>("GET", "/manage/v1/stats");
    return mapStudioStats(payload);
  }
}
