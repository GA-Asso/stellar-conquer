import { describe, expect, it } from 'vitest';
import { aiThink, createAi } from '../src/sim/ai';
import { modules, popUsed, step, createSim, units } from '../src/sim/sim';
import type { SideCommand } from '../src/sim/sim';

describe('IA', () => {
  it('dos IAs hacen crecer sus estaciones y la partida termina', () => {
    const s = createSim(11);
    const ais = [createAi(0, 'normal'), createAi(1, 'dificil')];
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
});
