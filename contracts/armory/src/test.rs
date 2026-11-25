extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, String,
};

const STAR: i128 = 10_000_000;

fn setup() -> (Env, ArmoryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let star = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let treasury = Address::generate(&env);
    let cfg = Config { admin: Address::generate(&env), token: star.clone(), treasury: treasury.clone(), royalty_bps: 500 };
    let id = env.register(Armory, (cfg,));
    let c = ArmoryClient::new(&env, &id);
    c.define_item(&1, &String::from_str(&env, "Casco Aurora"), &Category::Skin, &0, &0, &(100 * STAR));
    c.define_item(&2, &String::from_str(&env, "Escuadra Nova"), &Category::Squadron, &2, &3, &(40 * STAR));
    (env, c, star, treasury)
}

fn funded(env: &Env, star: &Address) -> Address {
    let a = Address::generate(env);
    StellarAssetClient::new(env, star).mint(&a, &(1_000 * STAR));
    a
}

#[test]
fn shop_burns_half_and_pays_treasury() {
    let (env, c, star, treasury) = setup();
    let a = funded(&env, &star);
    let t = TokenClient::new(&env, &star);
    let supply_before = 1_000 * STAR;
    c.buy(&a, &1, &2);
    assert_eq!(c.balance(&a, &1), 2);
    assert_eq!(t.balance(&a), supply_before - 200 * STAR);
    assert_eq!(t.balance(&treasury), 100 * STAR);
}

#[test]
fn max_supply_enforced() {
    let (env, c, star, _) = setup();
    let a = funded(&env, &star);
    c.buy(&a, &2, &3);
    assert_eq!(c.try_buy(&a, &2, &1), Err(Ok(Error::SoldOut)));
}

#[test]
fn market_partial_buy_with_royalty_and_cancel() {
    let (env, c, star, treasury) = setup();
    let (s, b) = (funded(&env, &star), funded(&env, &star));
    let t = TokenClient::new(&env, &star);
    c.buy(&s, &1, &3);
    let id = c.list(&s, &1, &3, &(20 * STAR));
    assert_eq!(c.balance(&s, &1), 0);
    c.buy_listing(&b, &id, &2);
    assert_eq!(c.balance(&b, &1), 2);
    // 40 STAR: 5 % de regalía al tesoro
    assert_eq!(t.balance(&b), 960 * STAR);
    assert_eq!(t.balance(&treasury), 150 * STAR + 2 * STAR);
    assert_eq!(c.listing(&id).unwrap().amount, 1);
    assert_eq!(c.try_cancel(&b, &id), Err(Ok(Error::NotSeller)));
    c.cancel(&s, &id);
    assert_eq!(c.balance(&s, &1), 1);
    assert!(c.listing(&id).is_none());
}

#[test]
fn consume_needs_vault() {
    let (env, c, star, _) = setup();
    let a = funded(&env, &star);
    c.buy(&a, &2, &1);
    assert_eq!(c.try_consume(&a, &2, &1), Err(Ok(Error::NoVault)));
    c.set_vault(&Address::generate(&env));
    c.consume(&a, &2, &1);
    assert_eq!(c.balance(&a, &2), 0);
    assert_eq!(c.try_transfer(&a, &Address::generate(&env), &2, &1), Err(Ok(Error::Insufficient)));
}
