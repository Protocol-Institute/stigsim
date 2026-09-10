import { WAR_RECONNECTED_ELSEWHERE_CODE } from "../../../shared/war-contract";

export function terminalWarCloseMessage(code: number): string | null {
  return code === WAR_RECONNECTED_ELSEWHERE_CODE
    ? "This room is open in another tab."
    : null;
}
