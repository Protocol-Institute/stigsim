import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { replayScrubCommitKey } from "./replay-scrubber";

export function ReplayScrubber({ label, value, max, onCommit }: {
  label: string;
  value: number;
  max: number;
  onCommit: (tick: number) => void;
}) {
  const boundedValue = Math.max(0, Math.min(max, value));
  const [draft, setDraft] = useState(boundedValue);
  const draftRef = useRef(boundedValue);
  const interactingRef = useRef(false);

  useEffect(() => {
    if (interactingRef.current) return;
    const next = Math.max(0, Math.min(max, value));
    draftRef.current = next;
    setDraft(next);
  }, [max, value]);

  const preview = (tick: number) => {
    draftRef.current = tick;
    setDraft(tick);
  };
  const commit = () => {
    interactingRef.current = false;
    if (draftRef.current !== value) onCommit(draftRef.current);
  };
  const cancel = () => {
    interactingRef.current = false;
    draftRef.current = boundedValue;
    setDraft(boundedValue);
  };
  const beginKeyboardChange = (event: KeyboardEvent<HTMLInputElement>) => {
    if (replayScrubCommitKey(event.key)) interactingRef.current = true;
  };
  const commitKeyboardChange = (event: KeyboardEvent<HTMLInputElement>) => {
    if (replayScrubCommitKey(event.key)) commit();
  };

  return <input
    aria-label={label}
    aria-valuetext={`Tick ${draft.toLocaleString()} of ${max.toLocaleString()}`}
    type="range"
    min={0}
    max={max}
    step={1}
    value={draft}
    onChange={event => preview(Number(event.target.value))}
    onPointerDown={() => { interactingRef.current = true; }}
    onPointerUp={commit}
    onPointerCancel={cancel}
    onKeyDown={beginKeyboardChange}
    onKeyUp={commitKeyboardChange}
    onBlur={commit}
  />;
}
