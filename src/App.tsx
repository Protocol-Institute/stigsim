import AntSim from "./AntSim";
import Multiplayer from "./Multiplayer";
import InfiniteSim from "./components/InfiniteSim";

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/infinite") return <InfiniteSim />;
  if (path === "/multiplayer") return <Multiplayer />;
  return <AntSim />;
}
