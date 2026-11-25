extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

const STAR: i128 = 10_000_000;

struct T {
    env: Env,
    id: Address,
    star: Address,
    key: SigningKey,
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000 * DAY);
    let issuer = Address::generate(&env);
    let star = env.register_stellar_asset_contract_v2(issuer).address();
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let cfg = Config {
        admin: Address::generate(&env),
        token: star.clone(),
        verifier: BytesN::from_array(&env, &key.verifying_key().to_bytes()),
        window: 600,
        base_pvp: 50 * STAR,
        base_ai: 10 * STAR,
        daily_budget: 54_794 * STAR,
        player_cap: 200 * STAR,
    };
    let id = env.register(Conquest, (cfg,));
    StellarAssetClient::new(&env, &star).mint(&id, &(1_000_000 * STAR));
    T { env, id, star, key }
}

fn result(t: &T, n: u8, winner: &Address, loser: Option<Address>) -> MatchResult {
    MatchResult {
        match_id: BytesN::from_array(&t.env, &[n; 32]),
        winner: winner.clone(),
        loser,
        seed: n as u64,
        log_hash: BytesN::from_array(&t.env, &[1; 32]),
        state_hash: BytesN::from_array(&t.env, &[2; 32]),
        ledgers: 200,
    }
}

fn sign(t: &T, r: &MatchResult) -> BytesN<64> {
    let payload = (t.id.clone(), r.clone()).to_xdr(&t.env);
    let bytes: std::vec::Vec<u8> = payload.iter().collect();
    BytesN::from_array(&t.env, &t.key.sign(&bytes).to_bytes())
}

fn advance(t: &T, secs: u64) {
    t.env.ledger().with_mut(|l| l.timestamp += secs);
}

#[test]
fn report_and_claim_pays_winner() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let (a, b) = (Address::generate(&t.env), Address::generate(&t.env));
    let r = result(&t, 1, &a, Some(b.clone()));
    c.report(&r, &sign(&t, &r));
    assert_eq!(c.try_claim(&r.match_id), Err(Ok(Error::WindowOpen)));
    advance(&t, 600);
    assert_eq!(c.claim(&r.match_id), 50 * STAR);
    assert_eq!(TokenClient::new(&t.env, &t.star).balance(&a), 50 * STAR);
    assert_eq!(c.stats(&a).wins, 1);
    assert_eq!(c.stats(&b).losses, 1);
    assert_eq!(c.try_claim(&r.match_id), Err(Ok(Error::BadStatus)));
}

#[test]
#[should_panic]
fn rejects_bad_signature() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let a = Address::generate(&t.env);
    let r = result(&t, 1, &a, None);
    let mut forged = r.clone();
    forged.winner = Address::generate(&t.env);
    c.report(&forged, &sign(&t, &r));
}

#[test]
fn rejects_duplicates_and_self_match() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let a = Address::generate(&t.env);
    let r = result(&t, 1, &a, None);
    c.report(&r, &sign(&t, &r));
    assert_eq!(c.try_report(&r, &sign(&t, &r)), Err(Ok(Error::AlreadyReported)));
    let s = result(&t, 2, &a, Some(a.clone()));
    assert_eq!(c.try_report(&s, &sign(&t, &s)), Err(Ok(Error::SelfMatch)));
}

#[test]
fn dispute_blocks_until_resolved() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let a = Address::generate(&t.env);
    let r = result(&t, 1, &a, None);
    c.report(&r, &sign(&t, &r));
    c.dispute(&Address::generate(&t.env), &r.match_id);
    advance(&t, 600);
    assert_eq!(c.try_claim(&r.match_id), Err(Ok(Error::BadStatus)));
    c.resolve(&r.match_id, &false);
    assert_eq!(c.get_match(&r.match_id).unwrap().status, Status::Rejected);
    assert_eq!(c.stats(&a).wins, 0);
}

#[test]
fn diminishing_returns_and_player_cap() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let a = Address::generate(&t.env);
    let mut paid = std::vec::Vec::new();
    for n in 0..12u8 {
        // contra la IA: 10 STAR base
        let r = result(&t, n + 10, &a, None);
        c.report(&r, &sign(&t, &r));
        advance(&t, 600);
        paid.push(c.claim(&r.match_id) / STAR);
    }
    assert_eq!(paid[..12], [10, 10, 10, 5, 5, 5, 2, 2, 2, 2, 0, 0]);
}

#[test]
fn pair_rewarded_once_per_day() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    let (a, b) = (Address::generate(&t.env), Address::generate(&t.env));
    let r1 = result(&t, 1, &a, Some(b.clone()));
    let r2 = result(&t, 2, &b, Some(a.clone()));
    c.report(&r1, &sign(&t, &r1));
    c.report(&r2, &sign(&t, &r2));
    advance(&t, 600);
    assert_eq!(c.claim(&r1.match_id), 50 * STAR);
    assert_eq!(c.claim(&r2.match_id), 0);
    assert_eq!(c.stats(&b).wins, 1);
}

#[test]
fn budget_halves_each_year() {
    let t = setup();
    let c = ConquestClient::new(&t.env, &t.id);
    assert_eq!(c.daily_budget(), 54_794 * STAR);
    advance(&t, 365 * DAY);
    assert_eq!(c.daily_budget(), 27_397 * STAR);
}
