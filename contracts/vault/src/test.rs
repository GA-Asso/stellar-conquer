extern crate std;

use super::*;
use armory::{Armory, ArmoryClient as Items, Category, Config as ArmoryConfig};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, String,
};

const U: i128 = 10_000_000;

struct T {
    env: Env,
    vault: VaultClient<'static>,
    items: Items<'static>,
    assets: std::vec::Vec<Address>,
    key: SigningKey,
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let star = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let assets: std::vec::Vec<Address> =
        (0..3).map(|_| env.register_stellar_asset_contract_v2(issuer.clone()).address()).collect();
    let admin = Address::generate(&env);
    let armory = env.register(Armory, (ArmoryConfig { admin: admin.clone(), token: star, treasury: admin.clone(), royalty_bps: 500 },));
    let key = SigningKey::from_bytes(&[9u8; 32]);
    let cfg = Config {
        admin,
        armory: armory.clone(),
        verifier: BytesN::from_array(&env, &key.verifying_key().to_bytes()),
        assets: Vec::from_slice(&env, &assets),
        leftover_cap: 500 * U,
        daily_mint_cap: 50_000 * U,
        max_settles: 5,
    };
    let vault_id = env.register(Vault, (cfg,));
    // la bóveda administra los SAC de recursos para poder acuñar al liquidar
    for a in &assets {
        StellarAssetClient::new(&env, a).set_admin(&vault_id);
    }
    let items = Items::new(&env, &armory);
    items.set_vault(&vault_id);
    items.define_item(&101, &String::from_str(&env, "Escuadra de interceptores"), &Category::Squadron, &0, &0, &0);
    T { vault: VaultClient::new(&env, &vault_id), items, assets, key, env }
}

fn sign(t: &T, s: &Settlement) -> BytesN<64> {
    let payload = (t.vault.address.clone(), s.clone()).to_xdr(&t.env);
    let bytes: std::vec::Vec<u8> = payload.iter().collect();
    BytesN::from_array(&t.env, &t.key.sign(&bytes).to_bytes())
}

fn settlement(t: &T, session: &BytesN<32>, player: &Address, sold: [i128; 3], left: [i128; 3]) -> Settlement {
    Settlement {
        session: session.clone(),
        player: player.clone(),
        sold: Vec::from_array(&t.env, sold),
        leftover: Vec::from_array(&t.env, left),
    }
}

#[test]
fn open_consumes_items() {
    let t = setup();
    let p = Address::generate(&t.env);
    t.items.mint(&p, &101, &2);
    let id = t.vault.open(&p, &42, &vec![&t.env, 101], &vec![&t.env, 1]);
    assert_eq!(t.items.balance(&p, &101), 1);
    assert_eq!(t.vault.session_id(&p, &42), id);
    assert_eq!(t.vault.try_open(&p, &42, &vec![&t.env], &vec![&t.env]), Err(Ok(Error::SessionExists)));
}

#[test]
fn deposit_burns_and_settle_mints() {
    let t = setup();
    let p = Address::generate(&t.env);
    let lmn = TokenClient::new(&t.env, &t.assets[0]);
    StellarAssetClient::new(&t.env, &t.assets[0]).mint(&p, &(100 * U));
    let id = t.vault.open(&p, &1, &vec![&t.env], &vec![&t.env]);
    t.vault.deposit(&p, &id, &0, &(60 * U));
    assert_eq!(lmn.balance(&p), 40 * U);

    t.vault.sell(&p, &id, &1, &(30 * U));
    // sobrante de 900 Lumen: se recorta al tope de 500
    let s = settlement(&t, &id, &p, [0, 30 * U, 0], [900 * U, 0, 5 * U]);
    let minted = t.vault.settle(&s, &sign(&t, &s));
    assert_eq!(minted, Vec::from_array(&t.env, [500 * U, 30 * U, 5 * U]));
    assert_eq!(lmn.balance(&p), 540 * U);
    assert_eq!(TokenClient::new(&t.env, &t.assets[1]).balance(&p), 30 * U);
    assert_eq!(t.vault.try_settle(&s, &sign(&t, &s)), Err(Ok(Error::AlreadySettled)));
}

#[test]
fn sold_must_match_registry() {
    let t = setup();
    let p = Address::generate(&t.env);
    let id = t.vault.open(&p, &1, &vec![&t.env], &vec![&t.env]);
    t.vault.sell(&p, &id, &2, &(10 * U));
    let s = settlement(&t, &id, &p, [0, 0, 99 * U], [0, 0, 0]);
    assert_eq!(t.vault.try_settle(&s, &sign(&t, &s)), Err(Ok(Error::SoldMismatch)));
}

#[test]
#[should_panic]
fn rejects_forged_settlement() {
    let t = setup();
    let p = Address::generate(&t.env);
    let id = t.vault.open(&p, &1, &vec![&t.env], &vec![&t.env]);
    let s = settlement(&t, &id, &p, [0, 0, 0], [10 * U, 0, 0]);
    let mut forged = s.clone();
    forged.leftover = Vec::from_array(&t.env, [500 * U, 500 * U, 500 * U]);
    t.vault.settle(&forged, &sign(&t, &s));
}

#[test]
fn settles_per_day_capped() {
    let t = setup();
    let p = Address::generate(&t.env);
    for seed in 0..6u64 {
        let id = t.vault.open(&p, &seed, &vec![&t.env], &vec![&t.env]);
        let s = settlement(&t, &id, &p, [0, 0, 0], [U, 0, 0]);
        let r = t.vault.try_settle(&s, &sign(&t, &s));
        if seed < 5 { assert!(r.is_ok()) } else { assert_eq!(r, Err(Ok(Error::TooManySettles))) }
    }
}
