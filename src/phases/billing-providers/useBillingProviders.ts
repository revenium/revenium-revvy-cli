import { useState, useCallback } from "react";
import { createProviderCredential } from "../../services/providerCredentials.js";
import type {
  BillingProvidersResult,
  ProviderCredentialResult,
} from "../../types/revvy-state.js";
import {
  BILLING_PROVIDERS,
  type BillingProviderInfo,
} from "../../constants/billingProviders.js";
import { validateProviderKey } from "../../constants/validation.js";

interface SelectProvidersStep {
  type: "select-providers";
}

interface EnterKeyStep {
  type: "enter-key";
  providerIndex: number;
  error?: string;
  warning?: string;
}

interface SubmittingStep {
  type: "submitting";
  currentIndex: number;
}

interface ResultsStep {
  type: "results";
}

type Step = SelectProvidersStep | EnterKeyStep | SubmittingStep | ResultsStep;

export interface BillingProvidersState {
  step: Step;
  selectedProviders: BillingProviderInfo[];
  credentials: Map<string, string>;
  /** Accumulated results for all providers processed so far */
  completedResults: ProviderCredentialResult[];
}

interface UseBillingProvidersOptions {
  apiKey: string;
  teamId: string;
  onComplete: (result: BillingProvidersResult) => void;
}

export function useBillingProviders({
  apiKey,
  teamId,
  onComplete,
}: UseBillingProvidersOptions) {
  const [state, setState] = useState<BillingProvidersState>({
    step: { type: "select-providers" },
    selectedProviders: [],
    credentials: new Map(),
    completedResults: [],
  });

  const selectProviders = useCallback((providerValues: string[]) => {
    const selected = providerValues
      .map((v) => BILLING_PROVIDERS.find((p) => p.value === v))
      .filter((p): p is BillingProviderInfo => p != null);

    if (selected.length === 0) return;

    setState((prev) => ({
      ...prev,
      selectedProviders: selected,
      completedResults: [],
      step: { type: "enter-key", providerIndex: 0 },
    }));
  }, []);

  const submitKey = useCallback(
    async (providerValue: string, key: string) => {
      const validation = validateProviderKey(providerValue, key);
      if (!validation.valid && validation.error && !validation.warning) {
        setState((prev) => ({
          ...prev,
          step: {
            type: "enter-key",
            providerIndex: (prev.step as EnterKeyStep).providerIndex,
            error: validation.error,
          },
        }));
        return;
      }

      setState((prev) => {
        const next = new Map(prev.credentials);
        next.set(providerValue, key);
        return {
          ...prev,
          credentials: next,
          step: {
            type: "submitting",
            currentIndex: (prev.step as EnterKeyStep).providerIndex,
          },
        };
      });

      const provider = BILLING_PROVIDERS.find((p) => p.value === providerValue)!;

      const response = await createProviderCredential({
        apiKey,
        provider: providerValue,
        credentialName: `${provider.label} Key`,
        description: "Connected via Revvy",
        providerApiKey: key,
        teamId,
      });

      if (!response.ok) {
        setState((prev) => ({
          ...prev,
          step: {
            type: "enter-key",
            providerIndex: prev.selectedProviders.findIndex(
              (p) => p.value === providerValue,
            ),
            error: response.error ?? "Failed to connect. Please check your API key and try again.",
          },
        }));
        return;
      }

      const result: ProviderCredentialResult = {
        provider: providerValue,
        credentialName: `${provider.label} Key`,
        success: true,
        validationStatus: response.data?.validationStatus,
      };

      setState((prev) => {
        const allResults = [...prev.completedResults, result];
        const currentIndex = prev.selectedProviders.findIndex(
          (p) => p.value === providerValue,
        );
        const nextIndex = currentIndex + 1;

        if (nextIndex < prev.selectedProviders.length) {
          return {
            ...prev,
            completedResults: allResults,
            step: { type: "enter-key", providerIndex: nextIndex },
          };
        }

        return {
          ...prev,
          completedResults: allResults,
          step: { type: "results" },
        };
      });
    },
    [apiKey, teamId],
  );

  /** called from the results screen when the user presses any key. */
  const confirmResults = useCallback(() => {
    const finalResult: BillingProvidersResult = {
      credentials: state.completedResults,
    };
    onComplete(finalResult);
  }, [state.completedResults, onComplete]);

  const skipProvider = useCallback(() => {
    setState((prev) => {
      const currentIndex = (prev.step as EnterKeyStep).providerIndex;
      const provider = prev.selectedProviders[currentIndex]!;

      const skipResult: ProviderCredentialResult = {
        provider: provider.value,
        credentialName: `${provider.label} Key`,
        success: false,
        errorMessage: "Skipped",
      };

      const allResults = [...prev.completedResults, skipResult];
      const nextIndex = currentIndex + 1;

      if (nextIndex < prev.selectedProviders.length) {
        return {
          ...prev,
          completedResults: allResults,
          step: { type: "enter-key", providerIndex: nextIndex },
        };
      }

      return {
        ...prev,
        completedResults: allResults,
        step: { type: "results" },
      };
    });
  }, []);

  const goBackToSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: { type: "select-providers" },
      selectedProviders: [],
      credentials: new Map(),
      completedResults: [],
    }));
  }, []);

  return {
    state,
    selectProviders,
    submitKey,
    skipProvider,
    goBackToSelection,
    confirmResults,
  };
}
