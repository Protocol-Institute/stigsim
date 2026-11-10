import './levels.css';

const levels = [
  { number:'01', title:'Be an ant', role:'Experience the signals', description:'Find food and bring it home. Explore a local view while other ants build the trails around you.', mode:'Onboarding · Level 1', path:'/onboarding', action:'Control one ant', accent:'#e5b466' },
  { number:'02', title:'Guide the colony', role:'See the collective behavior', description:'See the whole colony. Adjust evaporation and trail bias, and watch how the ants and their trails respond.', mode:'Maze Simulator', path:'/maze', action:'Guide a colony', accent:'#c9cb89' },
  { number:'03', title:'Automate your strategy', role:'Turn an idea into rules', description:'Work with your coding agent to build an observer and controller. Watch one maze, then test food collection across 100.', mode:'Strategy Lab', path:'/strategy-lab', action:'Build a strategy', accent:'#91d4ba' },
  { number:'04', title:'Design a system for model ants', role:'Shape the interface and memory', description:'Use a larger model to design instructions and environmental memory. Let Jev choose the moves, then inspect and improve the system.', mode:'Maze Memory Lab', path:'/maze-memory', action:'Design a model system', accent:'#9dbce0' },
  { number:'05', title:'Watch models compete', role:'Observe decisions under pressure', description:'Two models command competing colonies, adapt during play, and carry lessons through a best-of-five series.', mode:'Model War', path:'/model-war', action:'Open Model War', accent:'#c7a7d8' },
];

export default function Levels({ href }: { href:(path:string)=>string }) {
  return <main className="levels-page">
    <header className="levels-intro">
      <p className="levels-kicker">Stigsim / An evolving learning journey</p>
      <h1>From one ant to systems of agents</h1>
      <p>Learn the world. Influence the colony. Build something with your AI.</p>
    </header>
    <ol className="levels-list">
      {levels.map(level=><li key={level.number} style={{'--level-accent':level.accent} as React.CSSProperties}>
        <span className="levels-number" aria-hidden="true">{level.number}</span>
        <div className="levels-name"><p>{level.role}</p><h2>{level.title}</h2></div>
        <div className="levels-description"><p>{level.description}</p><span>{level.mode}</span></div>
        <a href={href(level.path)}>{level.action}<span aria-hidden="true"> ↗</span></a>
      </li>)}
    </ol>
    <footer className="levels-notes">
      <p><strong>Explore each level directly.</strong> Start with one ant in onboarding, or open the Maze Simulator to guide a colony. Levels 3–5 open the existing experimental modes.</p>
      <p>Model War currently uses models as colony commanders. Competition between systems designed in level 4 is a future step.</p>
      <a href={href('/')}>Browse all simulations →</a>
    </footer>
  </main>;
}
