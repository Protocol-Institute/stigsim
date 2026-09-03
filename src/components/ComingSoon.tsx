export default function ComingSoon({ mode }: { mode: "Local War Mode" | "Online War Mode" }) {
  return (
    <main className="route-message">
      <a className="route-message__back" href="/">← All simulations</a>
      <div className="route-message__panel">
        <span className="route-message__status">Coming soon</span>
        <h1>{mode}</h1>
        <p>
          This route is reserved for the War Mode integration. The existing prototype is being
          brought into the shared simulation architecture in focused, reviewable steps.
        </p>
        <a className="route-message__primary" href="/maze">Play the Maze Simulator</a>
      </div>
    </main>
  );
}
