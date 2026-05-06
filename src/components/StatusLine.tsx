import { Box, Text } from "ink";
import { colors } from "../constants/colors.js";

interface StatusLineProps {
  icon: string;
  label: string;
  value?: string;
  status: "success" | "error" | "info" | "warning" | "pending";
}

const STATUS_COLORS: Record<StatusLineProps["status"], string> = {
  success: colors.success,
  error: colors.error,
  info: colors.accent,
  warning: colors.warning,
  pending: colors.muted,
};

const STATUS_ICONS: Record<StatusLineProps["status"], string> = {
  success: "✓",
  error: "✗",
  info: "ℹ",
  warning: "⚠",
  pending: "○",
};

export function StatusLine({ label, value, status }: StatusLineProps) {
  return (
    <Box gap={1}>
      <Text color={STATUS_COLORS[status]}>{STATUS_ICONS[status]}</Text>
      <Text>{label}</Text>
      {value && <Text dimColor>{value}</Text>}
    </Box>
  );
}
