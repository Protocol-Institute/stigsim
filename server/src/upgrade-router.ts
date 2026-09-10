import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

interface UpgradeRouter {
  routes: Map<string, UpgradeHandler>;
  handleUpgrade: UpgradeHandler;
}

const routers = new WeakMap<Server, UpgradeRouter>();

export function registerWebSocketRoute(server: Server, pathname: string, handler: UpgradeHandler): () => void {
  let router = routers.get(server);
  if (!router) {
    const routes = new Map<string, UpgradeHandler>();
    const handleUpgrade: UpgradeHandler = (request, socket, head) => {
      const requestedPath = new URL(request.url ?? "", "http://localhost").pathname;
      const route = routes.get(requestedPath);
      if (route) {
        route(request, socket, head);
        return;
      }
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    };
    router = { routes, handleUpgrade };
    routers.set(server, router);
    server.on("upgrade", handleUpgrade);
  }
  if (router.routes.has(pathname)) throw new Error(`WebSocket route already registered: ${pathname}`);
  router.routes.set(pathname, handler);

  return () => {
    const current = routers.get(server);
    if (!current || current.routes.get(pathname) !== handler) return;
    current.routes.delete(pathname);
    if (current.routes.size === 0) {
      server.off("upgrade", current.handleUpgrade);
      routers.delete(server);
    }
  };
}
