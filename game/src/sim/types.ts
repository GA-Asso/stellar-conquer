// Tipos de la simulación. Nada aquí depende de Three.js: el render solo lee este estado.

export type Side = 0 | 1;
export type Owner = Side | -1;
export type ResKey = 'lumens' | 'metal' | 'energy';
export type Res = Record<ResKey, number>;

export type UnitType = 'drone' | 'interceptor' | 'mecha' | 'frigate' | 'titan' | 'dreadnought';
export type ModuleType = 'core' | 'habitat' | 'solar' | 'anchor' | 'hangar' | 'factory' | 'lab' | 'turret' | 'beacon'
  | 'seti' | 'replicator' | 'shield' | 'dyson' | 'matrioshka';
export type AsteroidKind = 'lumen' | 'metal' | 'energy';
export type Era = 1 | 2 | 3 | 4;

export interface Vec { x: number; z: number }
export interface Hex { q: number; r: number }

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; to: Vec; aggressive: boolean }
  | { kind: 'attack'; target: number }
  | { kind: 'gather'; target: number; phase: 'go' | 'mine' | 'return' }
  | { kind: 'build'; target: number };

export interface Unit {
  id: number;
  kind: 'unit';
  type: UnitType;
  side: Side;
  pos: Vec;
  facing: number;
  hp: number;
  maxHp: number;
  order: Order;
  carry: { res: AsteroidKind; amount: number } | null;
  cooldown: number;
  // última posición de destino de minería, para volver al campo cuando se agota un asteroide
  lastField: Vec | null;
  // ticks seguidos sin acercarse al destino (para dar la llegada por buena en un grupo apretado)
  stall?: number;
  lastDist?: number;
  // ticks hasta poder volver a cruzar un agujero de gusano (evita rebotar entre las dos bocas)
  warpCd?: number;
}

export interface QueueItem { item: UnitType | 'era'; progress: number; total: number }

export interface Module {
  id: number;
  kind: 'module';
  type: ModuleType;
  side: Side;
  hex: Hex;
  pos: Vec;
  hp: number;
  maxHp: number;
  // 0..1: progreso de ensamblaje. 1 = operativo
  built: number;
  // módulo al que está acoplado (para dibujar el pasillo). null en núcleo y anclas
  parent: number | null;
  queue: QueueItem[];
  cooldown: number;
  rally: Vec | null;
}

export interface Asteroid {
  id: number;
  kind: 'asteroid';
  res: AsteroidKind;
  pos: Vec;
  amount: number;
  radius: number;
}

export interface Planet {
  id: number;
  kind: 'planet';
  name: string;
  pos: Vec;
  radius: number;
  owner: Owner;
  // -1..1: negativo avanza hacia el lado 1, positivo hacia el lado 0
  capture: number;
  // integridad: un planeta se puede bombardear hasta romperlo en un campo de escombros ricos
  hp: number;
  maxHp: number;
  // último bando que lo dañó: se lleva el botín si lo rompe
  lastAttacker: Owner;
}

/** agujero negro: frena a todo lo que vuela dentro de su radio (más cuanto más cerca del centro) */
export interface BlackHole { pos: Vec; radius: number }

/** agujero de gusano: dos bocas enlazadas; una unidad enviada a una boca sale por la otra */
export interface Wormhole { a: Vec; b: Vec; radius: number }

/** nebulosa iónica: lo que está dentro no se ve ni se apunta desde lejos (emboscadas) */
export interface Nebula { pos: Vec; radius: number }

/** cometa que cruza el mapa: aviso desde `warn`, vuelo de `start` a `end` (ticks) */
export interface Comet { from: Vec; to: Vec; warn: number; start: number; end: number }

export type Entity = Unit | Module | Asteroid | Planet;

export interface Player {
  side: Side;
  res: Res;
  era: Era;
  alive: boolean;
  // ledgers seguidos que el Faro de Consenso lleva en pie
  beaconLedgers: number;
  // tick del último daño recibido de un rival (-1 si nunca): la IA pacífica despierta con esto
  lastHit: number;
  // multiplicador de recolección; la IA lo ajusta para nivelarse con el jugador
  gatherMult: number;
  // alto el fuego: sus unidades y torretas no disparan primero (la IA pacífica lo usa hasta que la atacan)
  holdFire: boolean;
  // tope de drones que fabrica el Replicador Von Neumann
  maxDrones: number;
}

export type SimEvent =
  | { kind: 'shot'; from: Vec; to: Vec; side: Side; weapon: 'laser' | 'plasma' | 'melee' }
  | { kind: 'death'; pos: Vec; size: number; side: Owner }
  | { kind: 'built'; id: number; side: Side }
  | { kind: 'trained'; id: number; side: Side }
  | { kind: 'ledger'; seq: number }
  | { kind: 'captured'; planet: number; side: Side }
  | { kind: 'era'; side: Side; era: Era }
  | { kind: 'anomaly'; pos: Vec; res: AsteroidKind }
  | { kind: 'comet'; phase: 'warn' | 'drop'; from: Vec; to: Vec }
  | { kind: 'trade'; side: Side; give: ResKey; get: ResKey; paid: number; got: number }
  | { kind: 'warp'; from: Vec; to: Vec; side: Side }
  | { kind: 'planetDestroyed'; pos: Vec; radius: number; name: string; side: Owner; loot: Res };

export type Command =
  | { kind: 'move'; units: number[]; to: Vec; aggressive?: boolean }
  | { kind: 'attack'; units: number[]; target: number }
  | { kind: 'gather'; units: number[]; target: number }
  | { kind: 'build'; units: number[]; module: ModuleType; hex: Hex }
  | { kind: 'repair'; units: number[]; target: number }
  | { kind: 'train'; module: number; unit: UnitType }
  | { kind: 'era'; module: number }
  | { kind: 'cancel'; module: number }
  | { kind: 'rally'; module: number; to: Vec }
  | { kind: 'trade'; give: ResKey; get: ResKey };

export interface SimState {
  tick: number;
  ledger: number;
  seed: number;
  rngState: number;
  nextId: number;
  entities: Map<number, Entity>;
  players: [Player, Player];
  events: SimEvent[];
  winner: Owner | null;
  winReason: string;
  holes: BlackHole[];
  wormholes: Wormhole[];
  nebulae: Nebula[];
  comet: Comet | null;
  // precios del Mercado Central, en Lumens por unidad: suben al comprar y bajan al vender
  market: { price: Res };
}
