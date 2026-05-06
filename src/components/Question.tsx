import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../constants/colors.js";

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface BaseQuestionProps {
  label: string;
  hint?: string;
  hideEscHint?: boolean;
}

interface TextQuestionProps extends BaseQuestionProps {
  type: "text";
  placeholder?: string;
  onSubmit: (value: string) => void;
}

interface SelectQuestionProps extends BaseQuestionProps {
  type: "select";
  options: SelectOption[];
  onSubmit: (value: string) => void;
}

interface MultiSelectQuestionProps extends BaseQuestionProps {
  type: "multi-select";
  options: SelectOption[];
  onSubmit: (values: string[]) => void;
}

export type QuestionProps =
  | TextQuestionProps
  | SelectQuestionProps
  | MultiSelectQuestionProps;

function TextQuestion({
  label,
  hint,
  placeholder,
  onSubmit,
  hideEscHint,
}: TextQuestionProps) {
  const [value, setValue] = useState("");

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1}>
        <Text color={colors.primary} bold>
          ?
        </Text>
        <Text bold>{label}</Text>
      </Box>
      {hint && (
        <Text dimColor>  {hint}</Text>
      )}
      <Box gap={1} marginTop={0}>
        <Text color={colors.primary}>›</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(val) => {
            if (val.trim()) onSubmit(val.trim());
          }}
          placeholder={placeholder || "Type your answer..."}
        />
      </Box>
      <Text dimColor>{"\n"}  Enter to confirm{hideEscHint ? "" : " · Esc to go back"}</Text>
    </Box>
  );
}

function SelectQuestion({
  label,
  hint,
  options,
  onSubmit,
  hideEscHint,
}: SelectQuestionProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    }
    if (key.return) {
      onSubmit(options[selectedIndex]!.value);
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={colors.primary} bold>
          ?
        </Text>
        <Text bold>{label}</Text>
      </Box>
      {hint && (
        <Text dimColor>  {hint}</Text>
      )}
      <Box flexDirection="column" marginTop={0}>
        {options.map((option, index) => (
          <Box key={option.value} flexDirection="column">
            <Box gap={1}>
              <Text color={index === selectedIndex ? colors.primary : colors.muted}>
                {index === selectedIndex ? "❯" : " "}
              </Text>
              <Text
                color={index === selectedIndex ? colors.primary : undefined}
                bold={index === selectedIndex}
              >
                {option.label}
              </Text>
            </Box>
            {index === selectedIndex && option.description && (
              <Text dimColor>    {option.description}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text dimColor>{"\n"}  Use arrow keys to select, Enter to confirm{hideEscHint ? "" : " · Esc to go back"}</Text>
    </Box>
  );
}

function MultiSelectQuestion({
  label,
  hint,
  options,
  onSubmit,
  hideEscHint,
}: MultiSelectQuestionProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    }
    if (input === " ") {
      const value = options[selectedIndex]!.value;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
    }
    if (key.return) {
      onSubmit(Array.from(selected));
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={colors.primary} bold>
          ?
        </Text>
        <Text bold>{label}</Text>
      </Box>
      {hint && (
        <Text dimColor>  {hint}</Text>
      )}
      <Box flexDirection="column" marginTop={0}>
        {options.map((option, index) => {
          const isSelected = selected.has(option.value);
          const isFocused = index === selectedIndex;
          return (
            <Box key={option.value} gap={1}>
              <Text color={isFocused ? colors.primary : colors.muted}>
                {isFocused ? "❯" : " "}
              </Text>
              <Text color={isSelected ? colors.success : colors.muted}>
                {isSelected ? "◉" : "○"}
              </Text>
              <Text
                color={isFocused ? colors.primary : undefined}
                bold={isFocused}
              >
                {option.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Text dimColor>
        {"  "}Space to toggle, Enter to confirm ({selected.size} selected){hideEscHint ? "" : " · Esc to go back"}
      </Text>
    </Box>
  );
}

export function Question(props: QuestionProps) {
  switch (props.type) {
    case "text":
      return <TextQuestion {...props} />;
    case "select":
      return <SelectQuestion {...props} />;
    case "multi-select":
      return <MultiSelectQuestion {...props} />;
  }
}
