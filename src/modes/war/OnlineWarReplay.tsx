import { useEffect, useRef, useState } from "react";
import { H, W } from "@stigsim/sim-core";
import { serializeModeRunRecord } from "@stigsim/sim-trace";
import type { WarMatchRecord } from "../../../shared/war-contract";
import { createWarReplay, warRunRecordFilename, type WarRunRecord } from "./war-run-record";
import { drawWar } from "./war-render";

function downloadRecord(record: WarRunRecord): void {
  const blob = new Blob([serializeModeRunRecord(record)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = warRunRecordFilename(record);
  link.click();
  URL.revokeObjectURL(url);
}

export function OnlineWarReplay({ summary, record, onClose }: {
  summary: WarMatchRecord;
  record: WarRunRecord;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replayRef = useRef(createWarReplay(record));
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState(() => ({
    tick: replayRef.current.tick,
    endTick: replayRef.current.endTick,
    divergedAt: replayRef.current.divergedAt,
  }));

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const animate = (now: number) => {
      const replay = replayRef.current;
      if (running && !replay.atEnd && replay.divergedAt === null) {
        accumulator += (now - previous) * summary.settings.stepsPerSecond * speed / 1_000;
        let steps = Math.min(500, Math.floor(accumulator));
        if (steps > 0) accumulator -= steps;
        if (steps > 0) {
          while (steps-- > 0 && replay.step()) { /* authoritative replay step */ }
          setView({ tick: replay.tick, endTick: replay.endTick, divergedAt: replay.divergedAt });
        }
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawWar(ctx, replay.runtime);
      previous = now;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [running, speed, summary.settings.stepsPerSecond]);

  useEffect(() => {
    if (view.tick >= view.endTick || view.divergedAt !== null) setRunning(false);
  }, [view]);

  const seek = (tick: number) => {
    setRunning(false);
    replayRef.current.seek(tick);
    setView({
      tick: replayRef.current.tick,
      endTick: replayRef.current.endTick,
      divergedAt: replayRef.current.divergedAt,
    });
  };
  const restart = () => {
    replayRef.current.reset();
    setView({ tick: 0, endTick: replayRef.current.endTick, divergedAt: null });
    setRunning(true);
  };
  const metrics = [0, 1].map(id => replayRef.current.runtime.getMetrics(id));
  const channelSummary = Object.entries(record.channels)
    .map(([name, channel]) => `${name}: ${channel.samples.length.toLocaleString()}${channel.truncated ? " retained" : ""}`)
    .join(" · ");
  const result = summary.winner === "draw"
    ? "Draw"
    : `${summary.playerNames[summary.winner] ?? `Colony ${summary.winner + 1}`} won`;

  return <main className="war-page online-replay-page">
    <header className="war-header online-replay-header">
      <div><p>Verified match record</p><h1>{summary.playerNames[0] ?? "Colony 1"} vs {summary.playerNames[1] ?? "Colony 2"}</h1><span>Room {summary.matchId} · {result}</span></div>
      <div className="war-header__actions"><button className="war-button" onClick={() => downloadRecord(record)}>Download record</button><button className="war-button" onClick={onClose}>Back to history</button></div>
    </header>
    <section className="war-matchbar" aria-label="Recorded match details">
      <div className="war-matchbar__group"><strong>Research record</strong><div className="war-matchbar__summary"><span>{record.commands.length.toLocaleString()} commands</span><span>{record.fingerprints.length.toLocaleString()} verification points</span><span>{channelSummary}</span><span className="war-matchbar__seed" title={summary.settings.masterSeed}>Seed: {summary.settings.masterSeed}</span></div></div>
    </section>
    <section className="war-replay online-replay-controls" aria-label="Recorded match playback">
      <div className="war-replay__heading"><div><strong>Authoritative playback</strong><span aria-live="polite">Tick {view.tick.toLocaleString()} of {view.endTick.toLocaleString()}</span></div><div>
        <button className="war-button war-button--primary" disabled={view.divergedAt !== null || view.tick >= view.endTick} onClick={() => setRunning(value => !value)}>{running ? "Pause" : "Play"}</button>
        <button className="war-button" onClick={restart}>Restart</button>
        <div className="online-replay-speed" role="group" aria-label="Replay speed"><span>Speed</span>{[1, 4, 16].map(value => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div>
      </div></div>
      <input aria-label="Replay position" type="range" min={0} max={view.endTick} value={view.tick} onChange={event => seek(Number(event.target.value))} />
      {view.divergedAt !== null && <p className="war-replay__error">Verification diverged at tick {view.divergedAt.toLocaleString()}. Playback stopped before showing unverified state. <button onClick={() => { replayRef.current.continueAfterDivergence(); setView(current => ({ ...current, divergedAt: null })); }}>Continue unverified</button></p>}
    </section>
    <section className="online-replay-stage">
      <aside className="online-replay-metrics" aria-label="Colony 1 replay metrics"><strong>{summary.playerNames[0] ?? "Colony 1"}</strong><span>{metrics[0].population} ants</span><small>{metrics[0].foodCollected} food · {metrics[0].deaths} deaths</small></aside>
      <div className="war-maze online-replay-maze"><canvas ref={canvasRef} width={W} height={H} /><div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>White ring: spoiler</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div></div>
      <aside className="online-replay-metrics online-replay-metrics--red" aria-label="Colony 2 replay metrics"><strong>{summary.playerNames[1] ?? "Colony 2"}</strong><span>{metrics[1].population} ants</span><small>{metrics[1].foodCollected} food · {metrics[1].deaths} deaths</small></aside>
    </section>
  </main>;
}
