// Catálogo de unidades, módulos y eras. Los nombres vienen del ecosistema Stellar.
import type { AsteroidKind, Era, ModuleType, Res, ResKey, UnitType } from './types';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
// Stellar cierra un ledger cada ~5 segundos
export const LEDGER_SECONDS = 5;
export const LEDGER_TICKS = LEDGER_SECONDS * TICK_HZ;
// mapa amplio: espacio para que cada base crezca sin chocar con los campos de recursos ni con el rival
export const MAP_HALF = 400;
export const POP_MAX = 120;

export const cost = (lumens = 0, metal = 0, energy = 0): Res => ({ lumens, metal, energy });

export type UnitClass = 'worker' | 'ship' | 'robot';

export interface UnitDef {
  name: string;
  desc: string;
  cls: UnitClass;
  cost: Res;
  pop: number;
  hp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  sight: number;
  trainTime: number;
  era: Era;
  radius: number;
  // multiplicador de daño contra módulos de estación
  vsModule: number;
  // multiplicador de daño contra naves
  vsShip: number;
  weapon: 'laser' | 'plasma' | 'melee';
  hotkey: string;
}

export const UNITS: Record<UnitType, UnitDef> = {
  drone: {
    name: 'Dron Ancla', desc: 'Recolecta Lumens, metal y cristales de energía, y ensambla módulos.',
    cls: 'worker', cost: cost(50), pop: 1, hp: 45, speed: 16, damage: 2, range: 5, cooldown: 1.2, sight: 40,
    trainTime: 10, era: 1, radius: 1.6, vsModule: 1, vsShip: 1, weapon: 'laser', hotkey: 'Q',
  },
  interceptor: {
    name: 'Interceptor Lumen', desc: 'Caza rápido y barato. Bueno contra drones y robots.',
    cls: 'ship', cost: cost(60, 30), pop: 1, hp: 90, speed: 24, damage: 7, range: 22, cooldown: 0.9, sight: 55,
    trainTime: 12, era: 1, radius: 2.2, vsModule: 0.5, vsShip: 1, weapon: 'laser', hotkey: 'W',
  },
  mecha: {
    name: 'Mecha Centinela', desc: 'Robot de abordaje: derriba módulos y conquista planetas.',
    cls: 'robot', cost: cost(40, 70), pop: 1, hp: 170, speed: 11, damage: 14, range: 5, cooldown: 1.1, sight: 40,
    trainTime: 15, era: 1, radius: 2.4, vsModule: 2, vsShip: 0.7, weapon: 'melee', hotkey: 'E',
  },
  frigate: {
    name: 'Fragata Horizon', desc: 'Artillería de plasma de largo alcance. Castiga naves.',
    cls: 'ship', cost: cost(120, 80, 20), pop: 2, hp: 280, speed: 13, damage: 20, range: 36, cooldown: 2, sight: 60,
    trainTime: 22, era: 2, radius: 3.6, vsModule: 1, vsShip: 1.6, weapon: 'plasma', hotkey: 'R',
  },
  titan: {
    name: 'Titán Soroban', desc: 'Robot pesado ejecutor de contratos. Demuele estaciones.',
    cls: 'robot', cost: cost(200, 220, 60), pop: 3, hp: 760, speed: 7.5, damage: 42, range: 7, cooldown: 1.8, sight: 45,
    trainTime: 32, era: 3, radius: 4.2, vsModule: 2.2, vsShip: 0.8, weapon: 'melee', hotkey: 'T',
  },
  dreadnought: {
    name: 'Acorazado Consenso', desc: 'Nave insignia. Su batería de plasma lo arrasa todo.',
    cls: 'ship', cost: cost(450, 380, 160), pop: 5, hp: 1800, speed: 6, damage: 55, range: 42, cooldown: 2.4, sight: 70,
    trainTime: 45, era: 4, radius: 7, vsModule: 1.4, vsShip: 1.3, weapon: 'plasma', hotkey: 'Y',
  },
};

export interface ModuleDef {
  name: string;
  desc: string;
  /** beneficios para el jugador, en frases cortas: se muestran como chips en la tarjeta */
  benefits: string[];
  cost: Res;
  hp: number;
  buildTime: number;
  era: Era;
  pop: number;
  // energía generada por segundo
  energy: number;
  trains: UnitType[];
  dropsite: boolean;
  // si puede colocarse lejos de la estación (no necesita puerto libre)
  freePlacement: boolean;
  attack?: { damage: number; range: number; cooldown: number; weapon: 'laser' | 'plasma' };
  sight: number;
  radius: number;
  hotkey: string;
  // recursos que llegan al cerrar cada ledger
  perLedger?: Res;
  // aliados en este radio reciben menos daño (fracción que se resta)
  shield?: { radius: number; reduction: number };
  // fabrica un dron gratis cada tantos segundos
  replicate?: number;
  // bonos globales mientras esté en pie
  gatherBonus?: number;
  trainSpeed?: number;
}

export const MODULES: Record<ModuleType, ModuleDef> = {
  core: {
    name: 'Núcleo Estelar', desc: 'Corazón de la estación. Si cae, pierdes.', benefits: ['Fabrica drones', 'Recibe recursos', '+6 población'],
    cost: cost(), hp: 3200, buildTime: 1, era: 1, pop: 6, energy: 0.3, trains: ['drone'],
    dropsite: true, freePlacement: false, attack: { damage: 6, range: 44, cooldown: 1.2, weapon: 'laser' },
    // ocupa su celda y las 6 vecinas (ver footprint en sim.ts): es la ciudadela, no un módulo más
    sight: 90, radius: 22, hotkey: '',
  },
  habitat: {
    name: 'Hábitat', desc: 'Viviendas para tu tripulación.', benefits: ['+8 población'], cost: cost(0, 50), hp: 520, buildTime: 14, era: 1, pop: 8, energy: 0,
    trains: [], dropsite: false, freePlacement: false, sight: 30, radius: 7, hotkey: 'A',
  },
  solar: {
    name: 'Panel Solar', desc: 'Genera energía de forma continua.', benefits: ['+0,9 energía por segundo'], cost: cost(0, 45), hp: 320, buildTime: 12, era: 1, pop: 0,
    energy: 0.9, trains: [], dropsite: false, freePlacement: false, sight: 25, radius: 7, hotkey: 'S',
  },
  anchor: {
    name: 'Puesto de Descarga', desc: 'Puesto remoto: se coloca lejos, junto a los recursos.', benefits: ['Drones viajan menos', 'Se coloca donde quieras', 'Nuevo punto de acople'], cost: cost(0, 100), hp: 700,
    buildTime: 20, era: 1, pop: 0, energy: 0, trains: [], dropsite: true, freePlacement: true, sight: 45, radius: 7, hotkey: 'D',
  },
  hangar: {
    name: 'Hangar de Naves', desc: 'Construye naves de combate.', benefits: ['Interceptores', 'Fragatas', 'Acorazado'], cost: cost(40, 120), hp: 900, buildTime: 24, era: 1, pop: 0, energy: 0,
    trains: ['interceptor', 'frigate', 'dreadnought'], dropsite: false, freePlacement: false, sight: 35, radius: 8, hotkey: 'F',
  },
  factory: {
    name: 'Forja de Robots', desc: 'Ensambla robots de abordaje.', benefits: ['Mechas y Titanes', 'Conquistan planetas', 'Doble daño a edificios'], cost: cost(40, 130), hp: 900, buildTime: 24, era: 1, pop: 0,
    energy: 0, trains: ['mecha', 'titan'], dropsite: false, freePlacement: false, sight: 35, radius: 8, hotkey: 'G',
  },
  lab: {
    name: 'Laboratorio de Eras', desc: 'Investiga eras nuevas desde el Núcleo.', benefits: ['Desbloquea eras', '+20 % minería'], cost: cost(80, 100), hp: 600,
    buildTime: 26, era: 1, pop: 0, energy: 0.2, trains: [], dropsite: false, freePlacement: false, sight: 30, radius: 7, hotkey: 'H',
  },
  turret: {
    name: 'Torreta Láser', desc: 'Defensa automática.', benefits: ['Dispara sola', 'Alcance 40'], cost: cost(30, 70, 20), hp: 650, buildTime: 16, era: 2, pop: 0,
    energy: 0, trains: [], dropsite: false, freePlacement: false,
    attack: { damage: 11, range: 40, cooldown: 1, weapon: 'laser' }, sight: 50, radius: 6, hotkey: 'J',
  },
  beacon: {
    name: 'Faro de la Victoria', desc: 'Maravilla: si resiste 30 ledgers, ganas la partida.', benefits: ['Victoria si resiste 30 ledgers'], cost: cost(1200, 1000, 400),
    hp: 4200, buildTime: 90, era: 4, pop: 0, energy: 0, trains: [], dropsite: false, freePlacement: false,
    sight: 60, radius: 9, hotkey: 'K',
  },
  // tecnología de civilizaciones avanzadas: ideas reales de la búsqueda de tecnofirmas, con nombre de juego
  seti: {
    name: 'Antena de Señales', desc: 'Escucha el cosmos y capta señales con recursos.', benefits: ['+10 Lumens por ledger', '+6 energía por ledger'], cost: cost(60, 80),
    hp: 450, buildTime: 18, era: 1, pop: 0, energy: 0, trains: [], dropsite: false, freePlacement: false, sight: 90, radius: 7,
    hotkey: 'L', perLedger: cost(10, 0, 6),
  },
  replicator: {
    name: 'Fábrica de Drones', desc: 'Máquina Von Neumann que se copia a sí misma.', benefits: ['Dron gratis cada 30 s'], cost: cost(150, 150, 40),
    hp: 700, buildTime: 30, era: 2, pop: 0, energy: 0, trains: [], dropsite: false, freePlacement: false, sight: 35, radius: 7,
    hotkey: 'B', replicate: 30,
  },
  shield: {
    name: 'Proyector de Escudo', desc: 'Cúpula de fuerza sobre tu estación.', benefits: ['−35 % de daño recibido', 'Radio 42'], cost: cost(60, 120, 60),
    hp: 600, buildTime: 22, era: 2, pop: 0, energy: 0, trains: [], dropsite: false, freePlacement: false, sight: 40, radius: 7,
    hotkey: 'N', shield: { radius: 42, reduction: 0.35 },
  },
  dyson: {
    name: 'Planta Dyson', desc: 'Colectores en órbita de una estrella artificial.', benefits: ['+3 energía por segundo'], cost: cost(200, 260),
    hp: 950, buildTime: 40, era: 3, pop: 0, energy: 3, trains: [], dropsite: false, freePlacement: false, sight: 40, radius: 8,
    hotkey: 'M',
  },
  matrioshka: {
    name: 'Centro de Cómputo', desc: 'Capas de computación alrededor de un sol (cerebro Matrioshka).', benefits: ['+30 % minería', 'Fabricación 30 % más rápida'],
    cost: cost(400, 400, 200), hp: 1500, buildTime: 50, era: 4, pop: 0, energy: 0.5, trains: [], dropsite: false, freePlacement: false,
    sight: 50, radius: 8, hotkey: 'O', gatherBonus: 0.3, trainSpeed: 0.3,
  },
};

export const BEACON_LEDGERS_TO_WIN = 30;

export const ERAS: Record<Era, { name: string; lema: string }> = {
  1: { name: 'Génesis', lema: 'El primer ledger' },
  2: { name: 'Consenso', lema: 'El protocolo SCP une a la flota' },
  3: { name: 'Soroban', lema: 'Contratos inteligentes en órbita' },
  4: { name: 'Galáctica', lema: 'Pagos sin fronteras entre estrellas' },
};

export const ERA_UP: Record<2 | 3 | 4, { cost: Res; time: number }> = {
  2: { cost: cost(300, 200), time: 30 },
  3: { cost: cost(600, 450, 120), time: 45 },
  4: { cost: cost(1000, 800, 300), time: 60 },
};

export const GATHER = {
  perTrip: 10,
  // unidades por segundo
  rate: 1.6,
  reach: 4,
  labBonus: 0.2,
};

// recursos minables: qué casilla del almacén llenan, cómo se llaman y cuánto trae cada roca
export const DEPOSITS: Record<AsteroidKind, { key: ResKey; name: string; short: string; amount: number; color: string }> = {
  lumen: { key: 'lumens', name: 'Asteroide de Lumen', short: 'Lumens', amount: 600, color: '#c9a91c' },
  metal: { key: 'metal', name: 'Asteroide metálico', short: 'metal', amount: 650, color: '#8a5a3a' },
  energy: { key: 'energy', name: 'Cristal de energía', short: 'energía', amount: 320, color: '#7d5cff' },
};

// anomalías: cada tantos ledgers aparece un campo nuevo (y su espejo, para que sea justo)
export const ANOMALY = { everyLedgers: 36, rocks: 5, spread: 9 };

export const PLANET = {
  incomePerLedger: 15,
  // integridad por unidad de radio: un planeta mediano aguanta un bombardeo largo
  hpPerRadius: 220,
  // al romperse: botín inmediato por unidad de radio, onda expansiva y escombros con más recursos
  loot: { lumens: 15, metal: 15, energy: 6 },
  blast: { reach: 30, damage: 90 },
  debris: { perRadius: 0.9, richness: 1.6 },
  captureRadius: 6,
  // segundos con un robot solo para pasar de neutral a capturado
  captureSeconds: 10,
};

export const START_RES: Res = cost(250, 200, 50);

/**
 * Agujeros negros: dos parejas en espejo entre las bases. Dentro del radio la velocidad cae hasta `minSpeed`
 * en el centro; rodearlos es más rápido que cruzarlos, pero pueden servir de atajo o de trampa.
 */
/**
 * Agujeros de gusano: cada pareja une dos puntos en espejo del mapa (justo para los dos bandos). Mandar tropas
 * a una boca las saca por la otra: sirven para flanquear o para volver rápido a defender.
 */
export const WORMHOLES = { radius: 16, cooldownTicks: 60, pairs: [{ a: { x: -345, z: -250 }, b: { x: 345, z: 250 } }, { a: { x: -378, z: 0 }, b: { x: 378, z: 0 } }] };

/**
 * Nebulosas iónicas, en espejo: las unidades dentro solo se detectan desde `sight` unidades. Sirven para
 * esconder un ejército y emboscar; el rival ve una nube, no lo que hay dentro.
 */
export const NEBULAE = { sight: 20, spots: [{ x: 80, z: 130, r: 46 }, { x: -300, z: -60, r: 40 }] };

/**
 * Cometas: cada `everyLedgers` uno cruza el mapa en línea recta por el centro (así sus restos caen en espejo).
 * Avisa unos segundos antes, daña lo que toque y deja cristales de energía helada a lo largo de su estela.
 */
export const COMET = { everyLedgers: 20, offsetLedgers: 8, warnTicks: 80, flightTicks: 150, reach: 9, damagePerTick: 10, drops: [0.28, 0.4], rocks: 3, richness: 1.4 };

/**
 * Mercado Central, en el centro del mapa: quien tenga una nave o robot dentro de `reach` cambia lotes de
 * recursos. Cada venta abarata lo vendido y encarece lo comprado (`step`); con cada ledger los precios
 * vuelven poco a poco a su base. La comisión hace que comerciar cueste algo frente a minar.
 */
export const MARKET = { pos: { x: 0, z: 0 }, radius: 20, reach: 60, lot: 100, fee: 0.12, step: 0.06, relax: 0.15,
  base: { lumens: 1, metal: 1, energy: 2 } as Res, min: 0.35, max: 3 };

export const BLACK_HOLES = { minSpeed: 0.3, spots: [{ x: 150, z: 240, r: 38 }, { x: -215, z: 20, r: 34 }] };
