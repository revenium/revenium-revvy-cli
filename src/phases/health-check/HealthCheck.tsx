import { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../../constants/colors.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useHealthCheck } from "./useHealthCheck.js";
import type { HealthCheckResult } from "../../types/revvy-state.js";
import { ENV_VARS, REVENIUM_DASHBOARD_URL, DASHBOARD_PATHS } from "../../constants/api.js";
import { hasReveniumInDeps } from "../../utils/hasReveniumInDeps.js";

interface HealthCheckProps {
  apiKey?: string;
  targetDir: string;
  onSetApiKey: (key: string) => void;
  onComplete: (result: HealthCheckResult) => void;
}

export function HealthCheck({
  apiKey,
  targetDir,
  onSetApiKey,
  onComplete,
}: HealthCheckProps) {
  const { exit } = useApp();
  const [inputKey, setInputKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | undefined>(undefined);
  const [isNewUser, setIsNewUser] = useState(false);
  const state = useHealthCheck({ apiKey, onComplete });

  useEffect(() => {
    hasReveniumInDeps(targetDir).then((found) => setIsNewUser(!found));
  }, [targetDir]);

  const hasFailed =
    state.step === "done" &&
    (state.keyValid === false || state.connectivity === false);

  useInput((input) => {
    if (!hasFailed) return;
    if (input === "r" || input === "R") {
      setFailedKey(undefined);
      setInputKey("");
      onSetApiKey("");
    }
    if (input === "q" || input === "Q") {
      exit();
    }
  });

  // Track failures so we can show "try again" after a failed attempt
  if (hasFailed && failedKey === undefined) {
    setFailedKey(apiKey);
  }

  if (
    state.step === "needs-key" ||
    (!apiKey && state.step !== "checking-connectivity")
  ) {
    return (
      <Box flexDirection="column" gap={1}>
        {/* New user intro — only shown when Revenium SDK is not in deps */}
        {isNewUser && !failedKey && (
          <Box
            flexDirection="column"
            marginBottom={1}
            borderStyle="round"
            borderColor={colors.primary}
            paddingX={2}
            paddingY={1}
          >
            <Text bold color={colors.primary}>
              New to Revenium? Here's the 30-second version:
            </Text>
            <Text> </Text>
            <Text>
              Revenium tracks the true cost of your AI calls and ties them to
            </Text>
            <Text>
              business context (which customer, which product, which agent).
            </Text>
            <Text> </Text>
            <Text>
              <Text bold>Time estimate:</Text> 15–30 minutes for the full setup.
            </Text>
          </Box>
        )}

        {/* Info card — always shown for every user */}
        {!failedKey && (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold>What this will do:</Text> scan your code, ask a few
              questions about your setup, then generate the config and middleware
              imports so every AI call reports usage to your Revenium dashboard.
            </Text>
            <Text>
              <Text bold>Scope:</Text> only reads and modifies files in{" "}
              <Text color={colors.primary}>{targetDir}</Text>.
              Backups are created before any changes.
            </Text>
            <Text>
              <Text bold>Privacy:</Text> your code stays local. Only metering
              metadata (token counts, model names) is sent to Revenium — never
              prompts, responses, or API keys.
            </Text>
          </Box>
        )}
        {failedKey && (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color={colors.error} bold>
                ✗
              </Text>
              <Text color={colors.error}>
                API key invalid. Please check your key and try again.
              </Text>
            </Box>
          </Box>
        )}
        <Text bold color={colors.warning}>
          {failedKey ? "Enter a different API key:" : "No API key found."}
        </Text>
        <Text dimColor>
          Set the <Text color={colors.primary}>{ENV_VARS.API_KEY}</Text>{" "}
          environment variable or enter it below.
        </Text>
        <Text dimColor>
          Get your API key at <Text color={colors.primary}>{REVENIUM_DASHBOARD_URL}{DASHBOARD_PATHS.SDK_SETUP}</Text>
        </Text>
        <Box gap={1}>
          <Text color={colors.primary}>›</Text>
          <TextInput
            value={inputKey}
            onChange={setInputKey}
            onSubmit={(val) => {
              if (val.trim()) {
                setFailedKey(undefined);
                onSetApiKey(val.trim());
              }
            }}
            placeholder="rev_mk_..."
            mask="*"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Checking prerequisites...</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.connectivity === null && (
          <Spinner label="Checking API connectivity..." />
        )}
        {state.connectivity === true && (
          <StatusLine icon="✓" label="API reachable" status="success" />
        )}
        {state.connectivity === false && (
          <StatusLine
            icon="✗"
            label="Cannot reach Revenium API"
            value={state.errorMessage}
            status="error"
          />
        )}

        {state.step === "validating-key" && (
          <Spinner label="Validating API key..." />
        )}
        {state.keyValid === true && (
          <StatusLine
            icon="✓"
            label="API key valid"
            value={state.meteringOnly ? "(metering-only)" : state.orgName ? `(org: ${state.orgName})` : undefined}
            status="success"
          />
        )}
        {state.keyValid === false && state.step === "done" && (
          <>
            <StatusLine
              icon="✗"
              label="API key invalid"
              status="error"
            />
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Your API key is invalid or expired. You need a <Text bold>Metering API Key</Text> (starts with <Text color={colors.primary}>rev_mk_</Text>).
              </Text>
              <Text dimColor>
                Get it at <Text color={colors.primary}>{REVENIUM_DASHBOARD_URL}{DASHBOARD_PATHS.SDK_SETUP}</Text>
              </Text>
              <Text dimColor>
                Press{" "}
                <Text color={colors.primary} bold>
                  r
                </Text>{" "}
                to retry with a different key
                {" · "}
                <Text color={colors.muted} bold>
                  q
                </Text>{" "}
                to quit
              </Text>
            </Box>
          </>
        )}

        {state.connectivity === false && state.step === "done" && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Press{" "}
              <Text color={colors.primary} bold>
                r
              </Text>{" "}
              to retry
              {" · "}
              <Text color={colors.muted} bold>
                q
              </Text>{" "}
              to quit
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
