import {
  REVENIUM_API_BASE_URL,
  REVENIUM_API_PATH_PREFIX,
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

  async validateApiKey(): Promise<
    ApiResponse<{ valid: boolean; orgName?: string; teamId?: string; meteringOnly?: boolean }>
  > {
    if (this.isMeteringOnlyKey()) {
      return {
        ok: true,
        data: { valid: true, meteringOnly: true },
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
        const orgName =
          data.teams?.[0]?.label ||
          data.tenant?.label ||
          "Unknown Organization";
        const teamId = data.teams?.[0]?.id ?? data.tenant?.id;
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
