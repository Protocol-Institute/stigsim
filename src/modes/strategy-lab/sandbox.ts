import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { LIMITS, parseDecision, type Decision } from './contract';

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export interface Usage { calls: number; observationBytes: number; interrupts: number }

/** No host callbacks, module loader, browser, filesystem or network enter the VM. */
export async function decide(source: string, observation: unknown, state: unknown, tick: number, usage: Usage): Promise<Decision> {
  const QuickJS = await (engine ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC));
  const payload = JSON.stringify({ observation, state });
  usage.observationBytes += new TextEncoder().encode(JSON.stringify(observation)).length;
  usage.calls++;
  if (usage.observationBytes > LIMITS.observationBytes) throw new Error('Observation-byte budget exhausted. Sample less often.');
  // A fresh VM prevents hidden persistent memory; only returned JSON state survives.
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(LIMITS.vmMemoryBytes);
  runtime.setMaxStackSize(LIMITS.vmStackBytes);
  let calls = 0;
  runtime.setInterruptHandler(() => {
    usage.interrupts++;
    return ++calls > LIMITS.interruptsPerCall || usage.interrupts > LIMITS.interruptsPerTrial;
  });
  const context = runtime.newContext();
  try {
    const result = context.evalCode(`
      "use strict";
      globalThis.Date = undefined; globalThis.Intl = undefined;
      globalThis.WeakRef = undefined; globalThis.FinalizationRegistry = undefined;
      Math.random = () => { throw new Error("Use explicit deterministic state instead of Math.random."); };
      const __parse = JSON.parse.bind(JSON), __stringify = JSON.stringify.bind(JSON);
      const __input = __parse(${JSON.stringify(payload)});
      const __run = (() => {
        ${source}
        if (typeof step !== "function") throw new Error("Define function step(observation, state).");
        return step;
      })();
      const __result = __run(__input.observation, __input.state);
      if (!__result || typeof __result !== "object" || typeof __result.then === "function") {
        throw new Error("step must return a synchronous decision object.");
      }
      const __output = __stringify(__result);
      if (typeof __output !== "string" || __output.length > ${LIMITS.stateBytes + 4096}) throw new Error("Decision is too large.");
      __output;
    `, 'strategy.js');
    if (result.error) {
      result.error.dispose();
      throw new Error('Controller failed or exceeded its compute/memory budget. Check syntax, synchronous return values and resource usage.');
    }
    try { return parseDecision(JSON.parse(context.getString(result.value)), tick); }
    finally { result.value.dispose(); }
  } finally { context.dispose(); runtime.dispose(); }
}
