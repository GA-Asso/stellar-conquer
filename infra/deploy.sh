#!/usr/bin/env bash
# Despliega el ecosistema de Stellar Conquer con la CLI de Stellar.
#
#   infra/deploy.sh            # testnet (por defecto)
#   NETWORK=local infra/deploy.sh   # quickstart local: stellar container start local
#
# Crea las identidades (si faltan), emite los activos clásicos STAR, LMN, MTL y NRG, expone cada
# uno con su Stellar Asset Contract (SAC), despliega Armory, Conquest y Vault, cede la emisión de
# recursos a la bóveda, siembra el DEX nativo con ofertas de recursos contra XLM, reparte STAR y
# bloquea el emisor para que el suministro de STAR quede fijo. Escribe las direcciones en
# game/src/chain/deployment.<red>.json.
#
# Nunca uses este script en mainnet con identidades guardadas en texto plano: usa
# `stellar keys generate --secure-store` o una wallet de hardware (--sign-with-ledger).
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/contracts/target/wasm32v1-none/release"
OUT="$ROOT/game/src/chain/deployment.$NETWORK.json"
PREFIX="${PREFIX:-sc}"

# 7 decimales: 1 STAR = 10^7 stroops
STROOPS=10000000
STAR_SUPPLY=$((100000000 * STROOPS))     # 100 M fijos
REWARDS=$((40000000 * STROOPS))          # 40 M al fondo de recompensas (Conquest)
SEED_RES=$((1000000 * STROOPS))          # 1 M de cada recurso para sembrar el DEX

net=(--network "$NETWORK")
say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

identity() {
  local name="$PREFIX-$1"
  if ! stellar keys public-key "$name" >/dev/null 2>&1; then
    stellar keys generate "$name" "${net[@]}" --fund >/dev/null
  elif [[ "$NETWORK" != "mainnet" ]]; then
    stellar keys fund "$name" "${net[@]}" >/dev/null 2>&1 || true
  fi
  echo "$name"
}
addr() { stellar keys public-key "$1"; }
# clave pública ed25519 en hex (32 bytes) a partir de una dirección G…
raw_hex() { python3 -c 'import base64,sys; print(base64.b32decode(sys.argv[1])[1:33].hex())' "$1"; }
invoke() { local id="$1" src="$2"; shift 2; stellar contract invoke --id "$id" --source "$src" "${net[@]}" -- "$@"; }
sac() { stellar contract asset deploy --asset "$1" --source "$2" "${net[@]}" 2>/dev/null || stellar contract id asset --asset "$1" "${net[@]}"; }

say "Compilando contratos"
(cd "$ROOT/contracts" && stellar contract build >/dev/null)

say "Identidades en $NETWORK"
ADMIN=$(identity admin)       # despliega y administra (en producción: multisig)
ISSUER=$(identity issuer)     # emisor de STAR y recursos; se bloquea al final
TREASURY=$(identity treasury) # tesoro: ventas de la tienda, regalías, reserva y liquidez
VERIFIER=$(identity verifier) # firma resultados y liquidaciones (servicio off-chain)
ISSUER_G=$(addr "$ISSUER"); TREASURY_G=$(addr "$TREASURY"); ADMIN_G=$(addr "$ADMIN")
VERIFIER_HEX=$(raw_hex "$(addr "$VERIFIER")")
echo "admin $ADMIN_G"; echo "issuer $ISSUER_G"; echo "treasury $TREASURY_G"

say "Activos clásicos y sus SAC"
STAR=$(sac "STAR:$ISSUER_G" "$ISSUER")
LMN=$(sac "LMN:$ISSUER_G" "$ISSUER")
MTL=$(sac "MTL:$ISSUER_G" "$ISSUER")
NRG=$(sac "NRG:$ISSUER_G" "$ISSUER")
echo "STAR $STAR"; echo "LMN $LMN"; echo "MTL $MTL"; echo "NRG $NRG"

say "Armory"
ARMORY=$(stellar contract deploy --wasm "$WASM/armory.wasm" --source "$ADMIN" "${net[@]}" -- \
  --config "{\"admin\":\"$ADMIN_G\",\"token\":\"$STAR\",\"treasury\":\"$TREASURY_G\",\"royalty_bps\":500}")
echo "$ARMORY"

say "Conquest"
CONQUEST=$(stellar contract deploy --wasm "$WASM/conquest.wasm" --source "$ADMIN" "${net[@]}" -- \
  --config "{\"admin\":\"$ADMIN_G\",\"token\":\"$STAR\",\"verifier\":\"$VERIFIER_HEX\",\"window\":${DISPUTE_WINDOW:-600},\
\"base_pvp\":\"$((50 * STROOPS))\",\"base_ai\":\"$((10 * STROOPS))\",\"daily_budget\":\"$((54794 * STROOPS))\",\"player_cap\":\"$((200 * STROOPS))\",\
\"ai_daily_budget\":\"$((5000 * STROOPS))\",\"dispute_bond\":\"$((100 * STROOPS))\"}")
echo "$CONQUEST"

say "Vault"
VAULT=$(stellar contract deploy --wasm "$WASM/vault.wasm" --source "$ADMIN" "${net[@]}" -- \
  --config "{\"admin\":\"$ADMIN_G\",\"armory\":\"$ARMORY\",\"verifier\":\"$VERIFIER_HEX\",\"assets\":[\"$LMN\",\"$MTL\",\"$NRG\"],\
\"leftover_cap\":\"$((500 * STROOPS))\",\"daily_mint_cap\":\"$((50000 * STROOPS))\",\"max_settles\":5}")
echo "$VAULT"
invoke "$ARMORY" "$ADMIN" set_vault --vault "$VAULT" >/dev/null

say "Catálogo de la armería"
item() { invoke "$ARMORY" "$ADMIN" define_item --id "$1" --name "$2" --category "\"$3\"" --rarity "$4" --max_supply "$5" --price "$(($6 * STROOPS))" >/dev/null; echo "  $1 $2"; }
item 1   "Casco Aurora"               Skin      0 0     25
item 2   "Casco Nebulosa"             Skin      1 5000  80
item 3   "Casco Consenso Dorado"      Skin      2 500   250
item 4   "Casco Horizonte de Eventos" Skin      3 50    900
item 101 "Escuadra de interceptores"  Squadron  0 0     40
item 102 "Ala de fragatas"            Squadron  1 5000  120
item 103 "Pareja de mechas"           Squadron  0 0     60
item 111 "Plano: torreta de plasma"   Blueprint 0 0     60
item 112 "Plano: faro de consenso"    Blueprint 2 500   400
item 201 "Facción Anclas de Soroban"  Faction   1 1000  300
item 202 "Facción Validadores"        Faction   2 500   450

say "Trustlines del tesoro"
for a in STAR LMN MTL NRG; do
  stellar tx new change-trust --source "$TREASURY" --line "$a:$ISSUER_G" "${net[@]}" >/dev/null || true
done

say "Reparto de STAR (100 M fijos)"
# 40 M al fondo de recompensas (saldo de contrato vía SAC) y 60 M al tesoro
# (equipo con vesting, comunidad, liquidez y reserva: ver docs/ECOSISTEMA.md)
invoke "$STAR" "$ISSUER" mint --to "$CONQUEST" --amount "$REWARDS" >/dev/null
invoke "$STAR" "$ISSUER" mint --to "$TREASURY_G" --amount "$((STAR_SUPPLY - REWARDS))" >/dev/null

say "Liquidez inicial en el DEX nativo (recursos contra XLM)"
for a in LMN MTL NRG; do
  stellar tx new payment --source "$ISSUER" --destination "$TREASURY_G" --asset "$a:$ISSUER_G" --amount "$SEED_RES" "${net[@]}" >/dev/null
  # 1 recurso = 0,01 XLM (precio como fracción n/d)
  stellar tx new manage-sell-offer --source "$TREASURY" --selling "$a:$ISSUER_G" --buying native \
    --amount "$((SEED_RES / 2))" --price 1:100 "${net[@]}" >/dev/null
  echo "  $a: oferta de $((SEED_RES / 2 / STROOPS)) a 0,01 XLM"
done

say "La bóveda pasa a ser la única que acuña recursos"
for id in "$LMN" "$MTL" "$NRG"; do invoke "$id" "$ISSUER" set_admin --new_admin "$VAULT" >/dev/null; done

if [[ "${LOCK_ISSUER:-1}" == "1" ]]; then
  say "Bloqueando el emisor: STAR queda con suministro fijo"
  stellar tx new set-options --source "$ISSUER" --master-weight 0 "${net[@]}" >/dev/null
fi

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "network": "$NETWORK",
  "issuer": "$ISSUER_G",
  "treasury": "$TREASURY_G",
  "assets": { "STAR": "$STAR", "LMN": "$LMN", "MTL": "$MTL", "NRG": "$NRG" },
  "contracts": { "armory": "$ARMORY", "conquest": "$CONQUEST", "vault": "$VAULT" },
  "verifier": "$VERIFIER_HEX"
}
JSON
say "Listo → ${OUT#$ROOT/}"
