//! LOCA Score v1: deterministic, explainable, computed only from onchain history.
//! Weights are prototype rules, not a validated credit model.

use crate::types::Agent;
use near_sdk::{near, AccountId};

pub const SCORE_VERSION: &str = "v1";
const FULL: u128 = 10_000;
/// Completed-order volume (USDC, 6 decimals) at which the volume part of revenue continuity is full.
const FULL_VOLUME: u128 = 1_000_000_000;
/// An agent needs this much completed volume, as well as orders from two customers, to be rated.
pub const RATED_MIN_VOLUME: u128 = 50_000_000;
/// A default weighs this many times a repaid loan in repayment history.
const DEFAULT_PENALTY: u128 = 10;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreComponent {
    pub name: String,
    pub weight_bps: u32,
    /// 0..=10000
    pub value_bps: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreReport {
    pub agent_id: AccountId,
    pub version: String,
    /// 0..=1000. Provisional when `rated` is false.
    pub score: u32,
    pub rated: bool,
    pub components: Vec<ScoreComponent>,
    pub reason_codes: Vec<String>,
}

fn ratio(num: u128, den: u128) -> u128 {
    if den == 0 {
        0
    } else {
        (num * FULL / den).min(FULL)
    }
}

pub fn compute(agent: &Agent) -> ScoreReport {
    let s = &agent.stats;
    let completed = s.orders_completed as u128;
    let unique = s.unique_customers as u128;
    let mut codes: Vec<String> = Vec::new();

    // Count, customers and dollar volume each carry a third, so a pile of $1 orders builds little.
    let volume = s.revenue.0;
    let revenue = (ratio(completed.min(10), 10) + ratio(unique.min(5), 5) + ratio(volume.min(FULL_VOLUME), FULL_VOLUME)) / 3;

    let closed = (s.loans_repaid + s.loans_repaid_with_bond + s.loans_defaulted) as u128;
    let defaulted = s.loans_defaulted as u128;
    let repayment = if closed == 0 {
        codes.push("NO_CREDIT_HISTORY".into());
        FULL / 2
    } else {
        // Each point of default rate costs ten points here: a 2% default rate leaves 80%, 10% leaves nothing.
        let clean = (s.loans_repaid as u128 * FULL + s.loans_repaid_with_bond as u128 * 3_000) / closed;
        clean.saturating_sub(defaulted * FULL * (DEFAULT_PENALTY - 1) / closed)
    };
    if s.loans_defaulted > 0 {
        codes.push("DEFAULT_ON_RECORD".into());
    }
    if closed > 0 && defaulted * 20 > closed {
        codes.push("HIGH_DEFAULT_RATE".into());
    }
    if s.loans_repaid_with_bond > 0 {
        codes.push("BOND_DRAWN".into());
    }

    let resolved = (s.orders_completed + s.orders_refunded + s.disputes_lost) as u128;
    let fulfillment = if resolved == 0 { FULL / 2 } else { ratio(completed, resolved) };
    if s.disputes_lost > 0 {
        codes.push("DISPUTES_LOST".into());
    }

    let treasury = ratio(agent.bond.0, agent.policy.max_principal.0);
    if agent.bond.0 == 0 {
        codes.push("NO_BOND".into());
    }

    let has_policy = !agent.policy.allowed_vendors.is_empty() && agent.policy.max_principal.0 > 0;
    let controls = if has_policy { FULL } else { 0 };
    if !has_policy {
        codes.push("NO_SPEND_POLICY".into());
    }

    let concentration = if completed == 0 { FULL / 2 } else { ratio(unique, completed) };
    if completed > 0 && unique * 2 < completed {
        codes.push("CUSTOMER_CONCENTRATION".into());
    }

    let rated = s.orders_completed >= 3 && s.unique_customers >= 2 && volume >= RATED_MIN_VOLUME;
    if !rated {
        codes.push("UNRATED_INSUFFICIENT_HISTORY".into());
    }

    let parts = [
        ("revenue_continuity", 3_000u32, revenue),
        ("repayment_history", 2_500, repayment),
        ("fulfillment", 2_000, fulfillment),
        ("treasury_bond", 1_000, treasury),
        ("operator_controls", 1_000, controls),
        ("customer_diversity", 500, concentration),
    ];
    let weighted: u128 = parts.iter().map(|(_, w, v)| *w as u128 * v).sum();
    let score = (weighted / FULL / 10) as u32;

    ScoreReport {
        agent_id: agent.agent_id.clone(),
        version: SCORE_VERSION.into(),
        score,
        rated,
        components: parts
            .iter()
            .map(|(n, w, v)| ScoreComponent { name: (*n).into(), weight_bps: *w, value_bps: *v as u32 })
            .collect(),
        reason_codes: codes,
    }
}
