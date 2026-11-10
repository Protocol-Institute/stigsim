import Levels from "./components/Levels";
import { lazy, Suspense } from "react";
import DeliveryLab from "./modes/delivery/DeliveryLab";
import ModelWar from "./modes/model-war/ModelWar";
import HighwayLab from "./modes/highway/HighwayLab";
import ProtocolLab from "./modes/protocol-lab/ProtocolLab";
import CoordinationLab from "./modes/coordination-lab/CoordinationLab";
import SwarmAnt from "./modes/swarm-ant/SwarmAnt";
import ModelAnt from "./modes/model-ant/ModelAnt";
import AntSim from "./AntSim";
import InfiniteSim from "./components/InfiniteSim";
import NotFound from "./components/NotFound";
import SimulationIndex from "./components/SimulationIndex";
import LocalWarMode from "./modes/war/LocalWarMode";
import OnlineWarMode from "./modes/war/OnlineWarMode";
import { appHref, resolveAppRoute } from "./routes";

const Onboarding = lazy(() => import("./modes/onboarding/Onboarding"));
const StrategyLab = lazy(() => import("./modes/strategy-lab/StrategyLab"));
const MazeMemoryLab = lazy(() => import("./modes/maze-memory/MazeMemoryLab"));

export default function App() {
  const basePath = import.meta.env.BASE_URL;
  const route = resolveAppRoute(window.location.pathname, basePath);
  const href = (pathname: string) => appHref(pathname, basePath);

  if (route === "levels") return <Levels href={href} />;
  if (route === "index") return <SimulationIndex href={href} />;

  let content;
  if (route === "onboarding") content = <Suspense fallback={<p>Loading onboarding…</p>}><Onboarding /></Suspense>;
  else if (route === "strategy-lab") content = <Suspense fallback={<p>Loading Strategy Lab…</p>}><StrategyLab /></Suspense>;
  else if (route === "maze-memory") content = <Suspense fallback={<p>Loading Maze Memory Lab…</p>}><MazeMemoryLab /></Suspense>;
  else if (route === "delivery-lab") content = <DeliveryLab />;
  else if (route === "model-war") content = <ModelWar />;
  else if (route === "highway-lab") content = <HighwayLab />;
  else if (route === "protocol-lab") content = <ProtocolLab />;
  else if (route === "coordination-lab") content = <CoordinationLab />;
  else if (route === "swarm-ant") content = <SwarmAnt />;
  else if (route === "model-ant") content = <ModelAnt />;
  else if (route === "war") content = <LocalWarMode />;
  else if (route === "multiplayer") content = <OnlineWarMode />;
  else if (route === "not-found") content = <NotFound href={href} />;
  else content = route === "maze" ? <AntSim /> : <InfiniteSim simulationsHref={href("/")} />;

  return (
    <>
      {content}
      {route !== "infinite" && (
        <a className="simulation-backlink" href={href("/levels")}>← Levels</a>
      )}
    </>
  );
}
