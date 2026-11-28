// Tutorial guiado: una lista de objetivos que se marcan solos leyendo el estado de la partida.
import { hasBuilt, modules, planets, units } from '../sim/sim';
import type { Side, SimState } from '../sim/types';

export interface Step {
  title: string;
  how: string;
  // tecla del botón que conviene resaltar mientras este paso está activo
  highlight?: string | ((s: SimState, side: Side) => string);
  done: (s: SimState, side: Side, selected: Set<number>) => boolean;
}

const gathering = (s: SimState, side: Side, res: 'lumen' | 'metal') => units(s, side).some(u => {
  if (u.order.kind !== 'gather') return false;
  const a = s.entities.get(u.order.target);
  return a?.kind === 'asteroid' && a.res === res;
});

export const STEPS: Step[] = [
  {
    title: 'Selecciona tus drones',
    how: 'Mantén el clic izquierdo y arrastra un recuadro sobre los 4 drones que flotan junto a tu Núcleo (el edificio central con el logo de Stellar).',
    done: (s, side, sel) => [...sel].some(id => { const e = s.entities.get(id); return e?.kind === 'unit' && e.side === side && e.type === 'drone'; }),
  },
  {
    title: 'Mina Lumens',
    how: 'Con los drones seleccionados, haz clic DERECHO sobre un asteroide con cristales dorados. Los drones minan y traen los Lumens al Núcleo solos.',
    done: (s, side) => gathering(s, side, 'lumen'),
  },
  {
    title: 'Mina metal',
    how: 'Selecciona uno o dos drones (clic sobre uno) y haz clic derecho en un asteroide cobrizo (marrón). El metal sirve para construir módulos.',
    done: (s, side) => gathering(s, side, 'metal'),
  },
  {
    title: 'Entrena más drones',
    how: 'Haz clic en tu Núcleo y pulsa el botón «Dron Ancla» abajo a la derecha (o la tecla Q). Más drones = más recursos.',
    highlight: 'Q',
    done: (s, side) => units(s, side).filter(u => u.type === 'drone').length >= 5,
  },
  {
    title: 'Acopla un Hábitat',
    how: 'Selecciona un dron, pulsa «Hábitat» (A) y haz clic en uno de los hexágonos verdes pegados a tu estación. Cada Hábitat da +8 de población.',
    highlight: 'A',
    done: (s, side) => modules(s, side).some(m => m.type === 'habitat'),
  },
  {
    title: 'Instala un Panel Solar',
    how: 'Con un dron seleccionado pulsa «Panel Solar» (S) y acóplalo. La energía (azul) la piden las naves y unidades avanzadas.',
    highlight: 'S',
    done: (s, side) => modules(s, side).some(m => m.type === 'solar'),
  },
  {
    title: 'Construye un Hangar o una Forja',
    how: 'El Hangar (F) fabrica naves de combate. La Forja de Robots (G) fabrica robots, los únicos que conquistan planetas.',
    highlight: 'G',
    done: (s, side) => modules(s, side).some(m => m.type === 'hangar' || m.type === 'factory'),
  },
  {
    title: 'Investiga y avanza de era',
    how: 'Acopla un Laboratorio de Eras (H). Después selecciona el Núcleo y pulsa «Avanzar a Consenso» (U): desbloquea torretas y naves mejores.',
    highlight: (s, side) => hasBuilt(s, side, 'lab') ? 'U' : 'H',
    done: (s, side) => s.players[side].era >= 2,
  },
  {
    title: 'Conquista un planeta',
    how: 'Entrena Mechas en la Forja, selecciónalos y haz clic derecho sobre un planeta. Si se quedan en órbita sin enemigos, el planeta es tuyo y paga Lumens cada ledger.',
    highlight: 'E',
    done: (s, side) => planets(s).some(p => p.owner === side),
  },
  {
    title: 'Destruye el Núcleo rival',
    how: 'La estación enemiga (rosa) está en la esquina opuesta del minimapa. Junta naves y robots, selecciónalos y Ctrl+clic derecho para avanzar atacando todo lo que encuentren.',
    done: (s, side) => s.winner === side,
  },
];

export class Tutorial {
  private el: HTMLDivElement;
  private doneSet = new Set<number>();
  private collapsed = false;
  private lastHtml = '';
  current = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tutorial';
    host.appendChild(this.el);
    this.el.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.tut-toggle')) { this.collapsed = !this.collapsed; this.lastHtml = ''; }
    });
  }

  // devuelve la tecla a resaltar en la botonera
  update(s: SimState, side: Side, selected: Set<number>): string | undefined {
    STEPS.forEach((st, i) => { if (!this.doneSet.has(i) && st.done(s, side, selected)) this.doneSet.add(i); });
    this.current = STEPS.findIndex((_, i) => !this.doneSet.has(i));
    const step = this.current >= 0 ? STEPS[this.current] : null;
    const n = this.doneSet.size;
    let html = `<div class="tut-head"><b>Objetivos</b><span>${n}/${STEPS.length}</span><button class="tut-toggle">${this.collapsed ? 'Mostrar' : 'Ocultar'}</button></div>`;
    if (!this.collapsed) {
      html += '<ol>' + STEPS.map((st, i) => {
        const cls = this.doneSet.has(i) ? 'done' : i === this.current ? 'now' : '';
        return `<li class="${cls}"><span>${st.title}</span>${i === this.current ? `<p>${st.how}</p>` : ''}</li>`;
      }).join('') + '</ol>';
    } else if (step) {
      html += `<div class="tut-mini">▸ ${step.title}</div>`;
    }
    if (html !== this.lastHtml) { this.el.innerHTML = html; this.lastHtml = html; }
    return typeof step?.highlight === 'function' ? step.highlight(s, side) : step?.highlight;
  }

  destroy() { this.el.remove(); }
}
