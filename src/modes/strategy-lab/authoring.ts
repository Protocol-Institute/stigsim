
export interface Editors { observer: string; controller: string }
const OBSERVER = '// @stigsim/observer\n';
const CONTROLLER = '\n// @stigsim/controller\n';
const ADAPTER = '\n// @stigsim/adapter\n';
// The adapter is ordinary entrant source: exported entries still use the v1 contract.
const adapter = `function step(o, state) {
  const initial = state?.initial ?? o.settings;
  const observation = observe(o, state?.observer ?? null);
  if (!observation || typeof observation !== "object" || typeof observation.then === "function") throw Error("observe must return { signals, state, nextTick }");
  const decision = control(observation.signals, state?.controller ?? null,
    { tick: o.tick, tickLimit: o.tickLimit, settings: o.settings, initial });
  if (!decision || typeof decision !== "object" || typeof decision.then === "function") throw Error("control must return { state, settings? }");
  return { nextTick: observation.nextTick,
    state: { initial, observer: observation.state ?? null, controller: decision.state ?? null, signals: observation.signals ?? null },
    ...(decision.settings === undefined ? {} : { settings: decision.settings }) };
}`;
export function composeSource(editors: Editors) {
  return OBSERVER + editors.observer + CONTROLLER + editors.controller + ADAPTER + adapter;
}
export function readEditors(source: string): Editors | null {
  if (!source.startsWith(OBSERVER)) return null;
  const controller = source.indexOf(CONTROLLER), bridge = source.lastIndexOf(ADAPTER);
  if (controller < 0 || bridge < controller) return null;
  const editors = { observer: source.slice(OBSERVER.length, controller), controller: source.slice(controller + CONTROLLER.length, bridge) };
  return composeSource(editors) === source ? editors : null;
}
