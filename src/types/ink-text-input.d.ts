declare module "ink-text-input" {
  import { FC } from "react";

  interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    mask?: string;
    showCursor?: boolean;
  }

  const TextInput: FC<TextInputProps>;
  export default TextInput;
}
