import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import {
  BUDGET,
  type Observation,
  type Prepared,
  type CodeUsage,
} from "./contract";
import { parseWrites } from "./environment";
let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export async function prepare(
  source: string,
  observation: Observation,
  usage: CodeUsage,
): Promise<Prepared> {
  usage.calls++;
  usage.observationBytes += new TextEncoder().encode(
    JSON.stringify(observation),
  ).length;
  if (usage.observationBytes > BUDGET.observationBytes)
    throw Error("Code observation budget exhausted.");
  const q = await (engine ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC)),
    runtime = q.newRuntime();
  runtime.setMemoryLimit(BUDGET.memoryBytes);
  runtime.setMaxStackSize(BUDGET.stackBytes);
  let fuel = 0;
  runtime.setInterruptHandler(
    () => ++usage.fuel > BUDGET.fuelPerMaze || ++fuel > BUDGET.fuelPerCall,
  );
  const context = runtime.newContext();
  try {
    const result = context.evalCode(
      `'use strict';globalThis.Date=undefined;globalThis.Intl=undefined;globalThis.WeakRef=undefined;globalThis.FinalizationRegistry=undefined;Math.random=()=>{throw Error('No ambient randomness.');};const stringify=JSON.stringify.bind(JSON),o=JSON.parse(${JSON.stringify(JSON.stringify(observation))});const fn=(()=>{${source}\n;if(typeof prepare!=='function')throw Error('Define prepare(o).');return prepare;})();const p=fn(o);if(!p||typeof p!=='object'||p.then||'state' in p||'move' in p||'action' in p)throw Error('Return instructions, context and local writes only.');const out=stringify(p);if(!out||out.length>100000)throw Error('Preparation too large.');out;`,
      "strategy.js",
    );
    if (result.error) {
      let message = "Check code and execution limits.";
      try {
        const detail = context.dump(result.error);
        if (typeof detail?.message === "string")
          message = detail.message.slice(0, 500);
      } finally {
        result.error.dispose();
      }
      throw Error(`Strategy preparation failed: ${message}`);
    }
    try {
      const p = JSON.parse(context.getString(result.value));
      if (
        typeof p.instructions !== "string" ||
        !p.instructions.trim() ||
        p.instructions.length > BUDGET.instructionChars ||
        new TextEncoder().encode(JSON.stringify(p.context ?? null)).length >
          BUDGET.contextBytes
      )
        throw Error("Preparation exceeds instruction/context limits.");
      return {
        instructions: p.instructions,
        context: p.context ?? null,
        writes: parseWrites(p.writes),
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
