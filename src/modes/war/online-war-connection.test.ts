import assert from "node:assert/strict";
import test from "node:test";
import { WAR_MATCH_REMOVED_CODE, WAR_RECONNECTED_ELSEWHERE_CODE } from "../../../shared/war-contract";
import { terminalWarCloseMessage, warCloseAction } from "./online-war-connection";

test("a connection displaced by another tab does not reconnect", () => {
  assert.equal(
    terminalWarCloseMessage(WAR_RECONNECTED_ELSEWHERE_CODE),
    "This room is open in another tab.",
  );
});

test("ordinary connection closures remain reconnectable", () => {
  assert.equal(terminalWarCloseMessage(1001), null);
  assert.equal(terminalWarCloseMessage(1006), null);
});

test("a removed match returns to the lobby instead of rejoining the missing room", () => {
  assert.equal(warCloseAction(WAR_MATCH_REMOVED_CODE), "return-to-lobby");
  assert.equal(warCloseAction(WAR_RECONNECTED_ELSEWHERE_CODE), "stop");
  assert.equal(warCloseAction(1006), "reconnect");
});
