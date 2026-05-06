export const REVENIUM_API_BASE_URL = "https://api.revenium.ai";
export const REVENIUM_API_PATH_PREFIX = "/profitstream/v2/api";
export const REVENIUM_METERING_PATH_PREFIX = "/meter/v2";
export const REVENIUM_DASHBOARD_URL = "https://app.revenium.ai";
export const REVENIUM_DOCS_URL = "https://docs.revenium.ai";

export const REVENIUM_LLMS_TXT_URL = "https://revenium.readme.io/llms.txt";
export const REVENIUM_OUTCOMES_DOCS_URL = "https://docs.revenium.io/outcomes-tracking.md";

export const DASHBOARD_PATHS = {
  PROVIDERS: "/connections/providers",
  SDK_SETUP: "/connections/sdk-setup",
  DASHBOARD: "/dashboard",
  ROI_DASHBOARD: "/costs-revenue/roi-dashboard",
} as const;

export const ENV_VARS = {
  API_KEY: "REVENIUM_METERING_API_KEY",
  BASE_URL: "REVENIUM_METERING_BASE_URL",
  TEAM_ID: "REVENIUM_TEAM_ID",
} as const;
