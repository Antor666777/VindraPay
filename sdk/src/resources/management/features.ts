import type { HttpRequester } from "../../core/http.js";
import type { Features } from "../../core/types.js";
import { mapFeatures } from "../mapping.js";

/** Management-domain feature flags (`GET /manage/v1/features`). */
export class FeaturesResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Load the feature flags advertised by the backend deployment. */
  async get(): Promise<Features> {
    const payload = await this.http.request<unknown>("GET", "/manage/v1/features");
    return mapFeatures(payload);
  }
}
