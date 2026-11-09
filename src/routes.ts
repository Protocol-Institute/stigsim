export type AppRoute = "strategy-lab" | "maze-memory" | "delivery-lab" | "model-war" | "highway-lab" | "index" | "protocol-lab" | "coordination-lab" | "swarm-ant" | "model-ant" | "maze" | "war" | "multiplayer" | "infinite" | "not-found";

function normalizeBasePath(basePath: string): string {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return `${withLeadingSlash.replace(/\/+$/, "")}/`;
}

export function appHref(pathname: string, basePath = "/"): string {
  const base = normalizeBasePath(basePath);
  const relativePath = pathname.replace(/^\/+/, "");
  return relativePath ? `${base}${relativePath}` : base;
}

export function normalizePathname(pathname: string, basePath = "/"): string {
  const base = normalizeBasePath(basePath);
  const baseWithoutTrailingSlash = base === "/" ? "" : base.slice(0, -1);
  let normalized = pathname;

  if (
    baseWithoutTrailingSlash &&
    (normalized === baseWithoutTrailingSlash || normalized.startsWith(`${baseWithoutTrailingSlash}/`))
  ) {
    normalized = normalized.slice(baseWithoutTrailingSlash.length) || "/";
  }

  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "") || "/";
}

export function resolveAppRoute(pathname: string, basePath = "/"): AppRoute {
  const path = normalizePathname(pathname, basePath);

  if (path === "/strategy-lab") return "strategy-lab";
  if (path === "/maze-memory") return "maze-memory";
  if (path === "/model-war") return "model-war";
  if (path === "/delivery-lab") return "delivery-lab";
  if (path === "/") return "index";
  if (path === "/highway-lab") return "highway-lab";
  if (import.meta.env?.DEV && path === "/protocol-lab") return "protocol-lab";
  if (import.meta.env?.DEV && path === "/coordination-lab") return "coordination-lab";
  if (path === "/swarm-ant") return "swarm-ant";
  if (path === "/model-ant") return "model-ant";
  if (path === "/maze") return "maze";
  if (path === "/war") return "war";
  if (path === "/multiplayer" || path.startsWith("/multiplayer/")) return "multiplayer";
  if (path === "/infinite") return "infinite";
  return "not-found";
}
