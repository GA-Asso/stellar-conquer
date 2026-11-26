import './style.css';
import { aiThink, createAi, type AiMemory, type Difficulty } from './sim/ai';
import { DT } from './sim/defs';
import { addUnit, applyCommand, coreOf, createSim, freePorts, modules, step, units, type SideCommand } from './sim/sim';
import type { Command, Side, SimState } from './sim/types';
import { createSpaceScene } from './render/scene';
import { GameView } from './render/view';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { consumeLoadout, loadWorld, saveWorld, settleMatch, tickLedger, type MatchLoadout, type Sector, type WorldState } from './world/economy';
import { WorldHud } from './world/hud';
import { Universe } from './world/universe';

const LOCAL: Side = 0;
const app = document.getElementById('app')!;
const space = createSpaceScene(app);

interface Game { sim: SimState; ai: AiMemory; view: GameView; input: Input; hud: Hud; pending: Command[]; ended: boolean }
let game: Game | null = null;
let paused = false;
let speed = 1;

// Universo Stellar: el mundo abierto donde se descubre el ecosistema y desde el que se lanzan las partidas
interface Cosmos { world: WorldState; universe: Universe; hud: WorldHud; ledgerAcc: number }
let cosmos: Cosmos | null = null;
const LEDGER_SECONDS = 5;
const RETURN_KEY = 'stellar-conquer.return';

function showLobby() {
  const d = document.createElement('div');
  d.className = 'lobby';
  d.innerHTML = `
    <div class="lobby-card">
      <div class="title"><span class="logo big"></span><h1>STELLAR <b>CONQUER</b></h1></div>
      <p class="tag">Estrategia en tiempo real sobre el ecosistema Stellar.<br>Mina Lumens, acopla tu estación módulo a módulo, conquista planetas y derriba el Núcleo rival.</p>
      <div class="howto">
        <div><i>◆</i><b>1 · Recolecta</b><p>Selecciona tus drones <span class="cy">(cian)</span> y haz clic derecho en asteroides <span class="gold">dorados (Lumens)</span> o <span class="cu">cobrizos (metal)</span>.</p></div>
        <div><i>⬡</i><b>2 · Acopla módulos</b><p>Con un dron elige un módulo y colócalo en un hexágono verde pegado a tu estación: hábitats, paneles, hangares…</p></div>
        <div><i>➤</i><b>3 · Arma tu flota</b><p>Hangar = naves. Forja = robots, los únicos que conquistan planetas. Cada planeta paga Lumens en cada ledger.</p></div>
        <div><i>✦</i><b>4 · Gana</b><p>Destruye el Núcleo <span class="pk">rosa</span> del rival, o construye el Faro de Consenso y haz que resista 30 ledgers.</p></div>
      </div>
      <button class="play" id="go-universe">Entrar al Universo Stellar</button>
      <p class="footnote">Vuela entre galaxias del ecosistema, descubre sus proyectos, comercia en el DEX y el mercado, y conquista la Frontera.</p>
      <div class="diff">
        <span>O juega una partida rápida · rival</span>
        <div class="opts">
          <button data-d="facil">Fácil</button><button data-d="normal" class="on">Normal</button><button data-d="dificil">Difícil</button>
        </div>
      </div>
      <button class="play secondary" id="go-match">Partida rápida</button>
      <p class="footnote">Una guía de objetivos te acompaña durante la partida (arriba a la izquierda). Pasa el ratón sobre cualquier botón para ver para qué sirve.</p>
    </div>`;
  let diff: Difficulty = 'normal';
  d.querySelectorAll<HTMLButtonElement>('.opts button').forEach(b => b.addEventListener('click', () => {
    d.querySelectorAll('.opts button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    diff = b.dataset.d as Difficulty;
  }));
  d.querySelector('#go-match')!.addEventListener('click', () => { d.remove(); start(diff); });
  d.querySelector('#go-universe')!.addEventListener('click', () => { d.remove(); enterUniverse(); });
  app.appendChild(d);
}

function enterUniverse() {
  demoView?.dispose();
  demoView = null;
  const world = loadWorld();
  const save = () => saveWorld(world);
  // el universo se crea primero: el HUD puede abrir la ayuda (y congelar la nave) al construirse
  let hud: WorldHud | null = null;
  const universe = new Universe(space, world, app, {
    onNode: n => hud?.setNode(n),
    onGalaxy: g => hud?.setGalaxy(g),
  });
  hud = new WorldHud(app, world, {
    onChange: () => { save(); universe.refresh(); },
    onLaunch: sector => launch(sector),
    onQuickMatch: () => launch(null),
    setFrozen: f => { universe.frozen = f; },
  });
  cosmos = { world, universe, hud, ledgerAcc: 0 };
  // solo en desarrollo: acceso desde la consola para probar (p. ej. __cosmos.universe.flyTo(...))
  if (import.meta.env.DEV) (window as unknown as { __cosmos: Cosmos }).__cosmos = cosmos;
  save();
}

/** sale del universo hacia una partida; `sector` null = partida rápida contra un rival normal */
function launch(sector: Sector | null) {
  if (!cosmos) return;
  const { world, universe, hud } = cosmos;
  const loadout = consumeLoadout(world);
  saveWorld(world);
  universe.dispose();
  hud.destroy();
  cosmos = null;
  start(sector?.difficulty ?? 'normal', { sector, loadout, world });
}

interface MatchContext { sector: Sector | null; loadout: MatchLoadout; world: WorldState }
let matchCtx: MatchContext | null = null;

function start(diff: Difficulty, ctx: MatchContext | null = null) {
  demoView?.dispose();
  demoView = null;
  matchCtx = ctx;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const sim = createSim(seed);
  if (ctx) applyLoadout(sim, ctx.loadout);
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
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  const vitrina = new URLSearchParams(location.search).has('vitrina');
  if (vitrina) showcase(sim);
  const core = coreOf(sim, LOCAL)!;
  space.rig.lookAt(core.pos.x + 20, core.pos.z - 20);
  if (vitrina) { space.rig.lookAt(-70, 51); space.rig.zoom(0.5); }
  input.ui.selected.add(core.id);
  hud.toast('Selecciona tus drones y mina los asteroides dorados (Lumens) y cobrizos (metal).', 'info');
}

// los ítems quemados al despegar aportan unidades y recursos iniciales
function applyLoadout(sim: SimState, l: MatchLoadout) {
  const core = coreOf(sim, LOCAL)!;
  for (let i = 0; i < l.interceptors; i++) addUnit(sim, 'interceptor', LOCAL, { x: core.pos.x + 14 + (i % 3) * 5, z: core.pos.z - 8 + Math.floor(i / 3) * 5 });
  for (let i = 0; i < l.mechas; i++) addUnit(sim, 'mecha', LOCAL, { x: core.pos.x + 14 + i * 6, z: core.pos.z + 10 });
  sim.players[LOCAL].res.lumens += l.bonus.lumens;
  sim.players[LOCAL].res.metal += l.bonus.metal;
}

function endMatch(g: Game) {
  const ctx = matchCtx;
  if (!ctx) { g.hud.showEnd(g.sim, () => location.reload()); return; }
  const won = g.sim.winner === LOCAL;
  const res = { ...g.sim.players[LOCAL].res };
  const msg = settleMatch(ctx.world, { sector: ctx.sector?.id ?? '', won, res });
  saveWorld(ctx.world);
  g.hud.showEnd(g.sim, () => {
    try { sessionStorage.setItem(RETURN_KEY, '1'); } catch { /* sin almacenamiento: vuelve al lobby */ }
    location.reload();
  }, { label: 'Volver al universo', extra: msg });
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
  // desfile de unidades de ambos equipos en espacio abierto
  const types = ['drone', 'interceptor', 'mecha', 'frigate', 'titan', 'dreadnought'] as const;
  types.forEach((t, i) => {
    addUnit(sim, t, 0, { x: -110 + i * 16, z: 40 });
    addUnit(sim, t, 1, { x: -110 + i * 16, z: 62 });
  });
  for (const m of modules(sim, LOCAL)) {
    if (m.type === 'hangar' || m.type === 'factory') m.rally = { x: core.pos.x + 55, z: core.pos.z + (m.type === 'hangar' ? -10 : 15) };
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
          endMatch(g);
          break;
        }
      }
    }
    g.input.prune();
    g.input.update(dt);
    g.view.sync(g.sim, paused ? 1 : acc / DT, paused ? 0 : dt, g.input.ui.selected);
    g.hud.update(g.sim);
  } else if (cosmos) {
    cosmos.universe.update(dt);
    cosmos.ledgerAcc += dt;
    if (cosmos.ledgerAcc >= LEDGER_SECONDS) {
      cosmos.ledgerAcc -= LEDGER_SECONDS;
      tickLedger(cosmos.world);
      saveWorld(cosmos.world);
      cosmos.hud.onLedger();
    }
    cosmos.hud.update();
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
let returning = false;
try { returning = sessionStorage.getItem(RETURN_KEY) === '1'; sessionStorage.removeItem(RETURN_KEY); } catch { /* sin almacenamiento */ }
if (returning) enterUniverse(); else showLobby();
requestAnimationFrame(frame);
