declare module "ink-spinner" {
  import { FC } from "react";

  interface SpinnerProps {
    type?:
      | "dots"
      | "line"
      | "arc"
      | "bouncingBar"
      | "bouncingBall"
      | "clock"
      | "earth"
      | "moon"
      | "pong"
      | "shark"
      | "toggle";
  }

  const Spinner: FC<SpinnerProps>;
  export default Spinner;
}
