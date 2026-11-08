import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { BUDGET, parseDecision, type LocalObservation } from './contract';
let module: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export interface Usage { calls: number; fuel: number; observationBytes: number; peakStateBytes: number }
export async function choose(source: string, observation: LocalObservation, state: unknown, usage: Usage) {
  usage.calls++;
  usage.observationBytes += new TextEncoder().encode(JSON.stringify(observation)).length;
  if (usage.observationBytes > BUDGET.observationBytes) throw new Error('Observation budget exhausted.');
  const qjs = await (module ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC));
  const runtime = qjs.newRuntime();
  runtime.setMemoryLimit(BUDGET.memoryBytes); runtime.setMaxStackSize(BUDGET.stackBytes);
  let fuel = 0;
  runtime.setInterruptHandler(() => ++usage.fuel > BUDGET.fuelPerMaze || ++fuel > BUDGET.fuelPerCall);
  const context = runtime.newContext();
  try {
    const input = JSON.stringify({ observation, state });
    const result = context.evalCode(`"use strict";
      globalThis.Date = undefined; globalThis.Intl = undefined;
      globalThis.WeakRef = undefined; globalThis.FinalizationRegistry = undefined;
      Math.random = () => { throw Error("Use a deterministic PRNG in your state."); };
      const __parse = JSON.parse.bind(JSON), __stringify = JSON.stringify.bind(JSON);
      const __input = __parse(${JSON.stringify(input)});
      const __step = (() => { ${source}\n; if (typeof step !== 'function') throw Error('Define step(o, state).'); return step; })();
      const __decision = __step(__input.observation, __input.state);
      if (!__decision || typeof __decision !== 'object' || typeof __decision.then === 'function') throw Error('Return a synchronous decision.');
      const __output = __stringify(__decision);
      if (typeof __output !== 'string' || __output.length > ${BUDGET.stateBytes + 4096}) throw Error('Decision too large.');
      __output;`, 'maze-agent.js');
    if (result.error) { result.error.dispose(); throw new Error('Agent failed: check JavaScript, synchronous returns and compute/memory limits.'); }
    try {
      const decision = parseDecision(JSON.parse(context.getString(result.value)));
      usage.peakStateBytes = Math.max(usage.peakStateBytes, new TextEncoder().encode(JSON.stringify(decision.state)).length);
      return decision;
    } finally { result.value.dispose(); }
  } finally { context.dispose(); runtime.dispose(); }
}
