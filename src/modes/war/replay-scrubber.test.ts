import assert from "node:assert/strict";
import test from "node:test";
import { replayScrubCommitKey } from "./replay-scrubber";

test("replay scrubbing commits every native range-navigation key", () => {
  for (const key of [
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
  ]) {
    assert.equal(replayScrubCommitKey(key), true, key);
  }
  assert.equal(replayScrubCommitKey("Enter"), false);
  assert.equal(replayScrubCommitKey(" "), false);
});
