//! Conquest: registro de partidas y fondo de recompensas en STAR.
//!
//! Modelo optimista: la partida se juega en el cliente (simulación determinista). Un verificador
//! re-simula `seed + comandos` y firma el resultado con ed25519. Cualquiera lo publica con `report`;
//! durante la ventana de disputa se puede impugnar y, pasada la ventana, `claim` paga al ganador.
//!
//! Optimizado para Stellar:
//! - El registro y el fondo de recompensas son un solo contrato: cero llamadas entre contratos al cobrar.
//! - STAR es un activo clásico de Stellar expuesto por su Stellar Asset Contract (SAC): el contrato
//!   solo hace `transfer`, sin lógica de token propia.
//! - Los contadores diarios viven en almacenamiento *temporal*: caducan solos y no pagan renta.
//! - La firma usa ed25519 nativo del host (`ed25519_verify`), la misma curva que las cuentas Stellar.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address,
    BytesN, Env,
};

const DAY: u64 = 86_400;
const DAY_LEDGERS: u32 = 17_280; // ~5 s por ledger
const MATCH_TTL: u32 = DAY_LEDGERS * 30;
const INSTANCE_TTL: u32 = DAY_LEDGERS * 30;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// SAC del activo STAR
    pub token: Address,
    /// clave pública ed25519 del verificador
    pub verifier: BytesN<32>,
    /// segundos de ventana de disputa
    pub window: u64,
    pub base_pvp: i128,
    pub base_ai: i128,
    /// presupuesto global del primer año por día; se divide a la mitad cada 365 días
    pub daily_budget: i128,
    /// tope por jugador y día
    pub player_cap: i128,
    /// parte del presupuesto diario que pueden cobrar las partidas contra la IA
    /// (las cuentas son gratis: sin este tope, cuentas falsas vaciarían el fondo jugando contra la IA)
    pub ai_daily_budget: i128,
    /// fianza en STAR para impugnar; se devuelve si la impugnación prospera y va al fondo si no
    pub dispute_bond: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MatchResult {
    pub match_id: BytesN<32>,
    pub winner: Address,
    /// `None` = partida contra la IA
    pub loser: Option<Address>,
    pub seed: u64,
    pub log_hash: BytesN<32>,
    pub state_hash: BytesN<32>,
    pub ledgers: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    Disputed,
    Rejected,
    Claimed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Match {
    pub result: MatchResult,
    pub ready_at: u64,
    pub status: Status,
    pub challenger: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Stats {
    pub wins: u32,
    pub losses: u32,
    pub earned: i128,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    Genesis,
    Match(BytesN<32>),
    Stats(Address),
    Spent(u64),
    SpentAi(u64),
    PlayerDay(Address, u64),
    Pair(Address, Address, u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyReported = 1,
    SelfMatch = 2,
    NotFound = 3,
    BadStatus = 4,
    WindowOpen = 5,
    WindowClosed = 6,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Reported {
    #[topic]
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub ready_at: u64,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Disputed {
    #[topic]
    pub match_id: BytesN<32>,
    pub challenger: Address,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Claimed {
    #[topic]
    pub match_id: BytesN<32>,
    #[topic]
    pub winner: Address,
    pub amount: i128,
}

#[contract]
pub struct Conquest;

fn cfg(env: &Env) -> Config {
    env.storage().instance().extend_ttl(INSTANCE_TTL / 2, INSTANCE_TTL);
    env.storage().instance().get(&Key::Config).unwrap()
}

fn load(env: &Env, id: &BytesN<32>) -> Result<Match, Error> {
    env.storage().persistent().get(&Key::Match(id.clone())).ok_or(Error::NotFound)
}

fn save(env: &Env, m: &Match) {
    let k = Key::Match(m.result.match_id.clone());
    env.storage().persistent().set(&k, m);
    env.storage().persistent().extend_ttl(&k, MATCH_TTL / 2, MATCH_TTL);
}

fn temp_set<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, k: &Key, v: &V) {
    env.storage().temporary().set(k, v);
    env.storage().temporary().extend_ttl(k, DAY_LEDGERS * 2, DAY_LEDGERS * 2);
}

/// rendimientos decrecientes por número de recompensa del día: 1–3 100 %, 4–6 50 %, 7–10 25 %, luego 0
pub fn factor_bps(n: u32) -> i128 {
    match n {
        0..=2 => 10_000,
        3..=5 => 5_000,
        6..=9 => 2_500,
        _ => 0,
    }
}

fn budget_for(env: &Env, c: &Config, day: u64) -> i128 {
    let genesis: u64 = env.storage().instance().get(&Key::Genesis).unwrap_or(day);
    let year = day.saturating_sub(genesis) / 365;
    if year >= 100 { 0 } else { c.daily_budget >> year }
}

/// cuánto cobraría `player` hoy con una recompensa base `base`, y su contador del día
fn quote_inner(env: &Env, c: &Config, player: &Address, base: i128, vs_ai: bool) -> (i128, u32, i128, u64) {
    let day = env.ledger().timestamp() / DAY;
    let (count, paid): (u32, i128) =
        env.storage().temporary().get(&Key::PlayerDay(player.clone(), day)).unwrap_or((0, 0));
    let spent: i128 = env.storage().temporary().get(&Key::Spent(day)).unwrap_or(0);
    let mut amt = base * factor_bps(count) / 10_000;
    amt = amt.min(c.player_cap - paid).min(budget_for(env, c, day) - spent);
    if vs_ai {
        let spent_ai: i128 = env.storage().temporary().get(&Key::SpentAi(day)).unwrap_or(0);
        amt = amt.min(c.ai_daily_budget - spent_ai);
    }
    let bal = token::TokenClient::new(env, &c.token).balance(&env.current_contract_address());
    (amt.min(bal).max(0), count, paid, day)
}

#[contractimpl]
impl Conquest {
    pub fn __constructor(env: Env, config: Config) {
        env.storage().instance().set(&Key::Config, &config);
        env.storage().instance().set(&Key::Genesis, &(env.ledger().timestamp() / DAY));
    }

    /// Publica un resultado firmado por el verificador. Lo puede llamar cualquiera (relayer).
    pub fn report(env: Env, result: MatchResult, signature: BytesN<64>) -> Result<u64, Error> {
        let c = cfg(&env);
        if Some(&result.winner) == result.loser.as_ref() {
            return Err(Error::SelfMatch);
        }
        if env.storage().persistent().has(&Key::Match(result.match_id.clone())) {
            return Err(Error::AlreadyReported);
        }
        // la firma cubre la dirección de este contrato: no se puede reutilizar en otro despliegue
        let payload = (env.current_contract_address(), result.clone()).to_xdr(&env);
        env.crypto().ed25519_verify(&c.verifier, &payload, &signature);

        let ready_at = env.ledger().timestamp() + c.window;
        Reported { match_id: result.match_id.clone(), winner: result.winner.clone(), ready_at }.publish(&env);
        save(&env, &Match { result, ready_at, status: Status::Pending, challenger: None });
        Ok(ready_at)
    }

    /// Impugna un resultado dentro de la ventana depositando la fianza. El árbitro re-simula y llama
    /// `resolve`. La fianza evita que alguien congele todas las recompensas impugnando gratis.
    pub fn dispute(env: Env, challenger: Address, match_id: BytesN<32>) -> Result<(), Error> {
        challenger.require_auth();
        let c = cfg(&env);
        let mut m = load(&env, &match_id)?;
        if m.status != Status::Pending {
            return Err(Error::BadStatus);
        }
        if env.ledger().timestamp() >= m.ready_at {
            return Err(Error::WindowClosed);
        }
        if c.dispute_bond > 0 {
            token::TokenClient::new(&env, &c.token).transfer(&challenger, &env.current_contract_address(), &c.dispute_bond);
        }
        m.status = Status::Disputed;
        m.challenger = Some(challenger.clone());
        save(&env, &m);
        Disputed { match_id, challenger }.publish(&env);
        Ok(())
    }

    /// `valid = true`: el resultado era correcto, la fianza se queda en el fondo de recompensas.
    /// `valid = false`: la impugnación prospera, se rechaza el resultado y se devuelve la fianza.
    pub fn resolve(env: Env, match_id: BytesN<32>, valid: bool) -> Result<(), Error> {
        let c = cfg(&env);
        c.admin.require_auth();
        let mut m = load(&env, &match_id)?;
        if m.status != Status::Disputed {
            return Err(Error::BadStatus);
        }
        if valid {
            m.status = Status::Pending;
            m.ready_at = env.ledger().timestamp();
        } else {
            m.status = Status::Rejected;
            if let (Some(ch), true) = (&m.challenger, c.dispute_bond > 0) {
                token::TokenClient::new(&env, &c.token).transfer(&env.current_contract_address(), ch, &c.dispute_bond);
            }
        }
        save(&env, &m);
        Ok(())
    }

    /// Pasada la ventana, registra victoria/derrota y paga al ganador desde el fondo.
    pub fn claim(env: Env, match_id: BytesN<32>) -> Result<i128, Error> {
        let c = cfg(&env);
        let mut m = load(&env, &match_id)?;
        if m.status != Status::Pending {
            return Err(Error::BadStatus);
        }
        if env.ledger().timestamp() < m.ready_at {
            return Err(Error::WindowOpen);
        }
        let r = &m.result;
        let mut base = if r.loser.is_some() { c.base_pvp } else { c.base_ai };

        // en 1 contra 1, una sola recompensa al día por pareja de rivales (evita granjear con una cuenta propia)
        if let Some(loser) = &r.loser {
            let day = env.ledger().timestamp() / DAY;
            let (a, b) = if r.winner < *loser { (r.winner.clone(), loser.clone()) } else { (loser.clone(), r.winner.clone()) };
            let pk = Key::Pair(a, b, day);
            if env.storage().temporary().has(&pk) {
                base = 0;
            } else {
                temp_set(&env, &pk, &true);
            }
            let lk = Key::Stats(loser.clone());
            let mut ls: Stats = env.storage().persistent().get(&lk).unwrap_or_default();
            ls.losses += 1;
            env.storage().persistent().set(&lk, &ls);
            env.storage().persistent().extend_ttl(&lk, MATCH_TTL / 2, MATCH_TTL);
        }

        let vs_ai = r.loser.is_none();
        let (amount, count, paid, day) = quote_inner(&env, &c, &r.winner, base, vs_ai);
        temp_set(&env, &Key::PlayerDay(r.winner.clone(), day), &(count + 1, paid + amount));
        if amount > 0 {
            let spent: i128 = env.storage().temporary().get(&Key::Spent(day)).unwrap_or(0);
            temp_set(&env, &Key::Spent(day), &(spent + amount));
            if vs_ai {
                let spent_ai: i128 = env.storage().temporary().get(&Key::SpentAi(day)).unwrap_or(0);
                temp_set(&env, &Key::SpentAi(day), &(spent_ai + amount));
            }
            token::TokenClient::new(&env, &c.token).transfer(&env.current_contract_address(), &r.winner, &amount);
        }

        let wk = Key::Stats(r.winner.clone());
        let mut ws: Stats = env.storage().persistent().get(&wk).unwrap_or_default();
        ws.wins += 1;
        ws.earned += amount;
        env.storage().persistent().set(&wk, &ws);
        env.storage().persistent().extend_ttl(&wk, MATCH_TTL / 2, MATCH_TTL);

        Claimed { match_id, winner: r.winner.clone(), amount }.publish(&env);
        m.status = Status::Claimed;
        save(&env, &m);
        Ok(amount)
    }

    pub fn quote(env: Env, player: Address, vs_ai: bool) -> i128 {
        let c = cfg(&env);
        let base = if vs_ai { c.base_ai } else { c.base_pvp };
        quote_inner(&env, &c, &player, base, vs_ai).0
    }

    pub fn daily_budget(env: Env) -> i128 {
        let c = cfg(&env);
        budget_for(&env, &c, env.ledger().timestamp() / DAY)
    }

    pub fn get_match(env: Env, match_id: BytesN<32>) -> Option<Match> {
        env.storage().persistent().get(&Key::Match(match_id))
    }

    pub fn stats(env: Env, player: Address) -> Stats {
        env.storage().persistent().get(&Key::Stats(player)).unwrap_or_default()
    }

    pub fn config(env: Env) -> Config {
        cfg(&env)
    }

    /// rota la clave del verificador (p. ej. si se compromete)
    pub fn set_verifier(env: Env, verifier: BytesN<32>) {
        let mut c = cfg(&env);
        c.admin.require_auth();
        c.verifier = verifier;
        env.storage().instance().set(&Key::Config, &c);
    }

    pub fn set_admin(env: Env, admin: Address) {
        let mut c = cfg(&env);
        c.admin.require_auth();
        c.admin = admin;
        env.storage().instance().set(&Key::Config, &c);
    }

    /// actualiza el WASM sin cambiar la dirección del contrato
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        cfg(&env).admin.require_auth();
        env.deployer().update_current_contract_wasm(wasm_hash);
    }
}

#[cfg(test)]
mod test;
