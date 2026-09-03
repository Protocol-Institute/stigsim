export type AppRoute = "index" | "maze" | "war" | "multiplayer" | "infinite" | "not-found";

export function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function resolveAppRoute(pathname: string): AppRoute {
  const path = normalizePathname(pathname);

  if (path === "/") return "index";
  if (path === "/maze") return "maze";
  if (path === "/war") return "war";
  if (path === "/multiplayer" || path.startsWith("/multiplayer/")) return "multiplayer";
  if (path === "/infinite") return "infinite";
  return "not-found";
}
