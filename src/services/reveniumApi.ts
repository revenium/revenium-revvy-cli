import {
  REVENIUM_API_BASE_URL,
  REVENIUM_API_PATH_PREFIX,
  REVENIUM_METERING_PATH_PREFIX,
  ENV_VARS,
} from "../constants/api.js";

export interface ApiClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

interface UserMeResponse {
  id?: string;
  email?: string;
  tenant?: { id?: string; label?: string };
  teams?: Array<{ id?: string; label?: string }>;
  /** Hashed ID of the team the dashboard loads on login. */
  defaultTeamId?: string;
}

export class ReveniumApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ApiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl ||
      process.env[ENV_VARS.BASE_URL] ||
      REVENIUM_API_BASE_URL
    ).replace(/\/+$/, "");
  }

  private url(path: string): string {
    return `${this.baseUrl}${REVENIUM_API_PATH_PREFIX}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  /**
   * Probes connectivity by hitting `/users/me`. Any HTTP response (including
   * 401/403 for a bad key) proves the API gateway is reachable; only a network
   * exception means we can't reach the API.
   */
  async checkConnectivity(): Promise<ApiResponse<{ reachable: boolean }>> {
    try {
      const response = await fetch(this.url("/users/me"), {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      });

      return {
        ok: true,
        data: { reachable: true },
        status: response.status,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to Revenium API",
        data: { reachable: false },
      };
    }
  }

  isMeteringOnlyKey(): boolean {
    return this.apiKey.startsWith("rev_mk_");
  }

  /**
   * Verifies a metering-only key against the metering API.
   *
   * A `rev_mk_*` key cannot call `/users/me` — that path is in the platform
   * bucket and needs read or write scope — so the only surface that can prove
   * the key works is the ingestion endpoint itself. Posting an empty body
   * separates authentication from payload validation without ingesting
   * anything: the gateway authenticates first and rejects the body second.
   *
   *   valid key   -> 400 (auth passed, body rejected, nothing metered)
   *   bad key     -> 401 / 403
   *   unreachable -> inconclusive; the caller warns and continues
   */
  async verifyMeteringKey(): Promise<
    ApiResponse<{ valid: boolean; inconclusive?: boolean }>
  > {
    const url = `${this.baseUrl}${REVENIUM_METERING_PATH_PREFIX}/ai/completions`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          data: { valid: false },
          error:
            "Metering API key rejected (HTTP " +
            response.status +
            "). Check REVENIUM_METERING_API_KEY — it may be mistyped, revoked, " +
            "or issued for a different environment than --base-url points at.",
          status: response.status,
        };
      }

      // 400 is the expected answer for the empty probe body: the key
      // authenticated and the payload was rejected, which is what we wanted.
      if (response.status === 400) {
        return { ok: true, data: { valid: true }, status: response.status };
      }

      // Any other status (5xx, an unexpected 2xx, a proxy error) tells us
      // nothing definitive about the key. Don't block the run on it.
      return {
        ok: true,
        data: { valid: true, inconclusive: true },
        error: `Unexpected status ${response.status} while verifying the metering key`,
        status: response.status,
      };
    } catch (error) {
      return {
        ok: true,
        data: { valid: true, inconclusive: true },
        error:
          error instanceof Error
            ? error.message
            : "Could not reach the metering API",
      };
    }
  }

  async validateApiKey(): Promise<
    ApiResponse<{
      valid: boolean;
      orgName?: string;
      teamId?: string;
      meteringOnly?: boolean;
      /** True when the key could not be checked (API unreachable), not when it is bad. */
      unverified?: boolean;
    }>
  > {
    if (this.isMeteringOnlyKey()) {
      const probe = await this.verifyMeteringKey();
      if (!probe.ok || !probe.data?.valid) {
        return {
          ok: false,
          data: { valid: false },
          error: probe.error ?? "Metering API key rejected",
          status: probe.status,
        };
      }
      return {
        ok: true,
        data: {
          valid: true,
          meteringOnly: true,
          unverified: probe.data.inconclusive === true,
        },
        error: probe.data.inconclusive ? probe.error : undefined,
      };
    }

    try {
      const response = await fetch(this.url("/users/me"), {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as UserMeResponse;
        // `teams` carries no documented ordering, so teams[0] is not
        // necessarily the team the user works in. Prefer the team named by
        // `defaultTeamId` (what the dashboard loads on login) and keep
        // teams[0] as the fallback for responses that omit it.
        const team =
          data.teams?.find((candidate) => candidate.id === data.defaultTeamId) ??
          data.teams?.[0];
        const orgName =
          team?.label || data.tenant?.label || "Unknown Organization";
        const teamId = team?.id ?? data.defaultTeamId ?? data.tenant?.id;
        return {
          ok: true,
          data: { valid: true, orgName, teamId },
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          data: { valid: false },
          error: "Invalid API key. Please check your REVENIUM_METERING_API_KEY.",
          status: response.status,
        };
      }

      return {
        ok: false,
        data: { valid: false },
        error: `API returned status ${response.status}`,
        status: response.status,
      };
    } catch (error) {
      return {
        ok: false,
        data: { valid: false },
        error:
          error instanceof Error
            ? error.message
            : "Failed to validate API key",
      };
    }
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
