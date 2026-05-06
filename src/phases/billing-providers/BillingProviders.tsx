import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../../constants/colors.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useBillingProviders } from "./useBillingProviders.js";
import type { BillingProvidersResult } from "../../types/revvy-state.js";
import {
  BILLING_PROVIDERS,
  getProviderSyncMetadata,
} from "../../constants/billingProviders.js";
import {
  REVENIUM_DASHBOARD_URL,
  DASHBOARD_PATHS,
} from "../../constants/api.js";

interface BillingProvidersProps {
  apiKey: string;
  teamId: string;
  onComplete: (result: BillingProvidersResult) => void;
  onBack?: () => void;
}

function ProviderMultiSelect({
  onSubmit,
  onBack,
}: {
  onSubmit: (values: string[]) => void;
  onBack: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : BILLING_PROVIDERS.length - 1
      );
    }
    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < BILLING_PROVIDERS.length - 1 ? prev + 1 : 0
      );
    }
    if (input === " ") {
      const value = BILLING_PROVIDERS[selectedIndex]!.value;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    }
    if (key.return && selected.size > 0) {
      onSubmit(Array.from(selected));
    }
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={colors.primary} bold>
          ?
        </Text>
        <Text bold>Which providers do you want to connect?</Text>
      </Box>
      <Text dimColor>
        {"  "}Link your AI provider accounts to see all billing data in one
        place.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {BILLING_PROVIDERS.map((provider, index) => {
          const isSelected = selected.has(provider.value);
          const isFocused = index === selectedIndex;
          return (
            <Box key={provider.value} gap={1}>
              <Text color={isFocused ? colors.primary : colors.muted}>
                {isFocused ? ">" : " "}
              </Text>
              <Text color={isSelected ? colors.success : colors.muted}>
                {isSelected ? "[x]" : "[ ]"}
              </Text>
              <Text
                color={isFocused ? colors.primary : undefined}
                bold={isFocused}
              >
                {provider.label}
              </Text>
              {isFocused && (
                <Text dimColor> — {provider.helpText}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Text dimColor>
        {"  "}Space to toggle, Enter to confirm ({selected.size} selected) · Esc to go back
      </Text>
    </Box>
  );
}

function ApiKeyInput({
  provider,
  error,
  onSubmit,
  onBack,
}: {
  provider: (typeof BILLING_PROVIDERS)[number];
  error?: string;
  onSubmit: (key: string) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      {error && (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text color={colors.error} bold>✗</Text>
            <Text color={colors.error}>{error}</Text>
          </Box>
          <Text dimColor>{"  "}Please try again with a valid key, or press Tab to skip this provider.</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={colors.primary} bold>
            ?
          </Text>
          <Text bold>
            Enter your <Text color={colors.primary}>{provider.label}</Text> API key
          </Text>
        </Box>
        <Text dimColor>{"  "}{provider.helpText}</Text>
      </Box>
      <Box gap={1}>
        <Text color={colors.primary}>{">"}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(val) => {
            if (val.trim()) onSubmit(val.trim());
          }}
          placeholder={provider.placeholder}
          mask="*"
        />
      </Box>
      <Text dimColor>
        {"  "}Tab to skip this provider • Esc to go back to provider selection
      </Text>
    </Box>
  );
}

export function BillingProviders({
  apiKey,
  teamId,
  onComplete,
  onBack,
}: BillingProvidersProps) {
  const { state, selectProviders, submitKey, skipProvider, goBackToSelection, confirmResults } =
    useBillingProviders({
      apiKey,
      teamId,
      onComplete,
    });

  const { step } = state;

  useInput((input, key) => {
    // tab to skip (only during enter-key phase)
    if (input === "\t" && step.type === "enter-key") {
      skipProvider();
    }
    // any key to continue from results screen
    if (step.type === "results" && (key.return || input)) {
      confirmResults();
    }
  });

  if (step.type === "select-providers") {
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Connect your AI billing providers</Text>
          <Text dimColor>
            {"  "}Link external accounts (OpenAI, Anthropic, etc.) to import
            historical usage and see centralized billing data in your Revenium
            dashboard.
          </Text>
        </Box>
        <ProviderMultiSelect onSubmit={selectProviders} onBack={() => onBack?.()} />
      </Box>
    );
  }

  if (step.type === "enter-key") {
    const provider = state.selectedProviders[step.providerIndex]!;
    const total = state.selectedProviders.length;
    const current = step.providerIndex + 1;

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Provider {current} of {total}
        </Text>

        {/* Show previously completed providers */}
        {state.selectedProviders.slice(0, step.providerIndex).map((p) => (
          <StatusLine
            key={p.value}
            icon="check"
            label={`${p.label} key`}
            value="collected"
            status="success"
          />
        ))}

        <ApiKeyInput
          key={`${provider.value}-${step.error ?? ""}`}
          provider={provider}
          error={step.error}
          onSubmit={(key) => submitKey(provider.value, key)}
          onBack={goBackToSelection}
        />
      </Box>
    );
  }

  if (step.type === "submitting") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Connecting provider...</Text>
        <Spinner
          label={`Validating ${state.selectedProviders[step.currentIndex]?.label ?? "provider"} API key...`}
        />
      </Box>
    );
  }

  if (step.type === "results") {
    const results = state.completedResults;
    const successCount = results.filter((r) => r.success).length;
    const providersDashboardUrl = `${REVENIUM_DASHBOARD_URL}${DASHBOARD_PATHS.PROVIDERS}`;

    return (
      <Box flexDirection="column" gap={1}>
        {successCount > 0 ? (
          <Text bold color={colors.success}>
            {"  "}
            {successCount === results.length
              ? "All providers connected!"
              : `${successCount} of ${results.length} providers connected.`}
          </Text>
        ) : (
          <Text bold color={colors.error}>
            {"  "}No providers could be connected.
          </Text>
        )}

        <Box flexDirection="column">
          {results.map((r) => {
            if (r.success) {
              const sync = getProviderSyncMetadata(r.provider);
              return (
                <Box key={r.provider} flexDirection="column">
                  <StatusLine
                    icon="check"
                    label={r.credentialName}
                    status="success"
                  />
                  <Text dimColor>
                    {"    "}Data sync started. {sync.historicalSyncMessage}
                  </Text>
                </Box>
              );
            }
            return (
              <StatusLine
                key={r.provider}
                icon="cross"
                label={r.credentialName}
                value={r.errorMessage}
                status="error"
              />
            );
          })}
        </Box>

        {successCount > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>View your billing dashboard:</Text>
            <Text color={colors.primary}>{"  "}{providersDashboardUrl}</Text>
          </Box>
        )}

        <Text dimColor>
          {"  "}Press any key to continue...
        </Text>
      </Box>
    );
  }

  return null;
}
