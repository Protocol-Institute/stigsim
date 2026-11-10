import { useEffect, useRef, useState } from 'react';
import { W, H, CELL, COLS, cellCenter, type Simulation } from '@stigsim/sim-core';
import { render } from '../../render';
import { ColonyLesson, ForagerLesson, ONBOARDING_SEED, ONBOARDING_FOOD, settings, type Level } from './scenarios';
import './onboarding.css';

const directions = [
  {name:'Up',key:'ArrowUp',dx:0,dy:-1,symbol:'↑'},
  {name:'Left',key:'ArrowLeft',dx:-1,dy:0,symbol:'←'},
  {name:'Down',key:'ArrowDown',dx:0,dy:1,symbol:'↓'},
  {name:'Right',key:'ArrowRight',dx:1,dy:0,symbol:'→'},
];
const evaporationRates=[.0001,.001,.002,.005,.02,.05,.08];

export default function Onboarding() {
  const [level,setLevel]=useState<Level>(1),[unlocked,setUnlocked]=useState(false);
  const [,update]=useState(0),[paused,setPaused]=useState(false),[speed,setSpeed]=useState(1);
  const [zoom,setZoom]=useState(3),zoomRef=useRef(3);
  const [hint,setHint]=useState(0),[message,setMessage]=useState(''),[evap,setEvap]=useState(.0001),[bias,setBias]=useState(8);
  const canvas=useRef<HTMLCanvasElement>(null),sim=useRef<Simulation|null>(null);
  const forager=useRef<ForagerLesson|null>(null),mazeSeed=useRef(ONBOARDING_SEED);
  const lesson=useRef<ColonyLesson|null>(null),currentLevel=useRef<Level>(1);
  const pauseRef=useRef(false),speedRef=useRef(1),finishedOne=useRef(false);
  pauseRef.current=paused;speedRef.current=speed;
  function draw(){
    const ctx=canvas.current?.getContext('2d');
    if(ctx&&sim.current){ctx.setTransform(1,0,0,1,0,0);render(ctx,sim.current,currentLevel.current===1?'one':'all',forager.current?.antIndex??0,'none',null,undefined,CELL*zoomRef.current);
      if(currentLevel.current===2){
        const target=ONBOARDING_FOOD[1],x=target.x*CELL,y=target.y*CELL;
        ctx.strokeStyle='#f5c879';ctx.lineWidth=2;ctx.strokeRect(x-3,y-3,CELL+6,CELL+6);
        ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='bottom';
        ctx.fillStyle='#100c07';ctx.fillRect(x-27,y-19,70,13);
        ctx.fillStyle='#f5c879';ctx.fillText('NEW SOURCE',x+CELL/2,y-7);
      }}
  }
  function begin(next:Level){
    if(next===2){
      if(currentLevel.current===2||!forager.current?.delivered)return;
      pauseRef.current=true;
      lesson.current=new ColonyLesson(forager.current.sim);
      currentLevel.current=2;setLevel(2);finishedOne.current=false;
      const d=sim.current!.colonies[0].doctrine;
      setEvap(d.evapRate);setBias(d.forager.follow.searching.food.own);
      setPaused(true);setHint(0);setMessage('');update(x=>x+1);draw();return;
    }
    currentLevel.current=1;setLevel(1);setUnlocked(false);setPaused(false);
    setHint(0);setMessage('');finishedOne.current=false;lesson.current=null;
    forager.current=new ForagerLesson(mazeSeed.current);sim.current=forager.current.sim;
    update(x=>x+1);draw();
  }
  function move(dx:number,dy:number){
    const s=sim.current;if(!s||currentLevel.current!==1||finishedOne.current)return;
    const a=s.allAnts[forager.current!.antIndex],p=cellCenter(a.cx,a.cy);
    if(Math.abs(a.x-p.px)+Math.abs(a.y-p.py)>1)return;
    if(!s.occupancy.isOpen(a.cx+dx,a.cy+dy)){setMessage('That direction is a wall. Try an open passage.');return;}
    setMessage('');s.enqueue({kind:'moveManualAnt',dx,dy});s.flushPending();
  }
  useEffect(()=>{
    begin(1);let frame=0,last=0,acc=0;
    const loop=(now:number)=>{
      const elapsed=Math.min(100,now-last||0);last=now;const s=sim.current;
      if(s&&!pauseRef.current&&!finishedOne.current){
        acc+=elapsed*60*speedRef.current/1000;
        let changed=false;
        while(acc>=1){
          acc--;
          if(lesson.current)lesson.current.step();else forager.current!.step();changed=true;
          if(currentLevel.current===1&&forager.current?.delivered){finishedOne.current=true;setUnlocked(true);break;}
        }
        if(changed)update(x=>x+1);
      }else acc=0;
      draw();frame=requestAnimationFrame(loop);
    };
    frame=requestAnimationFrame(loop);
    const key=(e:KeyboardEvent)=>{
      if(/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))return;
      const d=directions.find(d=>d.key===e.key);
      if(d&&currentLevel.current===1){e.preventDefault();move(d.dx,d.dy);}
    };
    window.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',key);};
  },[]);
  const s=sim.current,a=s?.allAnts[forager.current?.antIndex??0],g=lesson.current,carrying=!!a?.hasFood;
  const done=level===1&&finishedOne.current;
  const local=a&&s?directions.map(d=>({...d,open:s.occupancy.isOpen(a.cx+d.dx,a.cy+d.dy),
    food:s.colonies[0].field.get('food',a.cx+d.dx,a.cy+d.dy),
    home:s.colonies[0].field.get('home',a.cx+d.dx,a.cy+d.dy)})):[];
  function adjust(e:number,b:number){setEvap(e);setBias(b);if(sim.current)settings(sim.current,e,b);update(x=>x+1);}
  const hints=level===1?[
    'Yellow ants are carrying food home and leaving green food trails. Follow those trails toward where they came from.',
    'At a junction, compare the food trails and watch traffic. Trails mark where ants have traveled; a stronger trail is a clue, not an arrow.',
    'Once you have food, use blue home trails and watch returning ants. A trail can have branches: explore, remember junctions, and try again if a branch fades.'
  ]:[
    'Watch this same colony from above. A green trail shows where food-carrying ants have traveled; loops are possible, not guaranteed.',
    'If ants keep circling without deliveries, try reducing trail bias or increasing evaporation. These changes affect useful trails too.',
    'Try more evaporation and less trail bias to disrupt a route. Then reduce evaporation and restore some trail bias to reinforce a new one. A new route is observed only when its delivered path differs.'
  ];
  return <main className="ob-page">
    <header className="ob-header">
      <div><p className="ob-kicker">Stigsim · Learn by playing · Local prototype</p><h1>From one ant to a colony</h1></div>
      <nav aria-label="Lesson levels">
        <button aria-current={level===1?'step':undefined} disabled={level===2} onClick={()=>{}}>01 · Bring food home {unlocked?'✓':''}</button>
        <button disabled={!unlocked} aria-current={level===2?'step':undefined} onClick={()=>begin(2)}>02 · Guide the colony</button>
      </nav>
    </header>
    <div className="ob-layout"><section className="ob-field">
      <div className="ob-field-head"><span>{level===1?'Your ant’s local view':'The whole colony'}</span><span>{level===1?(carrying?'● Carrying food':'● Searching'):(s?.colonies[0].foodCollected??0)+' food delivered'}</span></div>
      <canvas ref={canvas} width={W} height={H} aria-label={level===1?'Close-up controlled ant, using the same local view as Maze Simulator':'The same generated maze, ants and pheromone trails viewed from above'} />
      <div className="ob-legend">
        <span><i className="home"/>Home trail · blue</span><span><i className="food"/>Food trail · green</span>
        <span><i className="ant"/>Searching ant</span><span><i className="carrying"/>Carrying food · yellow</span>
      </div>
      {level===1&&<div className="ob-view-control"><label htmlFor="ob-view">Local view</label><select id="ob-view" value={zoom} onChange={e=>{zoomRef.current=+e.target.value;setZoom(+e.target.value);}}><option value={3}>Nearby · 6 cells across</option><option value={1}>Close · original Maze view</option></select></div>}
      {level===1&&!done&&<div className="ob-movement">
        <div className="ob-pad" aria-label="Move your ant">{directions.map(d=><button key={d.name} className={'ob-'+d.name.toLowerCase()} aria-label={'Move '+d.name.toLowerCase()} onClick={()=>move(d.dx,d.dy)}>{d.symbol}</button>)}</div>
        <p>Use the arrow keys or buttons.<br/>You control the glowing ant. The others forage on their own.</p>
      </div>}
      {level===2&&<div className="ob-playback">
        <button onClick={()=>setPaused(p=>!p)}>{paused?'▶ Resume':'Ⅱ Pause'}</button>
        <label>Speed <select value={speed} onChange={e=>setSpeed(+e.target.value)}><option value={1}>Fast · 60 ticks/s</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        <span>Tick {s?.tick??0}</span>
      </div>}
    </section><aside className="ob-lesson">
      <p className="ob-kicker">Level {level} / 2</p>
      <h2>{done?(level===1?'Your first delivery':'A food highway is working'):level===1?(carrying?'Now bring it home':'Find food. Bring it home.'):'Create an ant highway to the new source'}</h2>
      <p className="ob-intro">{done?(level===1?'You brought your own food home while the colony kept foraging. You read and contributed to the same signals as the other ants.':'The same colony is repeatedly using a food-delivery route. Your local view and the colony view are two scales of the same world.'):level===1?(carrying?'Your ant is yellow because it is carrying food. Follow the blue home trail back to the nest.':'You are a randomly chosen ant in a fresh maze with 99 others. The maze starts without trails. Explore while the colony builds them, then use what you see to find food and bring it home.'):'Adjust evaporation and trail bias to redirect ants to the highlighted food source.'}</p>
      {level===1&&<p className="ob-colony-count">Colony deliveries: {s?.colonies[0].foodCollected??0} · Your deliveries: {done?1:0} / 1</p>}
      {level===1&&<ol className="ob-checklist">
        <li className={forager.current?.pickedUp?'met':''}>{forager.current?.pickedUp?'✓':'1'} Pick up food yourself</li>
        <li className={done?'met':''}>{done?'✓':'2'} Deliver your food to the nest</li>
      </ol>}
      {level===2&&<>
        <div className="ob-sliders">
          <label htmlFor="ob-evap">Evaporation <strong>{(evap*100).toLocaleString(undefined,{maximumFractionDigits:2})}% / tick</strong></label>
          <input id="ob-evap" aria-label="Evaporation rate" type="range" min={0} max={6} step={1} value={evaporationRates.indexOf(evap)} onChange={e=>adjust(evaporationRates[+e.target.value],bias)}/>
          <p>How quickly trails fade.</p>
          <label htmlFor="ob-bias">Trail bias <strong>{bias}</strong></label>
          <input id="ob-bias" aria-label="Trail bias" type="range" min={0} max={8} step={.5} value={bias} onChange={e=>adjust(evap,+e.target.value)}/>
          <p>How strongly ants follow trails.</p>
        </div>
        <p className="ob-small">Food at new source: {s?.foodSources.find(f=>f.x===ONBOARDING_FOOD[1].x&&f.y===ONBOARDING_FOOD[1].y)?.remaining??0}</p>
        {g?.highways.some(h=>h.route.startsWith(String(ONBOARDING_FOOD[1].y*COLS+ONBOARDING_FOOD[1].x)+','))&&<p className="met" role="status">New-source highway detected. Keep experimenting.</p>}
      </>}
      {done?<div className="ob-success" role="status">
        <h3>{level===1?'Ready for the colony?':'Different moments need different settings'}</h3>
        <p>{level===1?'You know what the signals mean from the ant’s point of view. Next, influence all the ants at once.':Math.round((g?.highwayShare??0)*100)+'% of ants shared a delivered route when the highway was confirmed. This is one random maze, not evidence that these settings are optimal everywhere.'}</p>
        {level===1?<button className="ob-primary" onClick={()=>begin(2)}>Level 2 · Zoom out to your colony →</button>:<p className="ob-next">Next question: could you build a system that knows when to make these changes?</p>}
      </div>:<div className="ob-hints"><button onClick={()=>setHint(h=>Math.min(h+1,3))}>{hint?'Another hint':'Need a hint?'}</button>{hint>0&&<p role="status">{hints[hint-1]}</p>}</div>}
      {message&&<p className="ob-notice" role="status">{message}</p>}
      {level===1&&!done&&<details><summary>Signals beside your ant</summary>
        <table><thead><tr><th>Direction</th><th>Food trail</th><th>Home trail</th></tr></thead><tbody>{local.map(d=><tr key={d.name}><td>{d.symbol}</td><td>{d.open?Math.round(d.food):'Wall'}</td><td>{d.open?Math.round(d.home):'Wall'}</td></tr>)}</tbody></table>
        <p className="ob-small">Local trail strengths are clues, not guarantees. The nest and food also have their own smells.</p>
      </details>}
      <div className="ob-reset-row"><button className="ob-reset" onClick={()=>begin(1)}>Restart this maze</button></div>
      {level===1&&<p className="ob-small">Maze rustic-ember-1253 · 100 ants · no pre-laid trails. You control ant {(forager.current?.antIndex??0)+1}.</p>}
    </aside></div>
  </main>;
}
