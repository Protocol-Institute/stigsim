import { useEffect, useState } from 'react';
import type { RunPacing } from './pacing';
export default function ModelAntControls({ pacing, running, busy, ready, done, onToggle, onStep }: {
  pacing: RunPacing; running: boolean; busy: boolean; ready: boolean; done: boolean;
  onToggle: () => void; onStep: () => void;
}) {
  const [, updateClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => updateClock(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.ceil(pacing.delayMs() / 1000);
  return <>
    <div className="ant-controls">
      <button className="ant-primary" disabled={!ready || done} onClick={onToggle}>{running ? 'Pause' : 'Run experiment'}</button>
      <button disabled={!ready || busy || running || done || seconds > 0} onClick={onStep}>One step →</button>
    </div>
    <div className="ant-caption ant-pacing-status" role="status" aria-live="polite">
      {!busy && !done && seconds > 0 && <>
        <span>{pacing.consecutiveRateLimits ? 'Rate-limit cooldown' : 'Pacing model requests'}: {seconds}s</span>
        <span>{running ? 'The run will retry automatically.' : 'The run is paused.'}</span>
      </>}
    </div>
  </>;
}
