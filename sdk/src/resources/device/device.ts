import { ValidationError } from "../../core/errors.js";
import type { HttpRequester } from "../../core/http.js";
import type {
  HeartbeatResult,
  InboundMessage,
  IngestResult,
} from "../../core/types.js";
import { mapHeartbeatResult } from "../mapping.js";

/** Input for {@link DeviceResource.heartbeat}. */
export interface HeartbeatInput {
  appVersion?: string;
  osVersion?: string;
}

export const MAX_BATCH_MESSAGES = 50;

/**
 * Device-domain API (`/device/v1`).
 *
 * Authenticates with a per-device pairing token (`vdt_...`); construct via
 * {@link VindraPay.device}.
 */
export class DeviceResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /**
   * Report liveness (optionally updating app/os metadata) and receive the
   * active provider templates the device should listen for.
   */
  async heartbeat(input: HeartbeatInput = {}): Promise<HeartbeatResult> {
    const payload = await this.http.request<unknown>("POST", "/device/v1/heartbeat", {
      body: {
        ...(input.appVersion !== undefined && input.appVersion !== "" && { app_version: input.appVersion }),
        ...(input.osVersion !== undefined && input.osVersion !== "" && { os_version: input.osVersion }),
      },
    });
    return mapHeartbeatResult(payload);
  }

  /**
   * Submit a batch of 1..50 inbound SMS messages for parsing/verification.
   *
   * Batch size and required fields are validated **client-side**; invalid
   * calls throw {@link ValidationError} before any network traffic.
   *
   * @returns One result per submitted message, in order, with statuses
   * `parsed | duplicate | unmatched | skipped | error`.
   */
  async sendMessages(messages: readonly InboundMessage[]): Promise<IngestResult[]> {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_BATCH_MESSAGES) {
      throw new ValidationError(
        `messages must contain between 1 and ${MAX_BATCH_MESSAGES} items`,
      );
    }
    for (const [index, message] of messages.entries()) {
      if (typeof message?.clientMsgId !== "string" || message.clientMsgId === "") {
        throw new ValidationError(`messages[${index}].clientMsgId is required`);
      }
      if (typeof message?.body !== "string" || message.body === "") {
        throw new ValidationError(`messages[${index}].body is required`);
      }
    }
    const payload = await this.http.request<{ results?: unknown }>("POST", "/device/v1/messages", {
      body: {
        messages: messages.map((message) => ({
          client_msg_id: message.clientMsgId,
          ...(message.senderId !== undefined && message.senderId !== "" && { sender_id: message.senderId }),
          body: message.body,
          ...(message.deviceReceivedAt !== undefined &&
            message.deviceReceivedAt !== "" && { device_received_at: message.deviceReceivedAt }),
        })),
      },
    });
    const results = (typeof payload === "object" && payload !== null ? payload : {}) as {
      results?: unknown;
    };
    return (Array.isArray(results.results) ? results.results : []).map((raw) => {
      const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        clientMsgId: typeof record["client_msg_id"] === "string" ? record["client_msg_id"] : null,
        status: record["status"] as IngestResult["status"],
        ...(record["error"] !== undefined && { error: record["error"] as string | null }),
      };
    });
  }
}
