import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import { colors } from "../constants/colors.js";

interface SpinnerProps {
  label: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <Box gap={1}>
      <Text color={colors.primary}>
        <InkSpinner type="dots" />
      </Text>
      <Text>{label}</Text>
    </Box>
  );
}
