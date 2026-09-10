import AntSim from "./AntSim";
import InfiniteSim from "./components/InfiniteSim";
import NotFound from "./components/NotFound";
import SimulationIndex from "./components/SimulationIndex";
import LocalWarMode from "./modes/war/LocalWarMode";
import OnlineWarMode from "./modes/war/OnlineWarMode";
import { appHref, resolveAppRoute } from "./routes";
import OnlineAuthGate from "./auth/OnlineAuth";

export default function App() {
  const basePath = import.meta.env.BASE_URL;
  const route = resolveAppRoute(window.location.pathname, basePath);
  const href = (pathname: string) => appHref(pathname, basePath);

  if (route === "index") return <SimulationIndex href={href} />;

  let content;
  if (route === "war") content = <LocalWarMode />;
  else if (route === "multiplayer") content = <OnlineAuthGate><OnlineWarMode /></OnlineAuthGate>;
  else if (route === "not-found") content = <NotFound href={href} />;
  else content = route === "maze" ? <AntSim /> : <OnlineAuthGate><InfiniteSim simulationsHref={href("/")} /></OnlineAuthGate>;

  return (
    <>
      {content}
      {route !== "infinite" && (
        <a className="simulation-backlink" href={href("/")}>← All simulations</a>
      )}
    </>
  );
}
