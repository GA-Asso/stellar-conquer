//! Vault: puente entre la partida y la economía.
//!
//! Los recursos del juego (Lumen dorado, metal y energía) son **activos clásicos de Stellar**
//! (`LMN`, `MTL`, `NRG`) con este contrato como administrador de su SAC. Eso significa que:
//! - se intercambian en el DEX y los pools AMM nativos de Stellar, sin escribir un AMM propio;
//! - se ven en cualquier wallet (Freighter, Lobstr…) y admiten path payments a XLM, USDC o STAR.
//!
//! Flujo:
//! 1. `open`: abre una sesión; quema hasta 3 ítems de la armería (escuadrones, planos).
//! 2. `deposit`: el jugador quema recursos que compró en el DEX y entran a su partida al instante.
//! 3. `sell`: registra recursos que el jugador vende desde la partida (se pagan al liquidar).
//! 4. `settle`: con la firma ed25519 del verificador, acuña lo vendido más el sobrante (con tope).
//!
//! Protecciones: lo vendido debe coincidir con lo registrado, tope de sobrante por recurso, máximo
//! de liquidaciones por jugador al día y tope global diario de acuñación por recurso (contadores en
//! almacenamiento temporal, que caduca solo).
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token, vec,
    xdr::ToXdr, Address, BytesN, Env, Vec,
};

const DAY: u64 = 86_400;
const DAY_LEDGERS: u32 = 17_280;
const TTL: u32 = DAY_LEDGERS * 30;
const RESOURCES: u32 = 3;
const MAX_ITEMS: u32 = 3;

#[contractclient(name = "ArmoryClient")]
pub trait ArmoryApi {
    fn consume(env: Env, owner: Address, id: u32, amount: u32);
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub armory: Address,
    pub verifier: BytesN<32>,
    /// SAC de LMN, MTL y NRG, en ese orden
    pub assets: Vec<Address>,
    pub leftover_cap: i128,
    pub daily_mint_cap: i128,
    pub max_settles: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub player: Address,
    pub seed: u64,
    pub deposited: Vec<i128>,
    pub sold: Vec<i128>,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Settlement {
    pub session: BytesN<32>,
    pub player: Address,
    pub sold: Vec<i128>,
    pub leftover: Vec<i128>,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    Session(BytesN<32>),
    Settles(Address, u64),
    Minted(u32, u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    SessionExists = 1,
    NoSession = 2,
    NotOwner = 3,
    AlreadySettled = 4,
    BadResource = 5,
    BadAmount = 6,
    TooManyItems = 7,
    SoldMismatch = 8,
    TooManySettles = 9,
    DailyMintCap = 10,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Opened {
    #[topic]
    pub session: BytesN<32>,
    #[topic]
    pub player: Address,
    pub seed: u64,
}

/// el cliente del juego escucha este evento para sumar los recursos a la partida
#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Deposited {
    #[topic]
    pub session: BytesN<32>,
    pub resource: u32,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Settled {
    #[topic]
    pub session: BytesN<32>,
    #[topic]
    pub player: Address,
    pub minted: Vec<i128>,
}

#[contract]
pub struct Vault;

fn cfg(env: &Env) -> Config {
    env.storage().instance().extend_ttl(TTL / 2, TTL);
    env.storage().instance().get(&Key::Config).unwrap()
}

fn session(env: &Env, id: &BytesN<32>) -> Result<Session, Error> {
    env.storage().persistent().get(&Key::Session(id.clone())).ok_or(Error::NoSession)
}

fn save(env: &Env, id: &BytesN<32>, s: &Session) {
    let k = Key::Session(id.clone());
    env.storage().persistent().set(&k, s);
    env.storage().persistent().extend_ttl(&k, TTL / 2, TTL);
}

fn temp_set<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, k: &Key, v: &V) {
    env.storage().temporary().set(k, v);
    env.storage().temporary().extend_ttl(k, DAY_LEDGERS * 2, DAY_LEDGERS * 2);
}

fn zeros(env: &Env) -> Vec<i128> {
    vec![env, 0, 0, 0]
}

fn owned(env: &Env, id: &BytesN<32>, player: &Address) -> Result<Session, Error> {
    let s = session(env, id)?;
    if &s.player != player {
        return Err(Error::NotOwner);
    }
    if s.settled {
        return Err(Error::AlreadySettled);
    }
    Ok(s)
}

#[contractimpl]
impl Vault {
    pub fn __constructor(env: Env, config: Config) {
        env.storage().instance().set(&Key::Config, &config);
    }

    pub fn session_id(env: Env, player: Address, seed: u64) -> BytesN<32> {
        env.crypto().sha256(&(player, seed).to_xdr(&env)).to_bytes()
    }

    pub fn open(env: Env, player: Address, seed: u64, ids: Vec<u32>, amounts: Vec<u32>) -> Result<BytesN<32>, Error> {
        player.require_auth();
        let c = cfg(&env);
        if ids.len() > MAX_ITEMS || ids.len() != amounts.len() {
            return Err(Error::TooManyItems);
        }
        let id = Self::session_id(env.clone(), player.clone(), seed);
        if env.storage().persistent().has(&Key::Session(id.clone())) {
            return Err(Error::SessionExists);
        }
        let armory = ArmoryClient::new(&env, &c.armory);
        for (item, n) in ids.iter().zip(amounts.iter()) {
            armory.consume(&player, &item, &n);
        }
        save(&env, &id, &Session { player: player.clone(), seed, deposited: zeros(&env), sold: zeros(&env), settled: false });
        Opened { session: id.clone(), player, seed }.publish(&env);
        Ok(id)
    }

    /// Quema recursos que el jugador tiene en su wallet (p. ej. comprados en el DEX) y los mete a la partida.
    pub fn deposit(env: Env, player: Address, session: BytesN<32>, resource: u32, amount: i128) -> Result<(), Error> {
        player.require_auth();
        let c = cfg(&env);
        let mut s = owned(&env, &session, &player)?;
        if resource >= RESOURCES {
            return Err(Error::BadResource);
        }
        if amount <= 0 {
            return Err(Error::BadAmount);
        }
        token::TokenClient::new(&env, &c.assets.get_unchecked(resource)).burn(&player, &amount);
        s.deposited.set(resource, s.deposited.get_unchecked(resource) + amount);
        save(&env, &session, &s);
        Deposited { session, resource, amount }.publish(&env);
        Ok(())
    }

    /// Registra una venta hecha desde la partida; se paga al liquidar si el verificador la confirma.
    pub fn sell(env: Env, player: Address, session: BytesN<32>, resource: u32, amount: i128) -> Result<(), Error> {
        player.require_auth();
        let mut s = owned(&env, &session, &player)?;
        if resource >= RESOURCES {
            return Err(Error::BadResource);
        }
        if amount <= 0 {
            return Err(Error::BadAmount);
        }
        s.sold.set(resource, s.sold.get_unchecked(resource) + amount);
        save(&env, &session, &s);
        Ok(())
    }

    /// Liquida la sesión con la firma del verificador. La puede enviar cualquiera (relayer).
    pub fn settle(env: Env, settlement: Settlement, signature: BytesN<64>) -> Result<Vec<i128>, Error> {
        let c = cfg(&env);
        let payload = (env.current_contract_address(), settlement.clone()).to_xdr(&env);
        env.crypto().ed25519_verify(&c.verifier, &payload, &signature);

        let mut s = owned(&env, &settlement.session, &settlement.player)?;
        if settlement.sold.len() != RESOURCES || settlement.leftover.len() != RESOURCES {
            return Err(Error::BadResource);
        }
        if settlement.sold != s.sold {
            return Err(Error::SoldMismatch);
        }

        let day = env.ledger().timestamp() / DAY;
        let sk = Key::Settles(settlement.player.clone(), day);
        let n: u32 = env.storage().temporary().get(&sk).unwrap_or(0);
        if n >= c.max_settles {
            return Err(Error::TooManySettles);
        }
        temp_set(&env, &sk, &(n + 1));

        let mut minted = zeros(&env);
        for r in 0..RESOURCES {
            let left = settlement.leftover.get_unchecked(r);
            if left < 0 {
                return Err(Error::BadAmount);
            }
            let amt = s.sold.get_unchecked(r) + left.min(c.leftover_cap);
            if amt == 0 {
                continue;
            }
            let mk = Key::Minted(r, day);
            let today: i128 = env.storage().temporary().get(&mk).unwrap_or(0);
            if today + amt > c.daily_mint_cap {
                return Err(Error::DailyMintCap);
            }
            temp_set(&env, &mk, &(today + amt));
            token::StellarAssetClient::new(&env, &c.assets.get_unchecked(r)).mint(&settlement.player, &amt);
            minted.set(r, amt);
        }

        s.settled = true;
        save(&env, &settlement.session, &s);
        Settled { session: settlement.session, player: settlement.player, minted: minted.clone() }.publish(&env);
        Ok(minted)
    }

    pub fn get_session(env: Env, session: BytesN<32>) -> Option<Session> {
        env.storage().persistent().get(&Key::Session(session))
    }

    pub fn config(env: Env) -> Config {
        cfg(&env)
    }

    pub fn set_verifier(env: Env, verifier: BytesN<32>) {
        let mut c = cfg(&env);
        c.admin.require_auth();
        c.verifier = verifier;
        env.storage().instance().set(&Key::Config, &c);
    }

    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        cfg(&env).admin.require_auth();
        env.deployer().update_current_contract_wasm(wasm_hash);
    }
}

#[cfg(test)]
mod test;
