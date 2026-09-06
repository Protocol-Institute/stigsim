import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cloneDoctrine } from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";
import { COLONY_COLORS } from "./render";
import { ParamCard } from "./ParamCard";
import { PRESETS } from "./doctrine-presets";

/** A slider drag commits once, this long after the last movement. */
const COMMIT_DELAY_MS = 100;

const heading: CSSProperties = {
  margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase", color: "#6b5a3e",
};

export function DoctrinePanel({
  numColonies, selected, onSelect, doctrine, adopted, topology, disabled, onCommit,
}: {
  numColonies: number;
  selected: number;
  onSelect: (colony: number) => void;
  /** The selected colony's doctrine as last committed. */
  doctrine: Doctrine;
  /** Fraction of the selected colony's ants running its current doctrine. */
  adopted: number;
  topology: Topology;
  disabled: boolean;
  onCommit: (colony: number, doctrine: Doctrine) => void;
}) {
  const [draft, setDraft] = useState<Doctrine>(doctrine);
  const timer = useRef<number | null>(null);

  // A colony switch or a reset replaces the draft; a commit echoes back the
  // same object, which is fine.
  useEffect(() => { setDraft(doctrine); }, [doctrine, selected]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const edit = (change: (d: Doctrine) => void) => {
    const next = cloneDoctrine(draft);
    change(next);
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; onCommit(selected, next); }, COMMIT_DELAY_MS);
  };

  const pick = (d: Doctrine) => {
    const next = cloneDoctrine(d);
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setDraft(next);
    onCommit(selected, next);
  };

  const exponent = draft.forager.follow.searching.food.own;
  const showMimic = topology.mimicEnemy;
  const showPoach = topology.read === "separable";

  return (
    <div style={{ width: "100%", maxWidth: 600 }}>
      <p style={heading}>Doctrine</p>

      {numColonies > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {Array.from({ length: numColonies }, (_, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              disabled={disabled}
              style={{
                padding: "5px 12px", borderRadius: 16, fontSize: "0.75rem", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
                border: `1px solid ${COLONY_COLORS[i].primary}`,
                background: i === selected ? COLONY_COLORS[i].primary : "transparent",
                color: i === selected ? "#000" : COLONY_COLORS[i].primary,
              }}
            >
              Colony {i + 1}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {PRESETS.filter(p => p.available(topology)).map(p => (
          <button
            key={p.name}
            title={p.intent}
            onClick={() => pick(p.doctrine)}
            disabled={disabled}
            style={{
              padding: "5px 10px", borderRadius: 8, fontSize: "0.72rem", cursor: disabled ? "not-allowed" : "pointer",
              border: "1px solid #3d2e18", background: "#1a1208", color: "#e5d5b5",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <p style={{ margin: "0 0 10px", fontSize: "0.72rem", color: "#a08060" }}>
        {Math.round(adopted * 100)}% of this colony's ants are running its current doctrine.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
        <ParamCard
          label="Trail bias"
          description="How strongly ants prefer stronger trails. Power 1 is nearly random exploration; power 10 follows the most-travelled path almost always. Sets both the food-seeking and home-seeking exponents."
          value={exponent}
          displayValue={`power ${exponent}`}
          min={1} max={10} step={0.5}
          onChange={v => edit(d => {
            d.forager.follow.searching.food.own = v;
            d.forager.follow.returning.home.own = v;
          })}
          disabled={disabled}
        />
        <ParamCard
          label="Evaporation rate"
          description="How quickly this colony's trails fade. Higher forgets faster and shakes off false trail; lower keeps old paths alive."
          value={draft.evapRate}
          displayValue={`${(draft.evapRate * 1000).toFixed(0)}‰ / step`}
          min={0.001} max={0.02} step={0.001}
          onChange={v => edit(d => { d.evapRate = v; })}
          disabled={disabled}
        />
        {showMimic && (
          <ParamCard
            label="Spoilers"
            description="The share of the colony that explores toward the opponent and lays their chemical instead of foraging. Assigned to the first ants by index; they wear a white ring."
            value={draft.spoilerFraction}
            displayValue={`${Math.round(draft.spoilerFraction * 100)}% of ants`}
            min={0} max={0.5} step={0.05}
            onChange={v => edit(d => { d.spoilerFraction = v; })}
            disabled={disabled}
          />
        )}
        {showMimic && (
          <ParamCard
            label="Mimic rate"
            description={`How much of the opponent's chemical a spoiler lays per step, as a fraction of a normal deposit. Draws on the same gland as foraging. Capped at ${Math.round(topology.maxMimicRate * 100)}% under this topology.`}
            value={Math.min(draft.mimicRate, topology.maxMimicRate)}
            displayValue={`${Math.round(draft.mimicRate * 100)}%`}
            min={0} max={topology.maxMimicRate} step={0.05}
            onChange={v => edit(d => { d.mimicRate = v; })}
            disabled={disabled}
          />
        )}
        {showPoach && (
          <ParamCard
            label="Poach weight"
            description="How this colony's foragers treat the opponent's food trail. Positive follows it, negative avoids it, zero ignores it."
            value={draft.forager.follow.searching.food.enemy}
            displayValue={`${draft.forager.follow.searching.food.enemy}`}
            min={-4} max={4} step={0.5}
            onChange={v => edit(d => { d.forager.follow.searching.food.enemy = v; })}
            disabled={disabled}
          />
        )}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: "0.72rem", color: "#a08060", cursor: "pointer" }}>All atoms</summary>
        <pre style={{ fontSize: "0.65rem", color: "#a08060", overflowX: "auto", margin: "6px 0 0" }}>
          {JSON.stringify(draft, null, 1)}
        </pre>
      </details>
    </div>
  );
}
