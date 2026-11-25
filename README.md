# Stellar Conquer

**Estrategia en tiempo real en el espacio, construida sobre el ecosistema Stellar.**

Recolecta Lumens en los cinturones de asteroides, ensambla tu estación espacial módulo a módulo,
entrena drones, robots y naves, conquista planetas y destruye el Núcleo enemigo.
La dinámica es la de los RTS clásicos (recolectar, construir, avanzar de era y atacar),
pero el campo de batalla es una galaxia en 3D que puedes rotar, inclinar y acercar.

## La idea

- **Estación modular.** No hay ciudad: hay una estación. Cada módulo (hábitat, panel solar, hangar, laboratorio, torreta…)
  se acopla a un puerto libre de un módulo existente y queda conectado por un pasillo.
- **Tres recursos.** Lumens (XLM) de los asteroides de cristal, metal de los asteroides rocosos y energía de los paneles solares.
- **Unidades.** Drones recolectores, robots de asalto que aterrizan en planetas para conquistarlos y naves de combate.
- **Planetas.** Cada planeta conquistado paga Lumens cada ledger.
- **Ledgers.** Como en la red Stellar, cada ~5 segundos se cierra un ledger: se pagan los planetas y el Núcleo emite su pulso.
- **Eras.** Génesis → Consenso → Soroban → Galáctica. Cada era desbloquea módulos y unidades.

## Cómo jugar en local

```bash
cd game
pnpm install
pnpm dev
```

## Estructura

```
game/
  src/sim/      simulación determinista (sin Three.js)
  src/render/   render 3D procedural con Three.js
  src/ui/       HUD, entrada y menús
  test/         pruebas de la simulación
```
