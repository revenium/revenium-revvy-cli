import { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { access } from "fs/promises";
import { join } from "path";
import { colors } from "../../constants/colors.js";
import type {
  SetupMode,
  BillingProvidersResult,
} from "../../types/revvy-state.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import { getProviderSyncMetadata } from "../../constants/billingProviders.js";
import {
  REVENIUM_DASHBOARD_URL,
  DASHBOARD_PATHS,
} from "../../constants/api.js";
import { FEATURE_FLAGS } from "../../feature-flags.js";
import { getInstallCommand } from "../instrument/instrumenter.js";
import { detectPackageManager, type PackageManagerInfo } from "../../utils/package-manager.js";

interface Detected3PAgent {
  name: string;
  configFile: string;
}

const THREE_P_AGENTS = [
  { name: "CodeRabbit", files: [".coderabbit.yml", ".coderabbit.yaml"] },
  { name: "Greptile", files: [".greptile.yml", ".greptile.yaml", ".greptile"] },
];

async function detect3PAgents(targetDir: string): Promise<Detected3PAgent[]> {
  const found: Detected3PAgent[] = [];
  for (const agent of THREE_P_AGENTS) {
    for (const file of agent.files) {
      try {
        await access(join(targetDir, file));
        found.push({ name: agent.name, configFile: file });
        break;
      } catch {
        // file doesn't exist
      }
    }
  }
  return found;
}

interface CompleteProps {
  setupMode: SetupMode | null;
  targetDir: string;
  generatedFiles: string[];
  meteringDesign: MeteringDesign | null;
  billingProvidersResult: BillingProvidersResult | null;
  onBackToMenu?: () => void;
}

export function Complete({
  setupMode,
  targetDir,
  generatedFiles,
  meteringDesign,
  billingProvidersResult,
  onBackToMenu,
}: CompleteProps) {
  const { exit } = useApp();
  const [detected3PAgents, setDetected3PAgents] = useState<Detected3PAgent[]>([]);
  const [pmInfo, setPmInfo] = useState<PackageManagerInfo | undefined>(undefined);

  useEffect(() => {
    if (FEATURE_FLAGS.CI_3P_AGENT_DETECTION) {
      detect3PAgents(targetDir).then(setDetected3PAgents);
    }
    if (meteringDesign?.detectedLanguage === "node") {
      detectPackageManager(targetDir).then(setPmInfo).catch(() => undefined);
    }
  }, [targetDir, meteringDesign?.detectedLanguage]);

  useInput((input) => {
    if (input === "m" || input === "M") {
      onBackToMenu?.();
    }
    if (input === "q" || input === "Q") {
      exit();
    }
  });
  const isBillingOnly = setupMode === "billing";
  const hasBilling = setupMode === "billing" || setupMode === "both";
  const hasInstrumentation = setupMode === "instrumentation" || setupMode === "both";

  // Determine if billing had any successes
  const billingSuccessCount =
    billingProvidersResult?.credentials.filter((c) => c.success).length ?? 0;
  const billingAllFailed =
    hasBilling && billingProvidersResult != null && billingSuccessCount === 0;

  // Overall success: at least one thing worked
  const overallSuccess = !billingAllFailed || hasInstrumentation;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {overallSuccess ? (
          <Text bold color={colors.success}>
            {"  "}Setup complete!
          </Text>
        ) : (
          <Text bold color={colors.warning}>
            {"  "}Setup finished with issues.
          </Text>
        )}
      </Box>

      {/* Billing providers summary */}
      {hasBilling && billingProvidersResult && (
        <Box flexDirection="column">
          <Text bold>Billing providers:</Text>
          {billingProvidersResult.credentials.map((cred) => {
            const sync = getProviderSyncMetadata(cred.provider);
            return (
              <Box key={cred.provider} flexDirection="column">
                <Text>
                  {"  "}
                  <Text color={cred.success ? colors.success : colors.error}>
                    {cred.success ? "✓" : "✗"}
                  </Text>{" "}
                  {cred.credentialName}
                  {cred.success && (
                    <Text dimColor>
                      {" "}— data in ~{sync.expectedTimeRange}
                    </Text>
                  )}
                  {!cred.success && (
                    <Text color={colors.error}> — {cred.errorMessage}</Text>
                  )}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      
      {hasInstrumentation && generatedFiles.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Generated files:</Text>
          {generatedFiles.map((file) => (
            <Text key={file} color={colors.primary}>
              {"  "}{file}
            </Text>
          ))}
        </Box>
      )}

     
      {hasInstrumentation && meteringDesign && (
        <Box flexDirection="column">
          <Text bold>Metering design:</Text>
          <Text>
            {"  "}Tracking: <Text color={colors.primary}>{meteringDesign.trackingGoal}</Text>
          </Text>
          <Text>
            {"  "}Providers:{" "}
            <Text color={colors.primary}>
              {meteringDesign.detectedProviders.join(", ") || "None detected"}
            </Text>
          </Text>
          {meteringDesign.products.length > 0 && (
            <Text>
              {"  "}Products:{" "}
              <Text color={colors.primary}>
                {meteringDesign.products.map((p) => p.name).join(", ")}
              </Text>
            </Text>
          )}
          {meteringDesign.agents.length > 0 && (
            <Text>
              {"  "}Agents:{" "}
              <Text color={colors.primary}>
                {meteringDesign.agents.map((a) => a.name).join(", ")}
              </Text>
            </Text>
          )}
        </Box>
      )}

      {/* Next steps */}
      <Box flexDirection="column">
        <Text bold>Next steps:</Text>

        {isBillingOnly && (
          <>
            <Text>
              {"  "}Check your billing dashboard for incoming data:
            </Text>
            <Text color={colors.primary}>
              {"  "}{REVENIUM_DASHBOARD_URL}{DASHBOARD_PATHS.PROVIDERS}
            </Text>
          </>
        )}

        {hasInstrumentation && meteringDesign && (() => {
          const language = meteringDesign.detectedLanguage;
          return (
            <>
              <Text>{"  "}1. Install the Revenium SDK + your provider SDKs:</Text>
              <Text color={colors.primary}>
                {"     "}{getInstallCommand(meteringDesign, pmInfo)}
              </Text>
              {pmInfo?.isMonorepo && (
                <Text dimColor>
                  {"     "}↳ monorepo detected — scope to your runtime workspace if needed
                </Text>
              )}

              <Text>{"  "}2. Set your API key (or put it in .env):</Text>
              <Text color={colors.primary}>
                {"     "}export REVENIUM_METERING_API_KEY=rev_mk_...
              </Text>

              <Text>{"  "}3. Use the generated helper in your AI call sites:</Text>
              {language === "node" &&
                meteringDesign.detectedProviders.some(
                  (p) => p === "OpenAI" || p === "Azure OpenAI",
                ) && (
                  <>
                    <Text dimColor>{"     "}OpenAI (method-chain pattern):</Text>
                    <Text color={colors.primary}>
                      {"     "}
                      import {"{"} openai, createUsageMetadata {"}"} from
                      "./revenium-config.js";
                    </Text>
                    <Text color={colors.primary}>
                      {"     "}
                      await openai.chat().completions().create(params,
                      createUsageMetadata({"{...}"}));
                    </Text>
                  </>
                )}
              {language === "python" && (
                <Text color={colors.primary}>
                  {"     "}from revenium_config import create_usage_metadata
                </Text>
              )}

              <Text>
                {"  "}4. Run your app and check the dashboard for live events:
              </Text>
              <Text color={colors.primary}>
                {"     "}
                {REVENIUM_DASHBOARD_URL}{DASHBOARD_PATHS.DASHBOARD}
              </Text>
            </>
          );
        })()}
      </Box>

      {detected3PAgents.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.warning}>
            Third-party code review tools detected:
          </Text>
          {detected3PAgents.map((agent) => (
            <Text key={agent.name} dimColor>
              {"  "}• {agent.name} (found <Text color={colors.primary}>{agent.configFile}</Text>)
            </Text>
          ))}
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{"  "}Add this to their configuration (optional):</Text>
            <Box marginTop={1} marginLeft={2} flexDirection="column" borderStyle="single" borderColor={colors.muted} paddingX={1} paddingY={0}>
              <Text>All AI API calls (OpenAI, Anthropic, Google, etc.) must include</Text>
              <Text>Revenium instrumentation. Flag any PR that adds a raw AI call</Text>
              <Text>without usage_metadata or a @track_as_* decorator.</Text>
              <Text>See revenium_config for the project's metering utilities.</Text>
            </Box>
          </Box>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={colors.primary} bold>m</Text> to go back to menu
            {" · "}
            <Text color={colors.muted} bold>q</Text> to quit
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
