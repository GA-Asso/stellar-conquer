import './style.css';
import { aiThink, createAi, type AiMemory, type Difficulty } from './sim/ai';
import { DT } from './sim/defs';
import { applyCommand, coreOf, createSim, freePorts, modules, step, units, type SideCommand } from './sim/sim';
import type { Command, Side, SimState } from './sim/types';
import { createSpaceScene } from './render/scene';
import { GameView } from './render/view';
import { Hud } from './ui/hud';
import { Input } from './ui/input';

const LOCAL: Side = 0;
const app = document.getElementById('app')!;
const space = createSpaceScene(app);

interface Game { sim: SimState; ai: AiMemory; view: GameView; input: Input; hud: Hud; pending: Command[]; ended: boolean }
let game: Game | null = null;
let paused = false;
let speed = 1;

function showLobby() {
  const d = document.createElement('div');
  d.className = 'lobby';
  d.innerHTML = `
    <div class="lobby-card">
      <div class="title"><span class="logo big"></span><h1>STELLAR <b>CONQUER</b></h1></div>
      <p class="tag">Estrategia en tiempo real sobre el ecosistema Stellar.<br>Mina Lumens, acopla tu estación módulo a módulo, conquista planetas y derriba el Núcleo rival.</p>
      <div class="diff">
        <span>Dificultad del rival</span>
        <div class="opts">
          <button data-d="facil">Fácil</button><button data-d="normal" class="on">Normal</button><button data-d="dificil">Difícil</button>
        </div>
      </div>
      <button class="play">Despegar</button>
      <p class="hint">Gana destruyendo el Núcleo Estelar enemigo, o si tu Faro de Consenso resiste 30 ledgers.</p>
    </div>`;
  let diff: Difficulty = 'normal';
  d.querySelectorAll<HTMLButtonElement>('.opts button').forEach(b => b.addEventListener('click', () => {
    d.querySelectorAll('.opts button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    diff = b.dataset.d as Difficulty;
  }));
  d.querySelector('.play')!.addEventListener('click', () => { d.remove(); start(diff); });
  app.appendChild(d);
}

function start(diff: Difficulty) {
  demoView?.dispose();
  demoView = null;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const sim = createSim(seed);
  const view = new GameView(space, LOCAL);
  const pending: Command[] = [];
  const send = (c: Command) => pending.push(c);
  let hud: Hud;
  const input = new Input(space, view, () => game!.sim, LOCAL, send, k => {
    if (k === 'P') { paused = !paused; return true; }
    return hud.hotkey(k === 'BACKSPACE' ? 'Backspace' : k);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Backspace' && game) { hud.hotkey('Backspace'); e.preventDefault(); } });
  hud = new Hud(app, space, view, input, LOCAL, send);
  game = { sim, ai: createAi(1, diff), view, input, hud, pending, ended: false };
  if (new URLSearchParams(location.search).has('vitrina')) showcase(sim);
  const core = coreOf(sim, LOCAL)!;
  space.rig.lookAt(core.pos.x + 20, core.pos.z - 20);
  input.ui.selected.add(core.id);
  hud.toast('Selecciona tus drones y mina los asteroides dorados (Lumens) y grises (metal).', 'info');
}

// ?vitrina: arma al instante una estación con todos los módulos y unidades, para revisar diseños
function showcase(sim: SimState) {
  const pl = sim.players[LOCAL];
  pl.era = 4;
  pl.res = { lumens: 1e5, metal: 1e5, energy: 1e5 };
  const drone = units(sim, LOCAL)[0].id;
  for (const t of ['habitat', 'solar', 'hangar', 'factory', 'lab', 'turret', 'beacon', 'habitat', 'solar'] as const) {
    const hex = freePorts(sim, LOCAL, t)[0];
    if (hex) applyCommand(sim, LOCAL, { kind: 'build', units: [drone], module: t, hex });
  }
  const core = coreOf(sim, LOCAL)!;
  applyCommand(sim, LOCAL, { kind: 'build', units: [drone], module: 'anchor', hex: { q: core.hex.q + 4, r: core.hex.r - 3 } });
  for (const m of modules(sim, LOCAL)) { m.built = 1; m.hp = m.maxHp; }
  for (const m of modules(sim, LOCAL)) {
    if (m.type === 'hangar') for (const u of ['interceptor', 'frigate', 'dreadnought'] as const) m.queue.push({ item: u, progress: 99, total: 1 });
    if (m.type === 'factory') for (const u of ['mecha', 'titan'] as const) m.queue.push({ item: u, progress: 99, total: 1 });
  }
}

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) {
    const g = game;
    if (!paused && !g.ended) {
      acc += dt * speed;
      while (acc >= DT) {
        const cmds: SideCommand[] = g.pending.splice(0).map(cmd => ({ side: LOCAL, cmd }));
        if (g.sim.tick % 10 === 5) for (const cmd of aiThink(g.sim, g.ai)) cmds.push({ side: g.ai.side, cmd });
        g.view.snapshot(g.sim);
        step(g.sim, cmds);
        g.view.handleEvents(g.sim);
        g.hud.onEvents(g.sim);
        acc -= DT;
        if (g.sim.winner !== null) {
          g.ended = true;
          g.hud.showEnd(g.sim, () => location.reload());
          break;
        }
      }
    }
    g.input.prune();
    g.input.update(dt);
    g.view.sync(g.sim, paused ? 1 : acc / DT, paused ? 0 : dt, g.input.ui.selected);
    g.hud.update(g.sim);
  } else {
    space.rig.rotate(dt * 0.05, 0);
  }
  space.render(dt);
  requestAnimationFrame(frame);
}

// fondo del lobby: el mapa de una partida, que se retira al despegar
let demoView: GameView | null = new GameView(space, 0);
demoView.sync(createSim(2026), 1, 0, new Set());
space.rig.lookAt(-120, 100);
space.rig.zoom(1.3);
showLobby();
requestAnimationFrame(frame);
