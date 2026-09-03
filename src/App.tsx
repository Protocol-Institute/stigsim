import AntSim from "./AntSim";
import ComingSoon from "./components/ComingSoon";
import InfiniteSim from "./components/InfiniteSim";
import ModeHomeLink from "./components/ModeHomeLink";
import NotFound from "./components/NotFound";
import SimulationIndex from "./components/SimulationIndex";
import { resolveAppRoute } from "./routes";

export default function App() {
  const route = resolveAppRoute(window.location.pathname);

  if (route === "index") return <SimulationIndex />;
  if (route === "war") return <ComingSoon mode="Local War Mode" />;
  if (route === "multiplayer") return <ComingSoon mode="Online War Mode" />;
  if (route === "not-found") return <NotFound />;

  return (
    <>
      {route === "maze" ? <AntSim /> : <InfiniteSim />}
      <ModeHomeLink />
    </>
  );
}
