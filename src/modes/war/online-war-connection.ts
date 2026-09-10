import { WAR_MATCH_REMOVED_CODE, WAR_RECONNECTED_ELSEWHERE_CODE } from "../../../shared/war-contract";

export type WarCloseAction = "reconnect" | "stop" | "return-to-lobby";

export function warCloseAction(code: number): WarCloseAction {
  if (code === WAR_RECONNECTED_ELSEWHERE_CODE) return "stop";
  if (code === WAR_MATCH_REMOVED_CODE) return "return-to-lobby";
  return "reconnect";
}

export function terminalWarCloseMessage(code: number): string | null {
  return code === WAR_RECONNECTED_ELSEWHERE_CODE
    ? "This room is open in another tab."
    : null;
}
