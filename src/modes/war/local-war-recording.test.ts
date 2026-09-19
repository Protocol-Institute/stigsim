import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE,
  cloneDoctrine,
} from "@stigsim/sim-core";
import { serializeModeRunRecord } from "@stigsim/sim-trace";
import {
  createLocalWarRecorder,
  createLocalWarReplay,
  localWarPlayerSource,
  localWarRecordFilename,
  parseLocalWarRecord,
} from "./local-war-recording";
import { DEFAULT_WAR_SETTINGS } from "./war-simulation";

test("the Local War host records attributed commands and produces a replay", () => {
  const settings = {
    ...DEFAULT_WAR_SETTINGS,
    masterSeed: "local host/research",
    startingAnts: 3,
  };
  const recorder = createLocalWarRecorder(settings, [DEFAULT_DOCTRINE, DEFAULT_DOCTRINE]);
  const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  doctrine.evapRate = 0.02;
  recorder.command(localWarPlayerSource(1), {
    kind: "set-doctrine",
    colonyId: 1,
    doctrine,
  });
  for (let i = 0; i < 20; i++) recorder.step();
  const record = recorder.build();

  assert.equal(record.commands[0].source.kind, "participant");
  assert.equal(record.commands[0].source.kind === "participant" && record.commands[0].source.participantId, "local-colony-1");
  assert.equal(localWarRecordFilename(record), "stigsim-war-local-host-research-20.run.json");

  const parsed = parseLocalWarRecord(serializeModeRunRecord(record));
  assert.ok(parsed.ok);
  const replay = createLocalWarReplay(parsed.record);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.runtime.fingerprint(), recorder.runtime.fingerprint());
});

test("Local War refuses attribution to a nonexistent colony", () => {
  assert.throws(() => localWarPlayerSource(2), /two player colonies/i);
});
