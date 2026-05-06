import { Box, Static, useInput } from "ink";
import { Banner } from "./components/Banner.js";
import { StepIndicator } from "./components/StepIndicator.js";
import { useRevvyState } from "./hooks/useRevvyState.js";
import { Phase, getActivePhases } from "./types/revvy-state.js";
import { HealthCheck } from "./phases/health-check/HealthCheck.js";
import { SetupMode } from "./phases/setup-mode/SetupMode.js";
import { BillingProviders } from "./phases/billing-providers/BillingProviders.js";
import { Scan } from "./phases/scan/Scan.js";
import { Consultation } from "./phases/consultation/Consultation.js";
import { Generate } from "./phases/generate/Generate.js";
import { Instrument } from "./phases/instrument/Instrument.js";
import { CISetup } from "./phases/ci-setup/CISetup.js";
import { Complete } from "./phases/complete/Complete.js";

interface AppProps {
  apiKey?: string;
  targetDir: string;
  debug: boolean;
}

export function App({ apiKey, targetDir, debug }: AppProps) {
  const revvy = useRevvyState(apiKey, targetDir, debug);
  const { state } = revvy;

  const activePhases = getActivePhases(state.setupMode);

  const escEnabled =
    state.phase === Phase.SetupMode;

  useInput((_input, key) => {
    if (key.escape && escEnabled) {
      revvy.goBack();
    }
  });

  return (
    <Box flexDirection="column">
      {/* Static prevents Ink from re-printing the banner on every re-render */}
      <Static items={["banner"]}>
        {(item) => <Banner key={item} />}
      </Static>

      {state.phase !== Phase.Complete && state.phase !== Phase.SetupMode && state.phase !== Phase.HealthCheck && (
        <StepIndicator currentPhase={state.phase} phases={activePhases} />
      )}

      <Box flexDirection="column" marginTop={1}>
        {state.phase === Phase.HealthCheck && (
          <HealthCheck
            apiKey={state.apiKey}
            targetDir={state.targetDir}
            onSetApiKey={revvy.setApiKey}
            onComplete={revvy.completeHealthCheck}
          />
        )}
        {state.phase === Phase.SetupMode && (
          <SetupMode
            orgName={state.healthCheck?.orgName}
            onSelect={revvy.selectSetupMode}
          />
        )}
        {state.phase === Phase.BillingProviders && (
          <BillingProviders
            apiKey={state.apiKey!}
            teamId={state.teamId!}
            onComplete={revvy.completeBillingProviders}
            onBack={revvy.goBack}
          />
        )}
        {state.phase === Phase.Scan && (
          <Scan
            targetDir={state.targetDir}
            onComplete={revvy.completeScan}
          />
        )}
        {state.phase === Phase.Consultation && (
          <Consultation
            scanResult={state.scanResult!}
            onComplete={revvy.completeConsultation}
            onBack={() => revvy.goToPhase(Phase.SetupMode)}
          />
        )}
        {state.phase === Phase.Generate && (
          <Generate
            targetDir={state.targetDir}
            meteringDesign={state.meteringDesign!}
            scanResult={state.scanResult!}
            onComplete={revvy.completeGeneration}
          />
        )}
        {state.phase === Phase.Instrument && (
          <Instrument
            targetDir={state.targetDir}
            scanResult={state.scanResult!}
            meteringDesign={state.meteringDesign!}
            apiKey={state.apiKey}
            onComplete={(result, installCmd) =>
              revvy.completeInstrumentation({
                filesModified: result.filesModified,
                totalChanges: result.totalChanges,
                installCommand: installCmd,
              })
            }
          />
        )}
        {state.phase === Phase.CISetup && (
          <CISetup
            targetDir={state.targetDir}
            language={state.scanResult?.language ?? "node"}
            detectedProviders={state.meteringDesign?.detectedProviders}
            onComplete={revvy.completeCISetup}
            onBack={() => revvy.goToPhase(Phase.SetupMode)}
          />
        )}
        {state.phase === Phase.Complete && (
          <Complete
            setupMode={state.setupMode}
            targetDir={state.targetDir}
            generatedFiles={state.generatedFiles}
            meteringDesign={state.meteringDesign}
            billingProvidersResult={state.billingProvidersResult}
            onBackToMenu={revvy.backToMenu}
          />
        )}
      </Box>
    </Box>
  );
}
