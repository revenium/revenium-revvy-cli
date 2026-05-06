import { useState, useEffect, useRef } from "react";
import type { HealthCheckResult } from "../../types/revvy-state.js";
import { ReveniumApiClient } from "../../services/reveniumApi.js";

interface UseHealthCheckOptions {
  apiKey?: string;
  onComplete: (result: HealthCheckResult) => void;
}

interface HealthCheckState {
  step: "checking-connectivity" | "validating-key" | "done" | "needs-key";
  connectivity: boolean | null;
  keyValid: boolean | null;
  orgName?: string;
  meteringOnly?: boolean;
  errorMessage?: string;
}

export function useHealthCheck({ apiKey, onComplete }: UseHealthCheckOptions) {
  const [state, setState] = useState<HealthCheckState>({
    step: apiKey ? "checking-connectivity" : "needs-key",
    connectivity: null,
    keyValid: null,
  });

  const checkedKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!apiKey) {
      checkedKeyRef.current = undefined;
      return;
    }
    if (checkedKeyRef.current === apiKey) return;
    checkedKeyRef.current = apiKey;

    let cancelled = false;

    async function runChecks() {
      const client = new ReveniumApiClient({ apiKey: apiKey! });

      setState({
        step: "checking-connectivity",
        connectivity: null,
        keyValid: null,
      });
      const connectivityResult = await client.checkConnectivity();

      if (cancelled) return;

      if (!connectivityResult.ok && !connectivityResult.data?.reachable) {
        const result: HealthCheckResult = {
          apiKeyValid: false,
          apiReachable: false,
          errorMessage:
            connectivityResult.error ||
            "Cannot reach Revenium API. Check your internet connection.",
        };
        setState({
          step: "done",
          connectivity: false,
          keyValid: null,
          errorMessage: result.errorMessage,
        });
        onComplete(result);
        return;
      }

      setState((prev) => ({
        ...prev,
        connectivity: true,
        step: "validating-key",
      }));

      const keyResult = await client.validateApiKey();

      if (cancelled) return;

      const isMeteringOnly = keyResult.data?.meteringOnly ?? false;
      const result: HealthCheckResult = {
        apiKeyValid: keyResult.data?.valid ?? false,
        apiReachable: true,
        orgName: keyResult.data?.orgName,
        teamId: keyResult.data?.teamId,
        errorMessage: keyResult.error,
      };

      setState({
        step: "done",
        connectivity: true,
        keyValid: result.apiKeyValid,
        orgName: result.orgName,
        meteringOnly: isMeteringOnly,
        errorMessage: result.errorMessage,
      });

      onComplete(result);
    }

    runChecks();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // Derive needs-key from props rather than setting state in the effect
  if (!apiKey) {
    return { step: "needs-key" as const, connectivity: null, keyValid: null };
  }

  return state;
}
