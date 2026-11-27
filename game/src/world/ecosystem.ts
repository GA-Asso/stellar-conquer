// Mapa del Universo Stellar: galaxias (áreas del ecosistema) y nodos (proyectos, piezas del protocolo y
// servicios del juego). Las descripciones se redactaron a partir del directorio del ecosistema y de la web de cada proyecto
// (consultado el 2026-11-26) y enlazan a su web oficial. Ningún nodo usa logos ni marca de terceros:
// son puntos de descubrimiento con texto propio.
import type { Asset } from './economy';
import { ATLAS_GALAXIES } from './atlas';

export type NodeKind = 'info' | 'dex' | 'market' | 'trade' | 'frontier' | 'atlas';

export interface Quiz { q: string; options: string[]; answer: number }

export interface WorldNode {
  id: string;
  galaxy: string;
  name: string;
  kind: NodeKind;
  /** posición relativa al centro de su galaxia */
  at: [number, number];
  desc: string;
  url?: string;
  quiz?: Quiz;
  reward?: { asset: Asset; amount: number };
  /** id del sector de la Frontera (solo nodos `frontier`) */
  sector?: string;
}

export interface Galaxy { id: string; name: string; color: string; center: [number, number]; radius: number; blurb: string }

export const GALAXIES: Galaxy[] = [
  { id: 'nucleo', name: 'Núcleo de Consenso', color: '#fdda24', center: [0, 0], radius: 150,
    blurb: 'El corazón de la red: validadores, ledgers y las herramientas para verlo todo.' },
  { id: 'wallets', name: 'Nebulosa de Wallets', color: '#2ee6ff', center: [-640, -430], radius: 150,
    blurb: 'Donde vive tu identidad en Stellar: wallets con y sin extensión, y cuentas con passkeys.' },
  { id: 'defi', name: 'Galaxia DeFi', color: '#8b5cff', center: [640, -430], radius: 170,
    blurb: 'El DEX nativo, los pools AMM y los protocolos Soroban que mueven liquidez.' },
  { id: 'pagos', name: 'Cúmulo de Pagos', color: '#4ade80', center: [-700, 480], radius: 160,
    blurb: 'Dólares digitales, anclas y activos del mundo real: la red al servicio de los pagos.' },
  { id: 'soroban', name: 'Forja Soroban', color: '#ff9f43', center: [700, 480], radius: 150,
    blurb: 'Contratos inteligentes, quien los construye y quien los financia. Aquí está el mercado de ítems.' },
  { id: 'frontera', name: 'La Frontera', color: '#ff3d8b', center: [0, 980], radius: 200,
    blurb: 'Sectores en disputa. Cada uno es una partida de estrategia: gánala y el sector es tuyo.' },
  // galaxias que solo pueblan los proyectos del atlas de Raven; el radio se ajusta al cargar los datos
  ...ATLAS_GALAXIES.map(g => ({ ...g, radius: 150 })),
];

/** radio libre en el centro de cada galaxia curada, reservado a sus nodos */
export const CURATED_INNER: Record<string, number> = { nucleo: 165, wallets: 165, defi: 175, pagos: 170, soroban: 165 };


export const NODES: WorldNode[] = [
  // ---------- Núcleo de Consenso ----------
  { id: 'observatorio', galaxy: 'nucleo', name: 'Observatorio Raven', kind: 'atlas', at: [0, 130],
    desc: 'Todo lo que Raven sabe del ecosistema, en gráficos: proyectos por categoría, financiación del SCF, TVL, stablecoins, activos reales, auditorías, actividad de desarrolladores y hackathons. Cada estrella del universo es uno de estos proyectos.' },
  { id: 'scp', galaxy: 'nucleo', name: 'Stellar Consensus Protocol', kind: 'info', at: [0, 0],
    desc: 'Stellar no se mina. Cada validador elige en qué otros validadores confía (su quórum) y la red llega a acuerdo cuando esos quórums se solapan. Así cierra un ledger cada pocos segundos con un coste mínimo.',
    url: 'https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol',
    quiz: { q: '¿Cómo llega Stellar a consenso?', options: ['Con minería de prueba de trabajo', 'Cada validador elige en quién confía y los quórums se solapan', 'Un servidor central aprueba cada transacción'], answer: 1 },
    reward: { asset: 'XLM', amount: 5 } },
  { id: 'ledger', galaxy: 'nucleo', name: 'El Ledger', kind: 'info', at: [-80, 55],
    desc: 'Cada ledger es una página del libro mayor con todas las cuentas, ofertas y contratos. En la partida también cuentas ledgers: cada ~5 s tus planetas pagan.',
    url: 'https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers',
    quiz: { q: '¿Cada cuánto cierra un ledger en Stellar, aproximadamente?', options: ['Cada 5 segundos', 'Cada 10 minutos', 'Cada hora'], answer: 0 },
    reward: { asset: 'XLM', amount: 5 } },
  { id: 'rpc', galaxy: 'nucleo', name: 'Stellar RPC', kind: 'info', at: [85, 60],
    desc: 'La puerta de entrada a los contratos Soroban: simula transacciones para calcular tarifas y recursos, las envía y lee eventos y estado de contratos.',
    url: 'https://developers.stellar.org/docs/build/guides/rpc',
    quiz: { q: '¿Qué servicio usas para simular e invocar contratos Soroban?', options: ['Stellar RPC', 'Un nodo de Bitcoin', 'El correo del validador'], answer: 0 },
    reward: { asset: 'XLM', amount: 5 } },
  { id: 'stellar-expert', galaxy: 'nucleo', name: 'StellarExpert', kind: 'info', at: [-60, -85],
    desc: 'Explorador de bloques y plataforma de analítica de la red: cuentas, activos, historial de precios y contratos.',
    url: 'https://stellar.expert',
    quiz: { q: '¿Para qué usarías StellarExpert?', options: ['Para minar XLM', 'Para explorar cuentas, activos y transacciones de la red', 'Para compilar contratos'], answer: 1 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'stellar-lab', galaxy: 'nucleo', name: 'Stellar Laboratory', kind: 'info', at: [70, -80],
    desc: 'Caja de herramientas web para desarrolladores: crear, firmar y enviar transacciones y explorar la red desde el navegador.',
    url: 'https://lab.stellar.org',
    quiz: { q: '¿Qué puedes hacer en Stellar Laboratory?', options: ['Crear, firmar y enviar transacciones desde el navegador', 'Comprar hardware de minería', 'Nada sin instalar un nodo'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },

  // ---------- Nebulosa de Wallets ----------
  { id: 'freighter', galaxy: 'wallets', name: 'Freighter', kind: 'info', at: [0, 0],
    desc: 'Wallet no custodial en forma de extensión de navegador, desarrollada por la Stellar Development Foundation, para firmar transacciones desde aplicaciones web. Será la wallet con la que firmes en testnet.',
    url: 'https://freighter.app',
    quiz: { q: '¿Qué significa que Freighter sea "no custodial"?', options: ['Que la SDF guarda tus claves', 'Que tú controlas tus claves y firmas tus transacciones', 'Que no puede firmar transacciones'], answer: 1 },
    reward: { asset: 'XLM', amount: 5 } },
  { id: 'lobstr', galaxy: 'wallets', name: 'LOBSTR', kind: 'info', at: [-90, 50],
    desc: 'Wallet web y móvil para interactuar con la red Stellar y su exchange descentralizado, con libros de órdenes y gestión de activos.',
    url: 'https://lobstr.co',
    quiz: { q: '¿Qué ofrece LOBSTR además de guardar activos?', options: ['Acceso al DEX de Stellar', 'Minería en la nube', 'Correo electrónico'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'xbull', galaxy: 'wallets', name: 'xBull', kind: 'info', at: [85, 55],
    desc: 'Wallet de código abierto y no custodial para gestionar activos de Stellar.',
    url: 'https://xbull.app',
    quiz: { q: 'xBull es una wallet…', options: ['Custodial y cerrada', 'De código abierto y no custodial', 'Solo para Bitcoin'], answer: 1 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'beans', galaxy: 'wallets', name: 'Beans', kind: 'info', at: [-40, -90],
    desc: 'App no custodial de pagos y ahorro sobre Stellar, pensada para que cualquiera tenga una experiencia tipo banco.',
    url: 'https://beansapp.com',
    quiz: { q: '¿En qué se centra Beans?', options: ['Pagos y ahorro para el público general', 'Validar ledgers', 'Emitir bonos del gobierno'], answer: 0 },
    reward: { asset: 'USDC', amount: 1 } },
  { id: 'passkeys', galaxy: 'wallets', name: 'Cuentas con passkeys', kind: 'info', at: [75, -75],
    desc: 'Las smart wallets son cuentas de contrato: guardan activos y deciden quién autoriza en su propio código. Lo más común es usar passkeys (WebAuthn), así que se entra con la huella o FaceID, sin frase semilla. Es el camino para que un jugador empiece sin instalar nada.',
    url: 'https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets',
    quiz: { q: '¿Qué permite entrar con huella o FaceID en Stellar?', options: ['Smart wallets: cuentas de contrato que aceptan passkeys (WebAuthn)', 'Una contraseña guardada en el validador', 'Nada, siempre hace falta la frase semilla'], answer: 0 },
    reward: { asset: 'XLM', amount: 6 } },

  // ---------- Galaxia DeFi ----------
  { id: 'sdex', galaxy: 'defi', name: 'DEX nativo de Stellar', kind: 'dex', at: [0, 0],
    desc: 'Stellar trae un exchange en el propio protocolo: libros de órdenes y pools de liquidez sin desplegar contratos. Cambia aquí XLM, USDC, STAR y los recursos del juego. Los path payments encadenan varios mercados en una sola operación.',
    url: 'https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools',
    quiz: { q: '¿Qué comisión cobran los pools de liquidez nativos de Stellar?', options: ['0,30 %', '3 %', 'No cobran nada'], answer: 0 },
    reward: { asset: 'STAR', amount: 5 } },
  { id: 'soroswap', galaxy: 'defi', name: 'Soroswap', kind: 'info', at: [-100, 60],
    desc: 'Protocolo AMM de código abierto y agregador de rutas sobre Soroban para aportar liquidez y cambiar activos de Stellar.',
    url: 'https://soroswap.finance',
    quiz: { q: '¿Qué hace un agregador como el de Soroswap?', options: ['Busca la mejor ruta entre varios mercados', 'Mina bloques', 'Guarda tus claves'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'aquarius', galaxy: 'defi', name: 'Aquarius', kind: 'info', at: [100, 70],
    desc: 'Capa de liquidez que incentiva a quien provee liquidez y hace mercado en el DEX nativo y en los AMM de Stellar.',
    url: 'https://aqua.network',
    quiz: { q: '¿Qué incentiva Aquarius?', options: ['La provisión de liquidez', 'La minería', 'El spam de transacciones'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'phoenix', galaxy: 'defi', name: 'Phoenix', kind: 'info', at: [-120, -50],
    desc: 'AMM para intercambios descentralizados, primero de una serie de protocolos DeFi sobre Soroban.',
    url: 'https://phoenix-hub.io',
    quiz: { q: 'Phoenix empezó como…', options: ['Un AMM', 'Una wallet de hardware', 'Un ancla de efectivo'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'blend', galaxy: 'defi', name: 'Blend', kind: 'info', at: [40, -110],
    desc: 'Protocolo de préstamos sobre Soroban con el que usuarios, DAOs e instituciones crean pools de préstamo.',
    url: 'https://blend.capital',
    quiz: { q: '¿Qué tipo de protocolo es Blend?', options: ['Préstamos', 'Juegos', 'Mensajería'], answer: 0 },
    reward: { asset: 'USDC', amount: 1 } },
  { id: 'defindex', galaxy: 'defi', name: 'DeFindex', kind: 'info', at: [130, -40],
    desc: 'Ayuda a las wallets a ofrecer cuentas de ahorro con una cartera DeFi diversificada.',
    url: 'https://defindex.io',
    quiz: { q: '¿A quién ayuda DeFindex a ofrecer ahorro?', options: ['A las wallets', 'A los validadores', 'A los mineros'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'reflector', galaxy: 'defi', name: 'Reflector', kind: 'info', at: [-40, 120],
    desc: 'Oráculo descentralizado de precios para contratos DeFi de Stellar: derivados, préstamos y gestión de activos.',
    url: 'https://reflector.network',
    quiz: { q: '¿Qué le da un oráculo como Reflector a un contrato?', options: ['Precios del mundo exterior', 'Más espacio en disco', 'Claves privadas'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },

  // ---------- Cúmulo de Pagos ----------
  { id: 'puerto', galaxy: 'pagos', name: 'Puerto Comercial', kind: 'trade', at: [0, 0],
    desc: 'Estaciones de toda la galaxia piden recursos y pagan en USDC o STAR por encima del mercado. Consigue lo que piden (minando en la Frontera o con un path payment en el DEX) y entrégalo.' },
  { id: 'usdc', galaxy: 'pagos', name: 'USDC de Circle', kind: 'info', at: [-95, 55],
    desc: 'Circle emite USDC y EURC. En Stellar, USDC es un activo nativo de la red: se mueve en segundos por fracciones de céntimo y se cambia en el DEX.',
    url: 'https://www.circle.com/usdc',
    quiz: { q: '¿Quién emite USDC?', options: ['Circle', 'Los validadores de Stellar', 'Cualquier wallet'], answer: 0 },
    reward: { asset: 'USDC', amount: 2 } },
  { id: 'moneygram', galaxy: 'pagos', name: 'MoneyGram', kind: 'info', at: [95, 60],
    desc: 'Red global de envíos de dinero en más de 200 países. Gracias a su integración con Stellar se puede convertir efectivo en USDC y viceversa desde una wallet.',
    url: 'https://www.moneygram.com',
    quiz: { q: '¿Qué permite la integración de MoneyGram con Stellar?', options: ['Convertir efectivo a USDC y viceversa', 'Minar XLM en sus oficinas', 'Votar en el consenso'], answer: 0 },
    reward: { asset: 'USDC', amount: 2 } },
  { id: 'anclas', galaxy: 'pagos', name: 'Anclas y SEPs', kind: 'info', at: [-60, -95],
    desc: 'Un ancla conecta la red con el dinero de siempre. Los estándares SEP lo hacen interoperable: SEP-1 publica stellar.toml, SEP-10 autentica cuentas y SEP-24 define depósitos y retiros interactivos.',
    url: 'https://developers.stellar.org/docs/learn/fundamentals/anchors',
    quiz: { q: '¿Qué estándar define depósitos y retiros interactivos con un ancla?', options: ['SEP-24', 'SEP-1', 'ERC-20'], answer: 0 },
    reward: { asset: 'USDC', amount: 1 } },
  { id: 'etherfuse', galaxy: 'pagos', name: 'Etherfuse', kind: 'info', at: [70, -90],
    desc: 'Stablebonds: bonos del gobierno tokenizados con rendimiento, transparentes y accesibles para inversores minoristas.',
    url: 'https://etherfuse.com',
    quiz: { q: '¿Qué son los Stablebonds de Etherfuse?', options: ['Bonos del gobierno tokenizados', 'Cascos para naves', 'Tarifas de red'], answer: 0 },
    reward: { asset: 'USDC', amount: 1 } },
  { id: 'benji', galaxy: 'pagos', name: 'Benji · Franklin Templeton', kind: 'info', at: [-125, -10],
    desc: 'Plataforma de Franklin Templeton para acceder a valores tokenizados, como su fondo del mercado monetario registrado en Stellar.',
    url: 'https://www.benjiinvestments.com',
    quiz: { q: '¿Qué gestora creó Benji?', options: ['Franklin Templeton', 'Una DAO anónima', 'Un validador'], answer: 0 },
    reward: { asset: 'USDC', amount: 1 } },

  // ---------- Forja Soroban ----------
  { id: 'armory', galaxy: 'soroban', name: 'Mercado de la Armería', kind: 'market', at: [0, 0],
    desc: 'La tienda oficial y el mercado entre pilotos. En la tienda la mitad del pago se quema; en el mercado cada venta paga un 5 % de regalía al tesoro. Es el contrato Armory del juego.' },
  { id: 'soroban-core', galaxy: 'soroban', name: 'Soroban', kind: 'info', at: [-95, 55],
    desc: 'La plataforma de contratos inteligentes de Stellar. Los contratos se escriben en Rust y se compilan a WebAssembly. Los tres contratos de este juego (Conquest, Armory y Vault) son contratos Soroban.',
    url: 'https://developers.stellar.org/docs/build/smart-contracts/overview',
    quiz: { q: '¿En qué lenguaje se escriben normalmente los contratos Soroban?', options: ['Rust, compilado a WebAssembly', 'Solidity', 'COBOL'], answer: 0 },
    reward: { asset: 'STAR', amount: 3 } },
  { id: 'openzeppelin', galaxy: 'soroban', name: 'OpenZeppelin', kind: 'info', at: [95, 55],
    desc: 'Referente en seguridad de contratos, conocido por sus librerías y herramientas. Colabora con Stellar en librerías para Soroban.',
    url: 'https://www.openzeppelin.com',
    quiz: { q: '¿Por qué es conocido OpenZeppelin?', options: ['Librerías y seguridad de contratos', 'Juegos de carreras', 'Minería'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'stellar-quest', galaxy: 'soroban', name: 'Stellar Quest', kind: 'info', at: [-60, -95],
    desc: 'Plataforma que convierte en juego el aprendizaje de Stellar, tanto la red clásica como Soroban.',
    url: 'https://quest.stellar.org',
    quiz: { q: '¿Qué es Stellar Quest?', options: ['Aprendizaje de Stellar en forma de juego', 'Un validador', 'Un exchange centralizado'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },
  { id: 'scf', galaxy: 'soroban', name: 'Stellar Community Fund', kind: 'info', at: [70, -90],
    desc: 'El programa con el que la comunidad financia proyectos sobre Stellar. El Build Award da hasta 150.000 USD en XLM, repartidos en tramos ligados a hitos hasta llegar a mainnet.',
    url: 'https://communityfund.stellar.org',
    quiz: { q: '¿Cómo se entrega un Build Award del SCF?', options: ['En tramos ligados a hitos', 'Todo por adelantado', 'En acciones de la SDF'], answer: 0 },
    reward: { asset: 'STAR', amount: 3 } },
  { id: 'sdf', galaxy: 'soroban', name: 'Stellar Development Foundation', kind: 'info', at: [-125, -15],
    desc: 'Organización sin ánimo de lucro que apoya el desarrollo y el crecimiento de la red Stellar.',
    url: 'https://stellar.org/foundation',
    quiz: { q: '¿Qué tipo de organización es la SDF?', options: ['Sin ánimo de lucro', 'Un banco', 'Un exchange'], answer: 0 },
    reward: { asset: 'XLM', amount: 4 } },

  // ---------- La Frontera ----------
  { id: 'f-umbral', galaxy: 'frontera', name: 'Sector Umbral', kind: 'frontier', sector: 'umbral', at: [-140, -40],
    desc: 'Un rival novato controla los asteroides del borde. Buen lugar para tu primera partida.' },
  { id: 'f-cinturon', galaxy: 'frontera', name: 'Cinturón de Cristal', kind: 'frontier', sector: 'cinturon', at: [140, -40],
    desc: 'Asteroides de cristal cargados de Lumens. El rival es tranquilo, pero no regala nada.' },
  { id: 'f-voragine', galaxy: 'frontera', name: 'Vorágine Roja', kind: 'frontier', sector: 'vorágine', at: [-80, 80],
    desc: 'Un rival que ataca pronto. Paga el doble de STAR.' },
  { id: 'f-bastion', galaxy: 'frontera', name: 'Bastión Quórum', kind: 'frontier', sector: 'bastion', at: [80, 80],
    desc: 'Estación fortificada con torretas. Paga el doble de STAR.' },
  { id: 'f-abismo', galaxy: 'frontera', name: 'Abismo Galáctico', kind: 'frontier', sector: 'abismo', at: [0, 160],
    desc: 'El rival más duro de la galaxia. Paga el triple de STAR.' },
];

/**
 * nodos curados que también son proyectos del atlas de Raven (id del nodo → slug del directorio): el
 * proyecto no se duplica como estrella y el panel del nodo muestra sus datos
 */
const SLUG_OVERRIDES: Record<string, string> = { 'stellar-lab': 'stellar-laboratory', usdc: 'circle', sdf: 'stellar-development-foundation' };
const PROJECT_NODES = ['freighter', 'lobstr', 'xbull', 'beans', 'soroswap', 'aquarius', 'phoenix', 'blend', 'defindex', 'reflector',
  'stellar-expert', 'stellar-lab', 'moneygram', 'etherfuse', 'benji', 'openzeppelin', 'stellar-quest', 'sdf', 'usdc'];
export const nodeSlug = (id: string): string | undefined => (PROJECT_NODES.includes(id) ? SLUG_OVERRIDES[id] ?? id : undefined);
export const CURATED_SLUGS = new Set(PROJECT_NODES.map(id => nodeSlug(id)!));

export const galaxyOf = (id: string) => GALAXIES.find(g => g.id === id)!;
export const nodeWorldPos = (n: WorldNode): [number, number] => {
  const g = galaxyOf(n.galaxy);
  return [g.center[0] + n.at[0], g.center[1] + n.at[1]];
};
/** nodos que cuentan para el progreso de descubrimiento */
export const DISCOVERABLE = NODES.filter(n => n.quiz);
