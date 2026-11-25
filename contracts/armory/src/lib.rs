//! Armory: ítems del juego (skins de naves, escuadrones, planos de módulos y facciones),
//! tienda oficial en STAR y mercado P2P con regalía. Todo en un contrato para que comprar en el
//! mercado sea una sola invocación (sin llamadas entre contratos propios).
//!
//! Optimizado para Stellar:
//! - Saldos semifungibles `(dueño, ítem) -> u32` en almacenamiento persistente; un saldo en cero
//!   se borra para no pagar renta por entradas vacías.
//! - Pagos con el SAC de STAR: la tienda quema la mitad con `burn` (oferta deflacionaria real del
//!   activo clásico) y manda la otra mitad al tesoro.
//! - La bóveda (`vault`) es el único contrato que puede consumir ítems al abrir una partida, y
//!   necesita además la firma del dueño: Soroban encadena ambas autorizaciones en una transacción.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

const DAY_LEDGERS: u32 = 17_280;
const TTL: u32 = DAY_LEDGERS * 60;

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Skin,
    Squadron,
    Blueprint,
    Faction,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub name: String,
    pub category: Category,
    /// 0 común, 1 rara, 2 épica, 3 legendaria
    pub rarity: u32,
    /// 0 = ilimitado
    pub max_supply: u32,
    pub minted: u32,
    /// precio en la tienda (unidades de STAR con 7 decimales); 0 = no se vende en tienda
    pub price: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub seller: Address,
    pub item: u32,
    pub amount: u32,
    pub price: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    pub treasury: Address,
    pub royalty_bps: u32,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    Vault,
    NextListing,
    Item(u32),
    Bal(Address, u32),
    Listing(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    UnknownItem = 1,
    NotForSale = 2,
    SoldOut = 3,
    Insufficient = 4,
    NoListing = 5,
    NotSeller = 6,
    ZeroAmount = 7,
    NoVault = 8,
    BadPrice = 9,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Bought {
    #[topic]
    pub buyer: Address,
    #[topic]
    pub item: u32,
    pub amount: u32,
    pub paid: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Listed {
    #[topic]
    pub listing: u64,
    pub seller: Address,
    pub item: u32,
    pub amount: u32,
    pub price: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Sold {
    #[topic]
    pub listing: u64,
    pub buyer: Address,
    pub amount: u32,
}

#[contract]
pub struct Armory;

fn cfg(env: &Env) -> Config {
    env.storage().instance().extend_ttl(TTL / 2, TTL);
    env.storage().instance().get(&Key::Config).unwrap()
}

fn item(env: &Env, id: u32) -> Result<Item, Error> {
    env.storage().persistent().get(&Key::Item(id)).ok_or(Error::UnknownItem)
}

fn bal(env: &Env, who: &Address, id: u32) -> u32 {
    env.storage().persistent().get(&Key::Bal(who.clone(), id)).unwrap_or(0)
}

fn set_bal(env: &Env, who: &Address, id: u32, v: u32) {
    let k = Key::Bal(who.clone(), id);
    if v == 0 {
        env.storage().persistent().remove(&k);
    } else {
        env.storage().persistent().set(&k, &v);
        env.storage().persistent().extend_ttl(&k, TTL / 2, TTL);
    }
}

fn take(env: &Env, who: &Address, id: u32, n: u32) -> Result<(), Error> {
    let b = bal(env, who, id);
    if n == 0 {
        return Err(Error::ZeroAmount);
    }
    if b < n {
        return Err(Error::Insufficient);
    }
    set_bal(env, who, id, b - n);
    Ok(())
}

fn give(env: &Env, who: &Address, id: u32, n: u32) {
    set_bal(env, who, id, bal(env, who, id) + n);
}

#[contractimpl]
impl Armory {
    pub fn __constructor(env: Env, config: Config) {
        env.storage().instance().set(&Key::Config, &config);
        env.storage().instance().set(&Key::NextListing, &1u64);
    }

    /// enlaza la bóveda de partidas (única que puede consumir ítems)
    pub fn set_vault(env: Env, vault: Address) {
        cfg(&env).admin.require_auth();
        env.storage().instance().set(&Key::Vault, &vault);
    }

    pub fn define_item(env: Env, id: u32, name: String, category: Category, rarity: u32, max_supply: u32, price: i128) -> Result<(), Error> {
        cfg(&env).admin.require_auth();
        if price < 0 {
            return Err(Error::BadPrice);
        }
        let minted = item(&env, id).map(|i| i.minted).unwrap_or(0);
        let k = Key::Item(id);
        env.storage().persistent().set(&k, &Item { name, category, rarity, max_supply, minted, price });
        env.storage().persistent().extend_ttl(&k, TTL / 2, TTL);
        Ok(())
    }

    /// acuñación directa para promociones y premios de torneo
    pub fn mint(env: Env, to: Address, id: u32, amount: u32) -> Result<(), Error> {
        cfg(&env).admin.require_auth();
        Self::issue(&env, &to, id, amount)
    }

    /// Tienda oficial: la mitad del pago se quema y la otra mitad va al tesoro.
    pub fn buy(env: Env, buyer: Address, id: u32, amount: u32) -> Result<i128, Error> {
        buyer.require_auth();
        let c = cfg(&env);
        let it = item(&env, id)?;
        if it.price == 0 {
            return Err(Error::NotForSale);
        }
        let total = it.price * amount as i128;
        let burn = total / 2;
        let t = token::TokenClient::new(&env, &c.token);
        t.burn(&buyer, &burn);
        t.transfer(&buyer, &c.treasury, &(total - burn));
        Self::issue(&env, &buyer, id, amount)?;
        Bought { buyer, item: id, amount, paid: total }.publish(&env);
        Ok(total)
    }

    pub fn transfer(env: Env, from: Address, to: Address, id: u32, amount: u32) -> Result<(), Error> {
        from.require_auth();
        take(&env, &from, id, amount)?;
        give(&env, &to, id, amount);
        Ok(())
    }

    /// La bóveda quema ítems de un jugador al abrir una partida (escuadrones, planos).
    pub fn consume(env: Env, owner: Address, id: u32, amount: u32) -> Result<(), Error> {
        let vault: Address = env.storage().instance().get(&Key::Vault).ok_or(Error::NoVault)?;
        vault.require_auth();
        owner.require_auth();
        take(&env, &owner, id, amount)
    }

    /// Pone ítems a la venta; quedan en custodia del contrato hasta venderse o cancelar.
    pub fn list(env: Env, seller: Address, id: u32, amount: u32, price: i128) -> Result<u64, Error> {
        seller.require_auth();
        if price <= 0 {
            return Err(Error::BadPrice);
        }
        take(&env, &seller, id, amount)?;
        let n: u64 = env.storage().instance().get(&Key::NextListing).unwrap();
        env.storage().instance().set(&Key::NextListing, &(n + 1));
        let k = Key::Listing(n);
        env.storage().persistent().set(&k, &Listing { seller: seller.clone(), item: id, amount, price });
        env.storage().persistent().extend_ttl(&k, TTL / 2, TTL);
        Listed { listing: n, seller, item: id, amount, price }.publish(&env);
        Ok(n)
    }

    /// Compra parcial o total de un anuncio. El vendedor cobra el precio menos la regalía.
    pub fn buy_listing(env: Env, buyer: Address, listing: u64, amount: u32) -> Result<i128, Error> {
        buyer.require_auth();
        let c = cfg(&env);
        let k = Key::Listing(listing);
        let mut l: Listing = env.storage().persistent().get(&k).ok_or(Error::NoListing)?;
        if amount == 0 {
            return Err(Error::ZeroAmount);
        }
        if amount > l.amount {
            return Err(Error::Insufficient);
        }
        let total = l.price * amount as i128;
        let royalty = total * c.royalty_bps as i128 / 10_000;
        let t = token::TokenClient::new(&env, &c.token);
        t.transfer(&buyer, &l.seller, &(total - royalty));
        if royalty > 0 {
            t.transfer(&buyer, &c.treasury, &royalty);
        }
        give(&env, &buyer, l.item, amount);
        l.amount -= amount;
        if l.amount == 0 {
            env.storage().persistent().remove(&k);
        } else {
            env.storage().persistent().set(&k, &l);
        }
        Sold { listing, buyer, amount }.publish(&env);
        Ok(total)
    }

    pub fn cancel(env: Env, seller: Address, listing: u64) -> Result<(), Error> {
        seller.require_auth();
        let k = Key::Listing(listing);
        let l: Listing = env.storage().persistent().get(&k).ok_or(Error::NoListing)?;
        if l.seller != seller {
            return Err(Error::NotSeller);
        }
        env.storage().persistent().remove(&k);
        give(&env, &seller, l.item, l.amount);
        Ok(())
    }

    pub fn balance(env: Env, owner: Address, id: u32) -> u32 {
        bal(&env, &owner, id)
    }

    pub fn item(env: Env, id: u32) -> Option<Item> {
        item(&env, id).ok()
    }

    pub fn listing(env: Env, listing: u64) -> Option<Listing> {
        env.storage().persistent().get(&Key::Listing(listing))
    }

    pub fn upgrade(env: Env, wasm_hash: soroban_sdk::BytesN<32>) {
        cfg(&env).admin.require_auth();
        env.deployer().update_current_contract_wasm(wasm_hash);
    }
}

impl Armory {
    fn issue(env: &Env, to: &Address, id: u32, amount: u32) -> Result<(), Error> {
        if amount == 0 {
            return Err(Error::ZeroAmount);
        }
        let mut it = item(env, id)?;
        if it.max_supply > 0 && it.minted + amount > it.max_supply {
            return Err(Error::SoldOut);
        }
        it.minted += amount;
        env.storage().persistent().set(&Key::Item(id), &it);
        give(env, to, id, amount);
        Ok(())
    }
}

#[cfg(test)]
mod test;
