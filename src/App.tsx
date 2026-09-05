import AntSim from "./AntSim";
import ComingSoon from "./components/ComingSoon";
import InfiniteSim from "./components/InfiniteSim";
import NotFound from "./components/NotFound";
import SimulationIndex from "./components/SimulationIndex";
import { appHref, resolveAppRoute } from "./routes";

export default function App() {
  const basePath = import.meta.env.BASE_URL;
  const route = resolveAppRoute(window.location.pathname, basePath);
  const href = (pathname: string) => appHref(pathname, basePath);

  if (route === "index") return <SimulationIndex href={href} />;

  let content;
  if (route === "war") content = <ComingSoon mode="Local War Mode" href={href} />;
  else if (route === "multiplayer") content = <ComingSoon mode="Online War Mode" href={href} />;
  else if (route === "not-found") content = <NotFound href={href} />;
  else content = route === "maze" ? <AntSim /> : <InfiniteSim simulationsHref={href("/")} />;

  return (
    <>
      {content}
      {route !== "infinite" && (
        <a className="simulation-backlink" href={href("/")}>← All simulations</a>
      )}
    </>
  );
}
