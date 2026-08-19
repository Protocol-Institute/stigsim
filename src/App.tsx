import AntSim from "./AntSim";
import InfiniteSim from "./components/InfiniteSim";

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  return path === "/infinite" ? <InfiniteSim /> : <AntSim />;
}
