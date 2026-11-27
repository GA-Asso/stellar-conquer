import { describe, expect, it } from 'vitest';
import { aiThink, armyValue, createAi, isProvoked } from '../src/sim/ai';
import { modules, popUsed, step, createSim, units } from '../src/sim/sim';
import type { SideCommand } from '../src/sim/sim';

describe('IA', () => {
  it('dos IAs hacen crecer sus estaciones y la partida termina', () => {
    const s = createSim(11);
    const ais = [createAi(0, 'normal', { passive: false }), createAi(1, 'dificil', { passive: false })];
    let maxMods = 0, maxPop = 0;
    for (let t = 0; t < 20 * 60 * 25 && s.winner === null; t++) {
      const cmds: SideCommand[] = [];
      if (t % 10 === 0) for (const ai of ais) for (const cmd of aiThink(s, ai)) cmds.push({ side: ai.side, cmd });
      step(s, cmds);
      maxMods = Math.max(maxMods, modules(s, 0).length);
      maxPop = Math.max(maxPop, popUsed(s, 0));
    }
    console.log('ganador', s.winner, s.winReason, 'ledger', s.ledger, 'módulos', maxMods, 'pob', maxPop, 'eras', s.players.map(p => p.era), 'unidades', units(s).length);
    expect(maxMods).toBeGreaterThan(6);
    expect(maxPop).toBeGreaterThan(15);
    expect(s.winner).not.toBeNull();
  }, 60_000);

  it('la IA pacífica no ataca hasta que la atacan, y entonces responde', () => {
    const s = createSim(12);
    const ai = createAi(1, 'normal');
    const run = (seconds: number) => {
      for (let t = 0; t < seconds * 20; t++) {
        const cmds: SideCommand[] = [];
        if (t % 10 === 0) for (const cmd of aiThink(s, ai)) cmds.push({ side: 1, cmd });
        step(s, cmds);
      }
    };
    run(12 * 60);
    expect(s.players[0].lastHit).toBe(-1);
    expect(isProvoked(s, ai)).toBe(false);
    // el jugador le pega a un dron de la IA
    const victim = units(s, 1).find(u => u.type === 'drone')!;
    victim.hp -= 1;
    s.players[1].lastHit = s.tick;
    run(4 * 60);
    expect(isProvoked(s, ai)).toBe(true);
    expect(ai.wave).toBeGreaterThan(0);
  }, 60_000);

  it('se nivela: contra un jugador sin economía no arma un ejército enorme', () => {
    const s = createSim(13);
    const ai = createAi(1, 'normal');
    for (let t = 0; t < 15 * 60 * 20; t++) {
      const cmds: SideCommand[] = [];
      if (t % 10 === 0) for (const cmd of aiThink(s, ai)) cmds.push({ side: 1, cmd });
      step(s, cmds);
    }
    console.log('ejército IA', Math.round(armyValue(units(s, 1))), 'drones', units(s, 1).filter(u => u.type === 'drone').length, 'mult', s.players[1].gatherMult.toFixed(2));
    expect(armyValue(units(s, 1))).toBeLessThan(1200);
    expect(units(s, 1).filter(u => u.type === 'drone').length).toBeLessThanOrEqual(10);
  }, 60_000);
});
