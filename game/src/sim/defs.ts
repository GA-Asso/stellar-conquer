// Catálogo de unidades, módulos y eras. Los nombres vienen del ecosistema Stellar.
import type { Era, ModuleType, Res, UnitType } from './types';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
// Stellar cierra un ledger cada ~5 segundos
export const LEDGER_SECONDS = 5;
export const LEDGER_TICKS = LEDGER_SECONDS * TICK_HZ;
export const MAP_HALF = 260;
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
    name: 'Dron Ancla', desc: 'Recolecta Lumens y metal, y ensambla módulos.',
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
}

export const MODULES: Record<ModuleType, ModuleDef> = {
  core: {
    name: 'Núcleo Estelar', desc: 'Corazón de la estación. Si cae, pierdes.',
    cost: cost(), hp: 3200, buildTime: 1, era: 1, pop: 6, energy: 0.3, trains: ['drone'],
    dropsite: true, freePlacement: false, attack: { damage: 6, range: 30, cooldown: 1.2, weapon: 'laser' },
    sight: 70, radius: 9, hotkey: '',
  },
  habitat: {
    name: 'Hábitat', desc: '+8 de población.', cost: cost(0, 50), hp: 520, buildTime: 14, era: 1, pop: 8, energy: 0,
    trains: [], dropsite: false, freePlacement: false, sight: 30, radius: 7, hotkey: 'A',
  },
  solar: {
    name: 'Panel Solar', desc: 'Genera energía de forma continua.', cost: cost(0, 45), hp: 320, buildTime: 12, era: 1, pop: 0,
    energy: 0.9, trains: [], dropsite: false, freePlacement: false, sight: 25, radius: 7, hotkey: 'S',
  },
  anchor: {
    name: 'Ancla', desc: 'Puesto remoto: descarga de recursos y nuevo punto de acople.', cost: cost(0, 100), hp: 700,
    buildTime: 20, era: 1, pop: 0, energy: 0, trains: [], dropsite: true, freePlacement: true, sight: 45, radius: 7, hotkey: 'D',
  },
  hangar: {
    name: 'Hangar', desc: 'Construye naves de combate.', cost: cost(40, 120), hp: 900, buildTime: 24, era: 1, pop: 0, energy: 0,
    trains: ['interceptor', 'frigate', 'dreadnought'], dropsite: false, freePlacement: false, sight: 35, radius: 8, hotkey: 'F',
  },
  factory: {
    name: 'Forja de Robots', desc: 'Ensambla robots de abordaje.', cost: cost(40, 130), hp: 900, buildTime: 24, era: 1, pop: 0,
    energy: 0, trains: ['mecha', 'titan'], dropsite: false, freePlacement: false, sight: 35, radius: 8, hotkey: 'G',
  },
  lab: {
    name: 'Laboratorio Soroban', desc: 'Necesario para avanzar de era. +20 % de recolección.', cost: cost(80, 100), hp: 600,
    buildTime: 26, era: 1, pop: 0, energy: 0.2, trains: [], dropsite: false, freePlacement: false, sight: 30, radius: 7, hotkey: 'H',
  },
  turret: {
    name: 'Torreta Láser', desc: 'Defensa automática.', cost: cost(30, 70, 20), hp: 650, buildTime: 16, era: 2, pop: 0,
    energy: 0, trains: [], dropsite: false, freePlacement: false,
    attack: { damage: 11, range: 40, cooldown: 1, weapon: 'laser' }, sight: 50, radius: 6, hotkey: 'J',
  },
  beacon: {
    name: 'Faro de Consenso', desc: 'Maravilla: si resiste 30 ledgers, ganas la partida.', cost: cost(1200, 1000, 400),
    hp: 4200, buildTime: 90, era: 4, pop: 0, energy: 0, trains: [], dropsite: false, freePlacement: false,
    sight: 60, radius: 9, hotkey: 'K',
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

export const PLANET = {
  incomePerLedger: 15,
  captureRadius: 6,
  // segundos con un robot solo para pasar de neutral a capturado
  captureSeconds: 10,
};

export const START_RES: Res = cost(250, 200, 50);
