// Economía del Universo Stellar: wallet, DEX con pools AMM, path payments, tienda, mercado P2P,
// encargos comerciales y recompensas. Lógica pura y determinista (sin DOM ni Three.js) que imita lo
// que hará la red: los pools siguen la fórmula x·y=k con la comisión de 0,30 % de los pools nativos de
// Stellar, las rutas son path payments de hasta 3 saltos y la tienda quema la mitad del pago como
// Armory. Hoy corre en local; el adaptador de testnet sustituirá estas funciones por transacciones.
import { Rng } from '../sim/rng';

export type Asset = 'XLM' | 'USDC' | 'STAR' | 'LMN' | 'MTL' | 'NRG';
export const ASSETS: Asset[] = ['XLM', 'USDC', 'STAR', 'LMN', 'MTL', 'NRG'];
export const ASSET_INFO: Record<Asset, { name: string; color: string; note: string }> = {
  XLM: { name: 'Lumen (XLM)', color: '#e8e8f0', note: 'activo nativo de Stellar: paga tarifas y es el puente entre mercados' },
  USDC: { name: 'USD Coin', color: '#2775ca', note: 'dólar digital emitido por Circle; entra y sale de la red por anclas' },
  STAR: { name: 'Star', color: '#fdda24', note: 'moneda del juego: tienda, mercado y recompensas de la Frontera' },
  LMN: { name: 'Lumen dorado', color: '#ffc83d', note: 'recurso minado en partida (no es XLM)' },
  MTL: { name: 'Metal', color: '#c07a4e', note: 'recurso de asteroides rocosos' },
  NRG: { name: 'Energía', color: '#5cc8ff', note: 'recurso de paneles solares' },
};

/** comisión de los pools de liquidez nativos de Stellar: 30 puntos básicos */
export const POOL_FEE = 0.003;
export const MAX_HOPS = 3;
/** igual que Vault: como mucho 3 ítems consumibles por partida y 500 de sobrante por recurso */
export const MAX_LOADOUT = 3;
export const LEFTOVER_CAP = 500;
/** igual que Conquest: recompensa base contra la IA y regalía del mercado */
export const FRONTIER_STAR = 10;
export const ROYALTY = 0.05;

export interface Pool { a: Asset; b: Asset; ra: number; rb: number }
export type Wallet = Record<Asset, number>;

export type ItemCategory = 'skin' | 'squadron' | 'blueprint';
export interface ItemDef { id: string; name: string; category: ItemCategory; price: number; desc: string; color?: string }
export const ITEMS: ItemDef[] = [
  { id: 'casco-dorado', name: 'Casco Dorado', category: 'skin', price: 40, desc: 'Pinta tu nave de oro Stellar en el universo.', color: '#fdda24' },
  { id: 'casco-violeta', name: 'Casco Violeta', category: 'skin', price: 25, desc: 'Acabado violeta de nebulosa.', color: '#8b5cff' },
  { id: 'casco-cian', name: 'Casco Cian', category: 'skin', price: 15, desc: 'El clásico de los pilotos de la Frontera.', color: '#2ee6ff' },
  { id: 'escuadra-interceptores', name: 'Escuadra de Interceptores', category: 'squadron', price: 30, desc: 'Empiezas la partida con 3 interceptores. Se consume al despegar.' },
  { id: 'escuadra-mechas', name: 'Escuadra de Mechas', category: 'squadron', price: 45, desc: 'Empiezas con 2 mechas que ya pueden conquistar planetas. Se consume.' },
  { id: 'plano-reservas', name: 'Plano de Reservas', category: 'blueprint', price: 20, desc: 'Empiezas con +300 Lumens y +200 de metal. Se consume.' },
];
export const itemDef = (id: string) => ITEMS.find(i => i.id === id)!;

export interface Listing { id: number; item: string; price: number; seller: string; mine: boolean; listedAt: number }
export interface Order { id: number; station: string; want: Asset; amount: number; pay: Asset; reward: number; expires: number }
export interface Sector { id: string; name: string; difficulty: 'facil' | 'normal' | 'dificil'; owner: 'player' | 'rival' }

export interface WorldState {
  version: 1;
  ledger: number;
  rng: number;
  wallet: Wallet;
  pools: Pool[];
  inventory: Record<string, number>;
  skin: string | null;
  loadout: string[];
  listings: Listing[];
  orders: Order[];
  sectors: Sector[];
  discovered: string[];
  /** proyectos del atlas que la nave ya visitó (slugs) */
  visited?: string[];
  stats: { burned: number; treasury: number; swaps: number; orders: number; wins: number; losses: number };
  nextId: number;
  log: string[];
}

const NPCS = ['Vega-7', 'Orión', 'Lyra', 'Kepler', 'Altair', 'Nova-3', 'Sirio'];
const STATIONS = ['Estación Vega', 'Puerto Andrómeda', 'Astillero Kepler', 'Colonia Lyra', 'Refinería Altair'];

export function createWorld(seed = 2026): WorldState {
  const w: WorldState = {
    version: 1,
    ledger: 0,
    rng: seed >>> 0,
    wallet: { XLM: 100, USDC: 20, STAR: 0, LMN: 200, MTL: 200, NRG: 100 },
    pools: [
      { a: 'XLM', b: 'USDC', ra: 200_000, rb: 50_000 },
      { a: 'STAR', b: 'XLM', ra: 100_000, rb: 100_000 },
      { a: 'LMN', b: 'XLM', ra: 400_000, rb: 40_000 },
      { a: 'MTL', b: 'XLM', ra: 300_000, rb: 45_000 },
      { a: 'NRG', b: 'XLM', ra: 200_000, rb: 50_000 },
      { a: 'LMN', b: 'USDC', ra: 100_000, rb: 2_400 },
    ],
    inventory: {},
    skin: null,
    loadout: [],
    listings: [],
    orders: [],
    sectors: [
      { id: 'umbral', name: 'Sector Umbral', difficulty: 'facil', owner: 'rival' },
      { id: 'cinturon', name: 'Cinturón de Cristal', difficulty: 'facil', owner: 'rival' },
      { id: 'vorágine', name: 'Vorágine Roja', difficulty: 'normal', owner: 'rival' },
      { id: 'bastion', name: 'Bastión Quórum', difficulty: 'normal', owner: 'rival' },
      { id: 'abismo', name: 'Abismo Galáctico', difficulty: 'dificil', owner: 'rival' },
    ],
    discovered: [],
    stats: { burned: 0, treasury: 0, swaps: 0, orders: 0, wins: 0, losses: 0 },
    nextId: 1,
    log: [],
  };
  for (let i = 0; i < 4; i++) npcListing(w);
  for (let i = 0; i < 3; i++) newOrder(w);
  return w;
}

const rngOf = (w: WorldState) => {
  const r = new Rng(w.rng);
  return { r, done: () => { w.rng = r.state; } };
};
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
function note(w: WorldState, msg: string) {
  w.log.unshift(`L${w.ledger} · ${msg}`);
  w.log.length = Math.min(w.log.length, 30);
}

// ---------- DEX: pools AMM y path payments ----------

export function poolOf(w: WorldState, x: Asset, y: Asset): Pool | undefined {
  return w.pools.find(p => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

/** salida de un salto x·y=k con la comisión cobrada sobre la entrada */
export function hopOut(p: Pool, from: Asset, amountIn: number): number {
  const [rin, rout] = p.a === from ? [p.ra, p.rb] : [p.rb, p.ra];
  const x = amountIn * (1 - POOL_FEE);
  return (rout * x) / (rin + x);
}

export interface Route { path: Asset[]; out: number }

/** mejor ruta de `from` a `to` (hasta MAX_HOPS saltos), como el path finding de Horizon */
export function bestRoute(w: WorldState, from: Asset, to: Asset, amountIn: number): Route | null {
  if (from === to || amountIn <= 0) return null;
  let best: Route | null = null;
  const walk = (at: Asset, amount: number, path: Asset[]) => {
    if (at === to) {
      if (!best || amount > best.out) best = { path: [...path], out: amount };
      return;
    }
    if (path.length > MAX_HOPS) return;
    for (const p of w.pools) {
      if (p.a !== at && p.b !== at) continue;
      const next = p.a === at ? p.b : p.a;
      if (path.includes(next)) continue;
      path.push(next);
      walk(next, hopOut(p, at, amount), path);
      path.pop();
    }
  };
  walk(from, amountIn, [from]);
  return best;
}

/** cuánto `from` hace falta para recibir exactamente `amountOut` de `to` (path payment strict-receive) */
export function quoteReceive(w: WorldState, from: Asset, to: Asset, amountOut: number): Route & { in: number } | null {
  if (from === to) return { path: [from], out: amountOut, in: amountOut };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const r = bestRoute(w, from, to, hi);
    if (r && r.out >= amountOut) break;
    hi *= 2;
    if (hi > 1e12) return null;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = bestRoute(w, from, to, mid);
    if (r && r.out >= amountOut) hi = mid; else lo = mid;
  }
  const r = bestRoute(w, from, to, hi);
  return r ? { ...r, in: hi } : null;
}

/** precio spot de `x` expresado en `y` por la mejor ruta, sin impacto */
export function spotPrice(w: WorldState, x: Asset, y: Asset): number {
  if (x === y) return 1;
  const r = bestRoute(w, x, y, 1e-6);
  return r ? r.out / 1e-6 : 0;
}

export type Result = { ok: true; msg: string } | { ok: false; msg: string };

/** ejecuta un swap (path payment strict-send) con protección de deslizamiento `minOut` */
export function swap(w: WorldState, from: Asset, to: Asset, amountIn: number, minOut = 0): Result {
  if (!(amountIn > 0)) return { ok: false, msg: 'Indica una cantidad' };
  if (w.wallet[from] < amountIn - 1e-9) return { ok: false, msg: `No tienes ${amountIn} ${from}` };
  const route = bestRoute(w, from, to, amountIn);
  if (!route) return { ok: false, msg: `No hay ruta de ${from} a ${to}` };
  if (route.out < minOut) return { ok: false, msg: 'El precio se movió más que tu tolerancia' };
  let amount = amountIn;
  for (let i = 0; i < route.path.length - 1; i++) {
    const x = route.path[i], y = route.path[i + 1];
    const p = poolOf(w, x, y)!;
    const out = hopOut(p, x, amount);
    if (p.a === x) { p.ra += amount; p.rb -= out; } else { p.rb += amount; p.ra -= out; }
    amount = out;
  }
  w.wallet[from] = round(w.wallet[from] - amountIn);
  w.wallet[to] = round(w.wallet[to] + amount);
  w.stats.swaps++;
  const msg = `Swap ${fmt(amountIn)} ${from} → ${fmt(amount)} ${to} vía ${route.path.join(' › ')}`;
  note(w, msg);
  return { ok: true, msg };
}

export function fmt(n: number): string {
  if (n >= 1000) return Math.round(n).toLocaleString('es');
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(n >= 1 ? 2 : 4).replace(/\.?0+$/, '') || '0';
}

// ---------- Tienda y mercado (Armory) ----------

export function buyFromShop(w: WorldState, id: string): Result {
  const def = itemDef(id);
  if (w.wallet.STAR < def.price) return { ok: false, msg: `Necesitas ${def.price} STAR (cámbialos en el DEX)` };
  w.wallet.STAR = round(w.wallet.STAR - def.price);
  // igual que Armory.buy: la mitad se quema y la otra va al tesoro
  w.stats.burned += def.price / 2;
  w.stats.treasury += def.price / 2;
  w.inventory[id] = (w.inventory[id] ?? 0) + 1;
  note(w, `Compraste ${def.name} por ${def.price} STAR (${def.price / 2} quemados)`);
  return { ok: true, msg: `${def.name} es tuyo. Se quemaron ${def.price / 2} STAR.` };
}

export function buyListing(w: WorldState, listingId: number): Result {
  const l = w.listings.find(x => x.id === listingId);
  if (!l || l.mine) return { ok: false, msg: 'Esa oferta ya no está' };
  if (w.wallet.STAR < l.price) return { ok: false, msg: `Necesitas ${l.price} STAR` };
  w.wallet.STAR = round(w.wallet.STAR - l.price);
  w.stats.treasury += l.price * ROYALTY;
  w.inventory[l.item] = (w.inventory[l.item] ?? 0) + 1;
  w.listings = w.listings.filter(x => x !== l);
  note(w, `Compraste ${itemDef(l.item).name} a ${l.seller} por ${l.price} STAR`);
  return { ok: true, msg: `Compraste ${itemDef(l.item).name} a ${l.seller}.` };
}

/** pone un ítem propio en custodia del mercado; un comprador lo puede tomar en ledgers posteriores */
export function listItem(w: WorldState, id: string, price: number): Result {
  if (!((w.inventory[id] ?? 0) > 0)) return { ok: false, msg: 'No tienes ese ítem' };
  if (!(price > 0)) return { ok: false, msg: 'Pon un precio' };
  takeItem(w, id);
  w.listings.push({ id: w.nextId++, item: id, price: round(price, 2), seller: 'Tú', mine: true, listedAt: w.ledger });
  note(w, `Publicaste ${itemDef(id).name} a ${price} STAR`);
  return { ok: true, msg: 'Publicado. El ítem queda en custodia hasta que se venda o lo retires.' };
}

export function cancelListing(w: WorldState, listingId: number): Result {
  const l = w.listings.find(x => x.id === listingId && x.mine);
  if (!l) return { ok: false, msg: 'Esa oferta no es tuya' };
  w.listings = w.listings.filter(x => x !== l);
  w.inventory[l.item] = (w.inventory[l.item] ?? 0) + 1;
  return { ok: true, msg: 'Oferta retirada; el ítem vuelve a tu inventario.' };
}

function takeItem(w: WorldState, id: string) {
  w.inventory[id]--;
  if (w.inventory[id] <= 0) {
    delete w.inventory[id];
    if (w.skin === id) w.skin = null;
    w.loadout = w.loadout.filter(x => x !== id || (w.inventory[id] ?? 0) > 0);
  }
}

export function equipSkin(w: WorldState, id: string | null): Result {
  if (id && !((w.inventory[id] ?? 0) > 0)) return { ok: false, msg: 'No tienes ese casco' };
  w.skin = id;
  return { ok: true, msg: id ? `Equipado: ${itemDef(id).name}` : 'Casco por defecto' };
}

export function removeFromLoadout(w: WorldState, index: number): Result {
  if (!w.loadout[index]) return { ok: false, msg: 'No hay nada en ese hueco' };
  w.loadout.splice(index, 1);
  return { ok: true, msg: 'Quitado de la carga' };
}

export function addToLoadout(w: WorldState, id: string): Result {
  const def = itemDef(id);
  if (def.category === 'skin') return { ok: false, msg: 'Los cascos se equipan, no se cargan' };
  const owned = w.inventory[id] ?? 0;
  if (w.loadout.filter(x => x === id).length >= owned) return { ok: false, msg: 'No tienes más unidades de ese ítem' };
  if (w.loadout.length >= MAX_LOADOUT) return { ok: false, msg: `Máximo ${MAX_LOADOUT} ítems por partida` };
  w.loadout.push(id);
  return { ok: true, msg: `${def.name} irá contigo a la próxima partida` };
}

function npcListing(w: WorldState) {
  const { r, done } = rngOf(w);
  const def = ITEMS[r.int(0, ITEMS.length - 1)];
  w.listings.push({
    id: w.nextId++, item: def.id, price: round(def.price * r.range(0.7, 1.15), 1),
    seller: NPCS[r.int(0, NPCS.length - 1)], mine: false, listedAt: w.ledger,
  });
  done();
}

// ---------- Encargos comerciales ----------

function newOrder(w: WorldState) {
  const { r, done } = rngOf(w);
  const want = (['LMN', 'MTL', 'NRG'] as Asset[])[r.int(0, 2)];
  const amount = r.int(4, 20) * 25;
  const pay: Asset = r.next() < 0.6 ? 'USDC' : 'STAR';
  // paga un 15–35 % por encima del valor de mercado: el margen es el negocio del comerciante
  const value = spotPrice(w, want, pay) * amount;
  w.orders.push({
    id: w.nextId++, station: STATIONS[r.int(0, STATIONS.length - 1)], want, amount, pay,
    reward: round(value * r.range(1.15, 1.35), 2), expires: w.ledger + r.int(60, 140),
  });
  done();
}

export function fulfillOrder(w: WorldState, orderId: number): Result {
  const o = w.orders.find(x => x.id === orderId);
  if (!o) return { ok: false, msg: 'Ese encargo ya no está' };
  if (w.wallet[o.want] < o.amount) return { ok: false, msg: `Te faltan ${fmt(o.amount - w.wallet[o.want])} ${o.want}` };
  w.wallet[o.want] = round(w.wallet[o.want] - o.amount);
  w.wallet[o.pay] = round(w.wallet[o.pay] + o.reward);
  w.orders = w.orders.filter(x => x !== o);
  w.stats.orders++;
  note(w, `Entregaste ${o.amount} ${o.want} a ${o.station} por ${fmt(o.reward)} ${o.pay}`);
  return { ok: true, msg: `${o.station} te pagó ${fmt(o.reward)} ${o.pay}.` };
}

// ---------- Paso del mundo (un ledger ≈ 5 s) ----------

export function tickLedger(w: WorldState) {
  w.ledger++;
  const { r, done } = rngOf(w);
  const roll = r.next(), roll2 = r.next();
  done();
  // compradores del mercado: una oferta tuya razonable se vende con el tiempo
  for (const l of w.listings.filter(x => x.mine)) {
    const fair = itemDef(l.item).price;
    const chance = l.price <= fair ? 0.12 : l.price <= fair * 1.5 ? 0.04 : 0.005;
    if (roll < chance && w.ledger > l.listedAt) {
      const net = l.price * (1 - ROYALTY);
      w.wallet.STAR = round(w.wallet.STAR + net);
      w.stats.treasury += l.price * ROYALTY;
      w.listings = w.listings.filter(x => x !== l);
      note(w, `${NPCS[w.ledger % NPCS.length]} compró tu ${itemDef(l.item).name}: +${fmt(net)} STAR`);
      break;
    }
  }
  if (w.listings.filter(l => !l.mine).length < 6 && roll2 < 0.15) npcListing(w);
  w.orders = w.orders.filter(o => o.expires > w.ledger);
  if (w.orders.length < 3 && roll2 > 0.8) newOrder(w);
}

// ---------- Descubrimiento y Frontera ----------

export function discover(w: WorldState, nodeId: string, reward: { asset: Asset; amount: number }): Result {
  if (w.discovered.includes(nodeId)) return { ok: false, msg: 'Ya descubriste este nodo' };
  w.discovered.push(nodeId);
  w.wallet[reward.asset] = round(w.wallet[reward.asset] + reward.amount);
  note(w, `Nodo descubierto: +${reward.amount} ${reward.asset}`);
  return { ok: true, msg: `¡Nodo descubierto! +${reward.amount} ${reward.asset}` };
}

/** recompensa por visitar por primera vez un proyecto del atlas */
export const VISIT_XLM = 0.2;

export function visitProject(w: WorldState, slug: string): boolean {
  w.visited ??= [];
  if (w.visited.includes(slug)) return false;
  w.visited.push(slug);
  w.wallet.XLM = round(w.wallet.XLM + VISIT_XLM);
  return true;
}

export interface MatchLoadout { interceptors: number; mechas: number; bonus: { lumens: number; metal: number } }

/** como Vault.open: quema los ítems cargados y devuelve lo que aportan a la partida */
export function consumeLoadout(w: WorldState): MatchLoadout {
  const out: MatchLoadout = { interceptors: 0, mechas: 0, bonus: { lumens: 0, metal: 0 } };
  for (const id of w.loadout) {
    if (!((w.inventory[id] ?? 0) > 0)) continue;
    if (id === 'escuadra-interceptores') out.interceptors += 3;
    if (id === 'escuadra-mechas') out.mechas += 2;
    if (id === 'plano-reservas') { out.bonus.lumens += 300; out.bonus.metal += 200; }
    takeItem(w, id);
  }
  w.loadout = [];
  return out;
}

export interface MatchOutcome { sector: string; won: boolean; res: { lumens: number; metal: number; energy: number } }

/** como Vault.settle + Conquest.claim: acuña el sobrante (con tope) y paga STAR si ganaste */
export function settleMatch(w: WorldState, o: MatchOutcome): string {
  const s = w.sectors.find(x => x.id === o.sector);
  const lmn = Math.min(LEFTOVER_CAP, Math.floor(o.res.lumens / 10));
  const mtl = Math.min(LEFTOVER_CAP, Math.floor(o.res.metal / 10));
  const nrg = Math.min(LEFTOVER_CAP, Math.floor(o.res.energy / 10));
  w.wallet.LMN += lmn; w.wallet.MTL += mtl; w.wallet.NRG += nrg;
  let msg = `Liquidación: +${lmn} LMN, +${mtl} MTL, +${nrg} NRG.`;
  if (o.won) {
    const mult = s?.difficulty === 'dificil' ? 3 : s?.difficulty === 'normal' ? 2 : 1;
    const star = FRONTIER_STAR * mult;
    w.wallet.STAR = round(w.wallet.STAR + star);
    w.stats.wins++;
    if (s) s.owner = 'player';
    msg = (s ? `¡${s.name} conquistado! ` : '¡Victoria! ') + `+${star} STAR. ` + msg;
  } else {
    w.stats.losses++;
    msg = `Retirada de ${s?.name ?? 'la Frontera'}. ` + msg;
  }
  note(w, msg);
  return msg;
}

// ---------- Persistencia ----------

const KEY = 'stellar-conquer.world.v1';

export function loadWorld(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) return w;
    }
  } catch { /* almacenamiento bloqueado: se empieza de cero */ }
  return createWorld((Math.random() * 2 ** 31) >>> 0);
}

/** partida guardada, sin crear una nueva si no existe (para el menú de entrada) */
export function savedWorld(): WorldState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const w = raw ? (JSON.parse(raw) as WorldState) : null;
    return w?.version === 1 ? w : null;
  } catch { return null; }
}

export function resetWorld() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

export function saveWorld(w: WorldState) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* sin almacenamiento */ }
}
