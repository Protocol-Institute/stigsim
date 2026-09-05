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
      </section>
    </main>
  );
}
