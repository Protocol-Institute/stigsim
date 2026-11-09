import type { RunRecord } from "./record";
/** Bound untrusted reconstruction work without blocking the editor. */
export function loadRecording(value: unknown): Promise<RunRecord> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./recording-worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("Recording exceeded the 30-second validation budget."));
    }, 30000);
    worker.onmessage = (event) => {
      finish();
      if (event.data.ok) resolve(event.data.record);
      else reject(Error(event.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(Error("Recording worker failed."));
    };
    worker.postMessage(value);
  });
}
