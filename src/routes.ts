export type AppRoute = "index" | "maze" | "war" | "multiplayer" | "infinite" | "not-found";

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

  if (path === "/") return "index";
  if (path === "/maze") return "maze";
  if (path === "/war") return "war";
  if (path === "/multiplayer" || path.startsWith("/multiplayer/")) return "multiplayer";
  if (path === "/infinite") return "infinite";
  return "not-found";
}
