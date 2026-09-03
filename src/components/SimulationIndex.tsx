type SimulationCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  status: "available" | "coming-soon";
  accent: string;
};

function SimulationCard({ eyebrow, title, description, href, status, accent }: SimulationCardProps) {
  return (
    <a className="simulation-card" href={href} style={{ "--card-accent": accent } as React.CSSProperties}>
      <div className="simulation-card__topline">
        <span className="simulation-card__eyebrow">{eyebrow}</span>
        <span className={`simulation-card__status simulation-card__status--${status}`}>
          {status === "available" ? "Available" : "Coming soon"}
        </span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <span className="simulation-card__action">
        {status === "available" ? "Open simulation" : "View planned mode"}
        <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

export default function SimulationIndex() {
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
          href="/maze"
          status="available"
          accent="#f59e0b"
        />
        <SimulationCard
          eyebrow="Online · Persistent world"
          title="Infinite World"
          description="Shape one continuous shared environment whose colonies and terrain persist between visits."
          href="/infinite"
          status="available"
          accent="#4ade80"
        />
      </section>

      <section className="simulation-index__upcoming" aria-labelledby="upcoming-title">
        <div className="simulation-index__section-heading">
          <p>In development</p>
          <h2 id="upcoming-title">War Mode</h2>
        </div>
        <div className="simulation-grid simulation-grid--upcoming">
          <SimulationCard
            eyebrow="Local · Two players"
            title="Local War Mode"
            description="Control two competing colonies side by side."
            href="/war"
            status="coming-soon"
            accent="#60a5fa"
          />
          <SimulationCard
            eyebrow="Online · Multiplayer"
            title="Online War Mode"
            description="Create, join, or spectate a server-authoritative match."
            href="/multiplayer"
            status="coming-soon"
            accent="#fb7185"
          />
        </div>
      </section>
    </main>
  );
}
