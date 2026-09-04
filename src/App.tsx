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
  if (route === "war") return <ComingSoon mode="Local War Mode" href={href} />;
  if (route === "multiplayer") return <ComingSoon mode="Online War Mode" href={href} />;
  if (route === "not-found") return <NotFound href={href} />;

  return (
    <>
      {route === "maze" ? <AntSim /> : <InfiniteSim />}
      <a className="simulation-backlink" href={href("/")}>← All simulations</a>
    </>
  );
}
