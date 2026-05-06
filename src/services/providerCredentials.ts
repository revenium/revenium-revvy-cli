import {
  REVENIUM_API_BASE_URL,
  REVENIUM_API_PATH_PREFIX,
  ENV_VARS,
} from "../constants/api.js";
import type { ApiResponse } from "./reveniumApi.js";

interface CreateProviderCredentialParams {
  apiKey: string;
  provider: string;
  credentialName: string;
  description: string;
  providerApiKey: string;
  teamId: string;
}

/**
 * Creates a provider credential via the Revenium API.
 * Extracts `details.error` from the response body for specific validation failures.
 */
export async function createProviderCredential({
  apiKey,
  provider,
  credentialName,
  description,
  providerApiKey,
  teamId,
}: CreateProviderCredentialParams): Promise<
  ApiResponse<{
    id?: string;
    validationStatus?: string;
    validationError?: string;
  }>
> {
  const baseUrl = (
    process.env[ENV_VARS.BASE_URL] || REVENIUM_API_BASE_URL
  ).replace(/\/+$/, "");
  const url = `${baseUrl}${REVENIUM_API_PATH_PREFIX}/provider-credentials`;

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider,
        credentialName,
        description,
        apiKey: providerApiKey,
        teamId,
      }),
      signal: AbortSignal.timeout(15000),
    });

    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // non-JSON body
    }

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        data: {
          id: body?.id ? String(body.id) : undefined,
          validationStatus: body?.validationStatus
            ? String(body.validationStatus)
            : undefined,
          validationError: body?.validationError
            ? String(body.validationError)
            : undefined,
        },
      };
    }

    const details = body?.details as Record<string, unknown> | undefined;
    const detailError = details?.error ? String(details.error) : undefined;
    const detail =
      detailError ??
      (body?.message
        ? String(body.message)
        : response.status === 409
          ? "A credential for this provider already exists."
          : `HTTP ${response.status}`);

    return { ok: false, status: response.status, error: detail };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create provider credential",
    };
  }
}
