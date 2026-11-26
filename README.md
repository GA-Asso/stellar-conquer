# Stellar Conquer

**Estrategia en tiempo real en el espacio, construida sobre el ecosistema Stellar.**

Recolecta Lumens en los cinturones de asteroides, ensambla tu estación espacial módulo a módulo,
entrena drones, robots y naves, conquista planetas y destruye el Núcleo enemigo.
La dinámica es la de los RTS clásicos (recolectar, construir, avanzar de era y atacar),
pero el campo de batalla es una galaxia en 3D que puedes rotar, inclinar y acercar.

## Dos capas

- **Universo Stellar (mundo abierto).** Pilotas una nave entre seis galaxias, una por área del ecosistema
  (consenso, wallets, DeFi, pagos, Soroban y la Frontera). Cada nodo es un proyecto o una pieza real de
  Stellar: lo descubres leyendo qué es y respondiendo su pregunta. Aquí están el **DEX** (pools AMM y
  path payments), el **mercado de ítems** de la Armería y el **Puerto Comercial**, con encargos que pagan
  en USDC o STAR.
- **La Frontera (RTS).** Cada sector en disputa es una partida de estrategia. Llevas hasta 3 ítems
  (se queman al despegar), y al terminar el sobrante se liquida como en el contrato Vault y la victoria
  paga STAR como Conquest.

Por ahora la economía corre en el navegador con las mismas reglas que los contratos; el siguiente paso
es firmar con Freighter en testnet.

## La idea (partida RTS)

- **Estación modular.** No hay ciudad: hay una estación. Cada módulo (hábitat, panel solar, hangar, laboratorio, torreta…)
  se acopla a un puerto libre de un módulo existente y queda conectado por un pasillo.
- **Tres recursos.** Lumens dorados de los asteroides de cristal, metal de los asteroides rocosos y energía de los paneles solares.
- **Unidades.** Drones recolectores, robots de asalto que aterrizan en planetas para conquistarlos y naves de combate.
- **Planetas.** Cada planeta conquistado paga Lumens cada ledger.
- **Ledgers.** Como en la red Stellar, cada ~5 segundos se cierra un ledger: se pagan los planetas y el Núcleo emite su pulso.
- **Eras.** Génesis → Consenso → Soroban → Galáctica. Cada era desbloquea módulos y unidades.

## Ecosistema on-chain (Soroban)

La economía vive en Stellar: el token **STAR**, los recursos **LMN**, **MTL** y **NRG** como activos
clásicos que se negocian en el DEX nativo, y tres contratos en Rust:

- **Conquest**: resultados de partida verificables y recompensas en STAR.
- **Armory**: ítems, tienda y mercado P2P.
- **Vault**: lleva los recursos de la partida a la cadena y de vuelta.

Detalles en [docs/ECOSISTEMA.md](docs/ECOSISTEMA.md).

```bash
cd contracts && cargo test && stellar contract build
infra/deploy.sh   # despliega todo en testnet
```

## Cómo jugar en local

```bash
cd game
pnpm install
pnpm dev
```

## Estructura

```
game/
  src/world/    Universo Stellar: economía, mapa del ecosistema, render y HUD
  src/sim/      simulación determinista (sin Three.js)
  src/render/   render 3D procedural con Three.js
  src/ui/       HUD, entrada y menús
  test/         pruebas de la simulación
contracts/      contratos Soroban en Rust (conquest, armory, vault)
infra/          despliegue con la CLI de Stellar
docs/           documentación del ecosistema
```
