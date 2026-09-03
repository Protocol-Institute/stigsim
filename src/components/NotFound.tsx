export default function NotFound() {
  return (
    <main className="route-message">
      <a className="route-message__back" href="/">← All simulations</a>
      <div className="route-message__panel">
        <span className="route-message__status">404</span>
        <h1>That route does not exist</h1>
        <p>Choose one of the simulations from the Stigsim index.</p>
        <a className="route-message__primary" href="/">View simulations</a>
      </div>
    </main>
  );
}
