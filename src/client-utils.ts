function configuredSimulationServer(): string {
  return (import.meta.env.VITE_INFINITE_SERVER_URL ?? "").replace(/\/$/, "");
}

export function simulationApiUrl(path: string): string {
  const configured = configuredSimulationServer();
  return configured ? new URL(path, configured).toString() : path;
}

export function simulationWebSocketUrl(path: string): string {
  const url = new URL(path, configuredSimulationServer() || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function downloadText(contents: string, filename: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
