import { describe, expect, it } from 'vitest';
import {
  bestRoute, buyFromShop, buyListing, consumeLoadout, createWorld, discover, fulfillOrder, hopOut, listItem,
  removeFromLoadout,
  poolOf, quoteReceive, settleMatch, swap, tickLedger, addToLoadout, MAX_LOADOUT, POOL_FEE,
} from '../src/world/economy';

describe('DEX', () => {
  it('un salto respeta x·y=k con la comisión de 0,30 %', () => {
    const w = createWorld(1);
    const p = poolOf(w, 'XLM', 'USDC')!;
    const k = p.ra * p.rb;
    const out = hopOut(p, 'XLM', 1000);
    expect((p.ra + 1000 * (1 - POOL_FEE)) * (p.rb - out)).toBeCloseTo(k, 0);
  });

  it('encuentra rutas de varios saltos (path payment)', () => {
    const w = createWorld(1);
    // MTL solo tiene pool contra XLM: para llegar a USDC hay que pasar por XLM
    const r = bestRoute(w, 'MTL', 'USDC', 100)!;
    expect(r.path[0]).toBe('MTL');
    expect(r.path.at(-1)).toBe('USDC');
    expect(r.path.length).toBeGreaterThan(2);
  });

  it('el swap mueve saldos y reservas y rechaza deslizamiento excesivo', () => {
    const w = createWorld(1);
    expect(swap(w, 'XLM', 'STAR', 10, 1e9).ok).toBe(false);
    const before = poolOf(w, 'STAR', 'XLM')!.rb;
    const r = swap(w, 'XLM', 'STAR', 10);
    expect(r.ok).toBe(true);
    expect(w.wallet.XLM).toBe(90);
    expect(w.wallet.STAR).toBeGreaterThan(9.9);
    expect(poolOf(w, 'STAR', 'XLM')!.rb).toBe(before + 10);
    expect(swap(w, 'XLM', 'STAR', 1e6).ok).toBe(false);
  });

  it('strict-receive calcula la entrada exacta', () => {
    const w = createWorld(1);
    const q = quoteReceive(w, 'USDC', 'MTL', 150)!;
    expect(bestRoute(w, 'USDC', 'MTL', q.in)!.out).toBeGreaterThanOrEqual(150);
    expect(bestRoute(w, 'USDC', 'MTL', q.in * 0.99)!.out).toBeLessThan(150);
  });
});

describe('Armory en el universo', () => {
  it('la tienda quema la mitad del pago', () => {
    const w = createWorld(1);
    expect(buyFromShop(w, 'casco-cian').ok).toBe(false);
    w.wallet.STAR = 100;
    expect(buyFromShop(w, 'casco-cian').ok).toBe(true);
    expect(w.wallet.STAR).toBe(85);
    expect(w.stats.burned).toBe(7.5);
    expect(w.inventory['casco-cian']).toBe(1);
  });

  it('el mercado custodia, cobra regalía y vende con el tiempo', () => {
    const w = createWorld(1);
    w.wallet.STAR = 100;
    const npc = w.listings.find(l => !l.mine)!;
    expect(buyListing(w, npc.id).ok).toBe(true);
    expect(w.inventory[npc.item]).toBeGreaterThanOrEqual(1);
    expect(listItem(w, npc.item, 1).ok).toBe(true);
    const star = w.wallet.STAR;
    for (let i = 0; i < 400 && w.listings.some(l => l.mine); i++) tickLedger(w);
    expect(w.listings.some(l => l.mine)).toBe(false);
    expect(w.wallet.STAR).toBeCloseTo(star + 0.95);
  });

  it('la carga de partida tiene tope y se quema al despegar', () => {
    const w = createWorld(1);
    w.inventory = { 'escuadra-interceptores': 2, 'plano-reservas': 3 };
    expect(addToLoadout(w, 'escuadra-interceptores').ok).toBe(true);
    expect(addToLoadout(w, 'escuadra-interceptores').ok).toBe(true);
    expect(addToLoadout(w, 'escuadra-interceptores').ok).toBe(false);
    expect(addToLoadout(w, 'plano-reservas').ok).toBe(true);
    expect(w.loadout).toHaveLength(MAX_LOADOUT);
    expect(addToLoadout(w, 'plano-reservas').ok).toBe(false);
    expect(removeFromLoadout(w, 2).ok).toBe(true);
    expect(addToLoadout(w, 'plano-reservas').ok).toBe(true);
    const l = consumeLoadout(w);
    expect(l).toEqual({ interceptors: 6, mechas: 0, bonus: { lumens: 300, metal: 200 } });
    expect(w.inventory).toEqual({ 'plano-reservas': 2 });
  });
});

describe('comercio, descubrimiento y Frontera', () => {
  it('un encargo paga por encima del mercado', () => {
    const w = createWorld(3);
    const o = w.orders[0];
    w.wallet[o.want] = o.amount;
    const before = w.wallet[o.pay];
    expect(fulfillOrder(w, o.id).ok).toBe(true);
    expect(w.wallet[o.pay]).toBeCloseTo(before + o.reward);
    expect(w.wallet[o.want]).toBe(0);
  });

  it('cada nodo se descubre una sola vez', () => {
    const w = createWorld(1);
    expect(discover(w, 'freighter', { asset: 'XLM', amount: 5 }).ok).toBe(true);
    expect(discover(w, 'freighter', { asset: 'XLM', amount: 5 }).ok).toBe(false);
    expect(w.wallet.XLM).toBe(105);
  });

  it('ganar un sector paga STAR y acuña el sobrante con tope', () => {
    const w = createWorld(1);
    settleMatch(w, { sector: 'vorágine', won: true, res: { lumens: 99_999, metal: 1000, energy: 0 } });
    expect(w.sectors.find(s => s.id === 'vorágine')!.owner).toBe('player');
    expect(w.wallet.STAR).toBe(20);
    expect(w.wallet.LMN).toBe(200 + 500);
    expect(w.wallet.MTL).toBe(200 + 100);
  });

  it('es reproducible con la misma semilla', () => {
    const a = createWorld(9), b = createWorld(9);
    for (let i = 0; i < 50; i++) { tickLedger(a); tickLedger(b); }
    expect(a).toEqual(b);
  });
});
