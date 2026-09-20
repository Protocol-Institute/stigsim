import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, cloneDoctrine } from "@stigsim/sim-core";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../../shared/war-contract";
import {
  createOnlineWarRecorder,
  onlineWarParticipants,
  onlineWarPlayerSource,
} from "./online-war-recording";
import { createWarReplay, parseWarRunRecord } from "./war-run-record";

test("online War records authoritative commands with stable player provenance", () => {
  const recorder = createOnlineWarRecorder({
    ...DEFAULT_ONLINE_WAR_SETTINGS,
    masterSeed: "online-recording-test",
    startingAnts: 2,
  });
  const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  doctrine.evapRate = 0.006;
  recorder.command(onlineWarPlayerSource(1), { kind: "set-doctrine", colonyId: 1, doctrine });
  for (let tick = 0; tick < 500; tick++) recorder.step();

  const record = recorder.build();
  assert.deepEqual(record.participants, onlineWarParticipants());
  assert.equal(record.commands.length, 1);
  assert.deepEqual(record.commands[0].source, { kind: "participant", participantId: "online-colony-1" });
  assert.equal(record.commands[0].t, 1);
  assert.equal(record.channels.metrics.samples.at(-1)?.t, 500);
  assert.equal(record.channels.agents.samples.at(-1)?.t, 500);
  assert.equal(record.channels.fields.samples.at(-1)?.t, 500);

  const parsed = parseWarRunRecord(JSON.stringify(record));
  assert.equal(parsed.ok, true);
  assert.ok(parsed.record);
  const replay = createWarReplay(parsed.record);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.runtime.fingerprint(), recorder.runtime.fingerprint());
});

test("online War marks a generated opponent without recording player identity", () => {
  assert.deepEqual(onlineWarParticipants(true), [
    { id: "online-colony-0", kind: "player", slot: "colony-0" },
    { id: "online-colony-1", kind: "bot", slot: "colony-1" },
  ]);
  assert.throws(() => onlineWarPlayerSource(2), /only two colonies/);
});
