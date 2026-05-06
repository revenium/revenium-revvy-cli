import { Box, Text } from "ink";
import { VERSION } from "../constants/version.js";
import { colors } from "../constants/colors.js";

const REVVY_BIG_TEXT = [
  "  ____  _______     ____     ____   __",
  " |  _ \\| ____\\ \\   / /\\ \\   / /\\ \\ / /",
  " | |_) |  _|  \\ \\ / /  \\ \\ / /  \\ V / ",
  " |  _ <| |___  \\ V /    \\ V /    | |  ",
  " |_| \\_\\_____|  \\_/      \\_/     |_|  ",
];

export function Banner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {REVVY_BIG_TEXT.map((line, i) => (
          <Text key={i} color={colors.primary} bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box gap={1} marginTop={1}>
        <Text bold color="white">
          Revvy
        </Text>
        <Text dimColor>v{VERSION}</Text>
      </Box>
      <Text dimColor>AI metering setup in minutes, not days.</Text>
    </Box>
  );
}
