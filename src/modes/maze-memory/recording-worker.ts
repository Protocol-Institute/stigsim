import { validateRecord } from "./replay";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({ ok: true, record: validateRecord(event.data) });
  } catch (e) {
    scope.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : "Recording validation failed.",
    });
  }
};
