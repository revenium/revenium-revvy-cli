declare module "ink-select-input" {
  import { FC } from "react";

  interface Item {
    label: string;
    value: string;
  }

  interface SelectInputProps {
    items: Item[];
    onSelect?: (item: Item) => void;
    onHighlight?: (item: Item) => void;
    initialIndex?: number;
    indicatorComponent?: FC;
    itemComponent?: FC;
    limit?: number;
  }

  const SelectInput: FC<SelectInputProps>;
  export default SelectInput;
}
