type SimulationCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  accent: string;
};

function SimulationCard({ eyebrow, title, description, href, accent }: SimulationCardProps) {
  return (
    <a className="simulation-card" href={href} style={{ "--card-accent": accent } as React.CSSProperties}>
      <span className="simulation-card__eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <span className="simulation-card__action">
        Open simulation
        <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

export default function SimulationIndex({ href }: { href: (pathname: string) => string }) {
  return (
    <main className="simulation-index">
      <header className="simulation-index__header">
        <p className="simulation-index__kicker">Protocol Institute</p>
        <h1>Stigsim</h1>
        <p className="simulation-index__intro">
          Explore how ant colonies coordinate through shared signals—alone, head-to-head,
          or inside a persistent world.
        </p>
      </header>

      <section className="simulation-grid" aria-label="Simulations">
        <SimulationCard eyebrow="PR #32 · Colony strategies" title="Strategy Lab" description="Work with an AI to design an observer and controller. Watch one maze, then test food collection across 100 mazes." href={href("/strategy-lab")} accent="#91e4c7" />
        <SimulationCard eyebrow="PR #34 · Model-directed navigation" title="Maze Memory Lab" description="Design instructions and environmental memory for Jev. Inspect its choices and improve tokens per maze solved." href={href("/maze-memory")} accent="#bddb91" />
        <SimulationCard eyebrow="Local · Paired benchmark" title="Food Delivery Lab" description="Find strong fixed ant settings on training mazes, validate on unseen seeds, then test a mid-run intervention." href={href("/delivery-lab")} accent="#86efac" />
        <SimulationCard eyebrow="Local · Model vs model" title="Model War" description="Two models command competing colonies, adapt during each game, and learn between games in a best-of-five series." href={href("/model-war")} accent="#f0abfc" />
        <SimulationCard
          eyebrow="Local · Sandbox"
          title="Maze Simulator"
          description="Generate a maze, tune colony behavior, and run reproducible experiments in your browser."
          href={href("/maze")}
          accent="#f59e0b"
        />
        <SimulationCard
          eyebrow="Online · Persistent world"
          title="Infinite World"
          description="Shape one continuous shared environment whose colonies and terrain persist between visits."
          href={href("/infinite")}
          accent="#4ade80"
        />
        <SimulationCard
          eyebrow="Local · Two players"
          title="Local War Mode"
          description="Control two competing colonies side by side."
          href={href("/war")}
          accent="#60a5fa"
        />
        <SimulationCard
          eyebrow="Online · Multiplayer"
          title="Online War Mode"
          description="Create, join, or spectate a server-authoritative match."
          href={href("/multiplayer")}
          accent="#fb7185"
        />
        <SimulationCard eyebrow="Experiment · One ant" title="Model Ant" description="Can a language model find the exit with only a local view and its own memory? Watch one decision at a time." href={href("/model-ant")} accent="#a3e635" />
        <SimulationCard eyebrow="Experiment · Agent team" title="Shared Pebbles" description="Different models explore one maze, leaving timestamped messages on shared pebbles. One agent finds the exit; the team wins." href={href("/swarm-ant")} accent="#c084fc" />
        {import.meta.env.DEV && <SimulationCard eyebrow="Local lab · Deterministic team" title="Coordination Lab" description="Watch two deterministic explorers share branch claims, compared with independent exploration on the same maze." href={href("/coordination-lab")} accent="#2dd4bf" />}
        {import.meta.env.DEV && <SimulationCard eyebrow="Local research · Protocol design" title="Protocol Workshop" description="Let a model invent deterministic controllers and marker conventions, revise on practice mazes, then freeze and test on unseen mazes." href={href("/protocol-lab")} accent="#f5c77e" />}
        <SimulationCard eyebrow="Local experiment · Seeded comparisons" title="Highway Lab" description="Compare ant settings across the same random mazes. Watch routes emerge and measure how quickly stable highways form." href={href("/highway-lab")} accent="#5eead4" />
      </section>
    </main>
  );
}
