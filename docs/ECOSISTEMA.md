# Ecosistema on-chain de Stellar Conquer

Misma economía que Age of Chains (token del juego, recursos tokenizados, ítems, mercado y
resultados verificables), pero rediseñada para Stellar en vez de copiar los contratos EVM.
En Age of Chains había nueve contratos en Solidity. Aquí hay **tres contratos Soroban** y el resto
lo pone la propia red: activos clásicos, sus Stellar Asset Contracts (SAC), el DEX y los pools AMM.

```
                       activos clásicos de Stellar (emisor bloqueado)
          ┌──────────┐   ┌──────────┬──────────┬──────────┐
          │   STAR   │   │   LMN    │   MTL    │   NRG    │◀──── DEX y pools AMM nativos
          │  (SAC)   │   │  (SAC)   │  (SAC)   │  (SAC)   │      path payments a XLM / USDC
          └──▲───▲───┘   └────▲─────┴────▲─────┴────▲─────┘
  transfer   │   │ burn+      │ mint / burn (admin = Vault)
  recompensa │   │ transfer   │
┌────────────┴┐ ┌┴──────────┐ ┌┴──────────────┐
│  Conquest   │ │  Armory   │◀┤     Vault     │
│ resultados  │ │ ítems,    │ │ sesiones y    │
│ + fondo     │ │ tienda,   │ │ liquidación   │
│ de STAR     │ │ mercado   │ │ de recursos   │
└──────▲──────┘ └───────────┘ └──────▲────────┘
       │      firma ed25519           │
       └─────────── Verificador ──────┘
               (re-simula seed + comandos)
```

## Qué hace la red por nosotros

| En Age of Chains (EVM) | En Stellar Conquer |
|---|---|
| `GloryToken` ERC-20 con cap | **STAR**: activo clásico; se acuña todo y se bloquea el emisor (`master-weight 0`), así el suministro queda fijo a nivel de protocolo |
| 4 × `ResourceToken` ERC-20 | **LMN, MTL, NRG**: activos clásicos; la bóveda es admin de su SAC y es la única que puede acuñar |
| `ResourceMarket` (AMM x·y=k propio) | **DEX y pools AMM nativos**. Sin contrato propio, sin riesgo de auditoría, con path payments a XLM o USDC |
| `RewardsPool` + `MatchRegistry` | **Conquest**: un solo contrato, sin llamadas entre contratos al cobrar |
| `GameItems` ERC-1155 + `Marketplace` | **Armory**: ítems, tienda y mercado en un contrato |
| `MatchVault` | **Vault** |
| Firmas EIP-712 (secp256k1) | **ed25519 nativo del host**, la misma curva que las cuentas Stellar |

Otras optimizaciones:
- **Almacenamiento temporal** para los contadores diarios (recompensas por jugador, parejas,
  liquidaciones, acuñación del día). Caduca solo y no se paga renta de largo plazo.
- **Saldos en cero se borran**, así no se paga renta por entradas vacías.
- **Constructores** (`__constructor`): la configuración se fija al desplegar, sin una función
  `init` que alguien pueda llamar antes.
- **WASM de 13 a 18 KB** (perfil `opt-level = "z"`, LTO y `panic = abort`): menos tarifa al subirlo
  y al instanciarlo.
- **Firmas atadas al contrato**: el verificador firma `(dirección del contrato, datos)`. Una firma no
  sirve en otro despliegue ni en otra red.
- `upgrade(wasm_hash)` en cada contrato: se corrige un error sin cambiar las direcciones.

## Activos

| Código | Qué es | Suministro |
|---|---|---|
| `STAR` | moneda de la economía: recompensas, tienda y mercado | 100 M fijos |
| `LMN` | Lumen dorado del juego (no es XLM) | lo acuña la bóveda al liquidar partidas |
| `MTL` | metal | igual |
| `NRG` | energía | igual |

Reparto de STAR en el despliegue: 40 M al fondo de recompensas (saldo del contrato Conquest) y
60 M al tesoro, para el equipo con vesting, la comunidad, la liquidez y la reserva.

## Contratos

### Conquest — resultados y recompensas

| Función | Qué hace |
|---|---|
| `report(result, sig)` | Cualquiera publica un resultado firmado por el verificador. Abre la ventana de disputa |
| `dispute(challenger, id)` | Impugna dentro de la ventana |
| `resolve(id, valid)` | El admin (árbitro) re-simula y decide |
| `claim(id)` | Pasada la ventana, registra victoria y derrota y paga al ganador |
| `quote(player, vs_ai)` | Cuánto cobraría hoy |
| `stats(player)` | Victorias, derrotas y STAR ganados |

Reglas: 50 STAR por victoria PvP y 10 contra la IA. Presupuesto global de 54.794 STAR al día el
primer año, que se divide a la mitad cada 365 días. Tope de 200 STAR por jugador al día.
Rendimientos decrecientes: de la 1.ª a la 3.ª recompensa del día 100 %, de la 4.ª a la 6.ª 50 %,
de la 7.ª a la 10.ª 25 %, después 0. Una sola recompensa al día por pareja de rivales.

### Armory — ítems, tienda y mercado

Categorías: `Skin` (cascos de nave), `Squadron` (escuadras que entran a la partida),
`Blueprint` (planos de módulos) y `Faction`.

- `buy`: tienda oficial. **La mitad del pago se quema** con `burn` del SAC de STAR y la otra mitad va
  al tesoro.
- `list`, `buy_listing` (admite compras parciales) y `cancel`: mercado P2P con custodia y 5 % de
  regalía al tesoro.
- `consume`: solo la bóveda puede llamarla, y además necesita la firma del dueño.

### Vault — de la partida a la cadena

1. `open(player, seed, items, amounts)` abre una sesión y quema hasta 3 ítems.
2. `deposit(player, session, res, amount)` quema recursos de la wallet (por ejemplo, comprados en el
   DEX). El evento `Deposited` le dice al juego que los sume a la partida.
3. `sell(player, session, res, amount)` registra una venta desde la partida.
4. `settle(settlement, sig)`, con la firma del verificador, acuña lo vendido más el sobrante.

Topes: 500 de sobrante por recurso, 5 liquidaciones por jugador al día y 50.000 acuñados por
recurso al día entre todos los jugadores.

## Compilar, probar y desplegar

```bash
cd contracts
cargo test                 # 16 pruebas
stellar contract build     # WASM en target/wasm32v1-none/release

cd ..
infra/deploy.sh            # testnet; NETWORK=local para un quickstart local
```

El script escribe las direcciones en `game/src/chain/deployment.<red>.json`.

## Antes de mainnet

- Pasar `admin` a una cuenta multisig y separar árbitro, curador y verificador.
- Usar identidades en el almacén seguro (`--secure-store`) o una Ledger, nunca claves en texto plano.
- Auditoría externa de Vault y Conquest, que son los que mueven valor.
- Varios verificadores independientes o pruebas de fraude en lugar de un solo firmante.
- Publicar `stellar.toml` en el dominio del juego (SEP-1) con los cuatro activos, para que las
  wallets los muestren verificados.

## Siguiente paso: conectar el juego

- **Wallet**: Freighter con `@stellar/freighter-api` y `@stellar/stellar-sdk` para firmar `open`,
  `deposit`, `sell` y las trustlines de LMN, MTL y NRG.
- **Registro de comandos**: el juego ya es determinista. Falta grabar `seed + comandos` para que el
  verificador pueda re-simular.
- **Verificador**: un servicio en Node que reutiliza `game/src/sim`, re-simula, compara el hash del
  estado y firma con ed25519.
