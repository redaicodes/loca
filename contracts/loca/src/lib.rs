//! LOCA - Line of Credit for Agents.
//!
//! One contract holds agent identities, customer order escrow, the lender offer market and
//! loan settlement. All funds are a single NEP-141 accounting token (USDC in production).
//! Payouts are credited to internal balances and pulled with `withdraw`, so a failed token
//! transfer can never leave the waterfall half-applied.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

pub mod score;
pub mod types;

pub use score::{ScoreComponent, ScoreReport};
pub use types::*;

const MAX_OFFERS_PER_ORDER: usize = 10;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Agents,
    AgentOrders,
    CustomerPairs,
    Orders,
    Offers,
    Loans,
    Balances,
    AgentIds,
    Storage,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Loca {
    owner_id: AccountId,
    arbiter_id: AccountId,
    token_id: AccountId,
    paused: bool,
    dispute_window_ns: u64,
    max_advance_bps: u16,
    approved_vendors: Vec<AccountId>,
    agents: LookupMap<AccountId, Agent>,
    agent_orders: LookupMap<AccountId, Vec<u64>>,
    customer_pairs: LookupSet<(AccountId, AccountId)>,
    orders: LookupMap<u64, Order>,
    offers: LookupMap<u64, Offer>,
    loans: LookupMap<u64, Loan>,
    balances: LookupMap<AccountId, u128>,
    next_order_id: u64,
    next_offer_id: u64,
    next_loan_id: u64,
    agent_ids: Vector<AccountId>,
    totals: MarketTotals,
    /// Prepaid NEAR for storage (NEP-145 style). Records are charged a flat price with a margin
    /// over their measured size, so the market account never pays for state it did not create.
    storage: LookupMap<AccountId, u128>,
}

/// Layout before storage accounting, for `migrate`.
#[near(serializers = [borsh])]
pub struct LocaV2 {
    owner_id: AccountId,
    arbiter_id: AccountId,
    token_id: AccountId,
    paused: bool,
    dispute_window_ns: u64,
    max_advance_bps: u16,
    approved_vendors: Vec<AccountId>,
    agents: LookupMap<AccountId, Agent>,
    agent_orders: LookupMap<AccountId, Vec<u64>>,
    customer_pairs: LookupSet<(AccountId, AccountId)>,
    orders: LookupMap<u64, Order>,
    offers: LookupMap<u64, Offer>,
    loans: LookupMap<u64, Loan>,
    balances: LookupMap<AccountId, u128>,
    next_order_id: u64,
    next_offer_id: u64,
    next_loan_id: u64,
    agent_ids: Vector<AccountId>,
    totals: MarketTotals,
}

const MILLINEAR: u128 = 1_000_000_000_000_000_000_000;
/// Flat storage prices at 10^19 yoctoNEAR per byte. Measured on a sandbox: an order is 223 bytes when
/// created and grows to ~420 as it is requested against and delivered (charged 800); a bid is 161
/// (charged 400); a loan is 283 (charged 500).
pub const STORAGE_AGENT: u128 = 10 * MILLINEAR;
pub const STORAGE_ORDER: u128 = 8 * MILLINEAR;
pub const STORAGE_OFFER: u128 = 4 * MILLINEAR;
pub const STORAGE_LOAN: u128 = 5 * MILLINEAR;
/// Smallest order, in token base units (1 USDC at 6 decimals). Stops dust orders.
pub const MIN_ORDER: u128 = 1_000_000;
const MAX_POLICY_VENDORS: usize = 10;

fn add(a: &mut U128, v: u128) {
    a.0 += v;
}
fn sub(a: &mut U128, v: u128) {
    a.0 -= v;
}

const MAX_PAGE: u32 = 100;

fn emit(event: &str, data: Value) {
    let log = json!({ "standard": "loca", "version": "0.1.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", log));
}

fn ensure(cond: bool, err: &'static str) -> Result<(), &'static str> {
    if cond { Ok(()) } else { Err(err) }
}

fn now() -> u64 {
    env::block_timestamp()
}

#[near]
impl Loca {
    #[init]
    pub fn new(
        owner_id: AccountId,
        arbiter_id: AccountId,
        token_id: AccountId,
        dispute_window_sec: u64,
        max_advance_bps: u16,
    ) -> Self {
        require!(max_advance_bps > 0 && max_advance_bps <= 9_000, "ERR_ADVANCE_BPS");
        Self {
            owner_id,
            arbiter_id,
            token_id,
            paused: false,
            dispute_window_ns: dispute_window_sec * 1_000_000_000,
            max_advance_bps,
            approved_vendors: Vec::new(),
            agents: LookupMap::new(StorageKey::Agents),
            agent_orders: LookupMap::new(StorageKey::AgentOrders),
            customer_pairs: LookupSet::new(StorageKey::CustomerPairs),
            orders: LookupMap::new(StorageKey::Orders),
            offers: LookupMap::new(StorageKey::Offers),
            loans: LookupMap::new(StorageKey::Loans),
            balances: LookupMap::new(StorageKey::Balances),
            next_order_id: 0,
            next_offer_id: 0,
            next_loan_id: 0,
            agent_ids: Vector::new(StorageKey::AgentIds),
            totals: MarketTotals::default(),
            storage: LookupMap::new(StorageKey::Storage),
        }
    }

    /// One-time upgrade from the layout without storage accounting. Keeps all history.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: LocaV2 = env::state_read().unwrap_or_else(|| env::panic_str("ERR_NO_STATE"));
        Self {
            owner_id: old.owner_id,
            arbiter_id: old.arbiter_id,
            token_id: old.token_id,
            paused: old.paused,
            dispute_window_ns: old.dispute_window_ns,
            max_advance_bps: old.max_advance_bps,
            approved_vendors: old.approved_vendors,
            agents: old.agents,
            agent_orders: old.agent_orders,
            customer_pairs: old.customer_pairs,
            orders: old.orders,
            offers: old.offers,
            loans: old.loans,
            balances: old.balances,
            next_order_id: old.next_order_id,
            next_offer_id: old.next_offer_id,
            next_loan_id: old.next_loan_id,
            agent_ids: old.agent_ids,
            totals: old.totals,
            storage: LookupMap::new(StorageKey::Storage),
        }
    }

    // ---------- storage ----------

    /// Prepay storage for `account_id` (default: the caller). Agents pay for the orders and loans
    /// they receive; lenders pay for their bids.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let id = account_id.unwrap_or_else(env::predecessor_account_id);
        let bal = self.storage.get(&id).copied().unwrap_or(0) + env::attached_deposit().as_yoctonear();
        self.storage.insert(id.clone(), bal);
        emit("storage_deposit", json!({ "account_id": id, "balance": U128(bal) }));
        U128(bal)
    }

    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> Promise {
        let id = env::predecessor_account_id();
        let bal = self.storage.get(&id).copied().unwrap_or(0);
        let amount = amount.map(|a| a.0).unwrap_or(bal);
        require!(amount > 0 && amount <= bal, "ERR_STORAGE_AMOUNT");
        self.storage.insert(id.clone(), bal - amount);
        Promise::new(id).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.storage.get(&account_id).copied().unwrap_or(0))
    }

    // ---------- admin ----------

    /// Kill switch for new draws. Settlement, refunds and withdrawals keep working.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        emit("paused", json!({ "paused": paused }));
    }

    /// Curated in the MVP: loan proceeds only go to vendors independent of the borrower.
    pub fn add_vendor(&mut self, vendor_id: AccountId) {
        self.assert_owner();
        if !self.approved_vendors.contains(&vendor_id) {
            self.approved_vendors.push(vendor_id.clone());
        }
        emit("vendor_added", json!({ "vendor_id": vendor_id }));
    }

    pub fn remove_vendor(&mut self, vendor_id: AccountId) {
        self.assert_owner();
        self.approved_vendors.retain(|v| v != &vendor_id);
        emit("vendor_removed", json!({ "vendor_id": vendor_id }));
    }

    pub fn set_arbiter(&mut self, arbiter_id: AccountId) {
        self.assert_owner();
        self.arbiter_id = arbiter_id.clone();
        emit("arbiter_set", json!({ "arbiter_id": arbiter_id }));
    }

    // ---------- identity ----------

    /// Called by the agent account. The operator is the human or org accountable for it.
    /// Attach at least 0.01 NEAR (or prepay with `storage_deposit`); the rest stays as the
    /// agent's storage balance for future orders and loans.
    #[payable]
    pub fn register_agent(&mut self, operator_id: AccountId, profile_hash: String) {
        let agent_id = env::predecessor_account_id();
        require!(self.agents.get(&agent_id).is_none(), "ERR_ALREADY_REGISTERED");
        require!(operator_id != agent_id, "ERR_OPERATOR_IS_AGENT");
        require!(profile_hash.len() <= 128, "ERR_PROFILE_HASH_TOO_LONG");
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit > 0 {
            let bal = self.storage.get(&agent_id).copied().unwrap_or(0) + deposit;
            self.storage.insert(agent_id.clone(), bal);
        }
        self.charge_storage(&agent_id, STORAGE_AGENT).unwrap_or_else(|e| env::panic_str(e));
        let agent = Agent {
            agent_id: agent_id.clone(),
            operator_id: operator_id.clone(),
            profile_hash: profile_hash.clone(),
            registered_at: U64(now()),
            policy: SpendPolicy::default(),
            policy_version: 0,
            bond: U128(0),
            active_loans: 0,
            stats: Stats::default(),
        };
        self.agents.insert(agent_id.clone(), agent);
        self.agent_ids.push(agent_id.clone());
        emit(
            "agent_registered",
            json!({ "agent_id": agent_id, "operator_id": operator_id, "profile_hash": profile_hash }),
        );
    }

    pub fn update_profile(&mut self, profile_hash: String) {
        let mut agent = self.agent(&env::predecessor_account_id());
        agent.profile_hash = profile_hash.clone();
        emit("profile_updated", json!({ "agent_id": agent.agent_id, "profile_hash": profile_hash }));
        self.agents.insert(agent.agent_id.clone(), agent);
    }

    /// Only the operator can set what the agent may spend borrowed funds on.
    pub fn set_spend_policy(&mut self, agent_id: AccountId, allowed_vendors: Vec<AccountId>, max_principal: U128) {
        let mut agent = self.agent(&agent_id);
        require!(env::predecessor_account_id() == agent.operator_id, "ERR_NOT_OPERATOR");
        require!(allowed_vendors.len() <= MAX_POLICY_VENDORS, "ERR_TOO_MANY_VENDORS");
        for v in &allowed_vendors {
            require!(v != &agent.agent_id && v != &agent.operator_id, "ERR_VENDOR_RELATED_PARTY");
        }
        agent.policy = SpendPolicy { allowed_vendors, max_principal };
        agent.policy_version += 1;
        emit(
            "policy_set",
            json!({ "agent_id": agent_id, "version": agent.policy_version, "policy": agent.policy }),
        );
        self.agents.insert(agent_id, agent);
    }

    // ---------- credit market ----------

    pub fn request_credit(&mut self, order_id: u64, amount: U128, vendor_id: AccountId, max_fee: U128, expires_at: U64) {
        require!(!self.paused, "ERR_PAUSED");
        let mut order = self.order(order_id);
        require!(env::predecessor_account_id() == order.agent_id, "ERR_NOT_AGENT");
        require!(order.status == OrderStatus::Funded, "ERR_ORDER_NOT_FUNDED");
        require!(order.loan_id.is_none(), "ERR_ORDER_ALREADY_PLEDGED");
        require!(amount.0 > 0, "ERR_ZERO_AMOUNT");
        require!(
            amount.0 * 10_000 <= order.amount.0 * self.max_advance_bps as u128,
            "ERR_EXCEEDS_ADVANCE_RATE"
        );
        require!(amount.0 + max_fee.0 <= order.amount.0, "ERR_EXCEEDS_ORDER");
        require!(expires_at.0 > now() && expires_at.0 <= order.deadline.0, "ERR_BAD_EXPIRY");
        let agent = self.agent(&order.agent_id);
        require!(amount.0 <= agent.policy.max_principal.0, "ERR_EXCEEDS_POLICY");
        self.assert_vendor_allowed(&agent, &vendor_id);
        order.credit_request = Some(CreditRequest { amount, vendor_id: vendor_id.clone(), max_fee, expires_at });
        emit(
            "credit_requested",
            json!({ "order_id": order_id, "agent_id": order.agent_id, "amount": amount,
                    "vendor_id": vendor_id, "max_fee": max_fee, "expires_at": expires_at }),
        );
        self.orders.insert(order_id, order);
    }

    pub fn accept_offer(&mut self, offer_id: u64) {
        require!(!self.paused, "ERR_PAUSED");
        let mut offer = self.offer(offer_id);
        let mut order = self.order(offer.order_id);
        require!(env::predecessor_account_id() == order.agent_id, "ERR_NOT_AGENT");
        require!(offer.status == OfferStatus::Open, "ERR_OFFER_NOT_OPEN");
        require!(now() < offer.expires_at.0, "ERR_OFFER_EXPIRED");
        require!(order.status == OrderStatus::Funded, "ERR_ORDER_NOT_FUNDED");
        require!(order.loan_id.is_none(), "ERR_ORDER_ALREADY_PLEDGED");
        let req = order.credit_request.clone().unwrap_or_else(|| env::panic_str("ERR_NO_REQUEST"));
        require!(now() < req.expires_at.0, "ERR_REQUEST_EXPIRED");
        require!(offer.principal == req.amount, "ERR_OFFER_MISMATCH");
        require!(offer.fee.0 <= req.max_fee.0, "ERR_FEE_TOO_HIGH");
        let mut agent = self.agent(&order.agent_id);
        // Policy may have changed since the request.
        self.assert_vendor_allowed(&agent, &req.vendor_id);
        require!(offer.principal.0 <= agent.policy.max_principal.0, "ERR_EXCEEDS_POLICY");

        self.charge_storage(&order.agent_id, STORAGE_LOAN).unwrap_or_else(|e| env::panic_str(e));
        let loan_id = self.next_loan_id;
        self.next_loan_id += 1;
        let loan = Loan {
            id: loan_id,
            order_id: order.id,
            offer_id,
            lender_id: offer.lender_id.clone(),
            agent_id: order.agent_id.clone(),
            vendor_id: req.vendor_id.clone(),
            principal: offer.principal,
            fee: offer.fee,
            status: LoanStatus::Active,
            repaid: U128(0),
            recovered_from_bond: U128(0),
            created_at: U64(now()),
            closed_at: None,
        };
        offer.status = OfferStatus::Accepted;
        order.loan_id = Some(loan_id);
        sub(&mut self.totals.offers_open, offer.principal.0);
        self.totals.loans += 1;
        add(&mut self.totals.originated, offer.principal.0);
        add(&mut self.totals.outstanding, offer.principal.0);
        agent.active_loans += 1;
        agent.stats.loans_taken += 1;

        // Proceeds go straight to the vendor, never to the agent.
        self.credit(&req.vendor_id, offer.principal.0);
        emit(
            "loan_funded",
            json!({ "loan_id": loan_id, "order_id": order.id, "offer_id": offer_id,
                    "lender_id": loan.lender_id, "agent_id": loan.agent_id, "vendor_id": loan.vendor_id,
                    "principal": loan.principal, "fee": loan.fee }),
        );

        self.offers.insert(offer_id, offer);
        self.loans.insert(loan_id, loan);
        self.agents.insert(agent.agent_id.clone(), agent);
        self.release_open_offers(&order);
        self.orders.insert(order.id, order);
    }

    pub fn withdraw_offer(&mut self, offer_id: u64) {
        let mut offer = self.offer(offer_id);
        require!(env::predecessor_account_id() == offer.lender_id, "ERR_NOT_LENDER");
        require!(offer.status == OfferStatus::Open, "ERR_OFFER_NOT_OPEN");
        offer.status = OfferStatus::Withdrawn;
        sub(&mut self.totals.offers_open, offer.principal.0);
        self.credit(&offer.lender_id, offer.principal.0);
        emit("offer_withdrawn", json!({ "offer_id": offer_id, "lender_id": offer.lender_id }));
        self.offers.insert(offer_id, offer);
    }

    // ---------- delivery and settlement ----------

    pub fn mark_delivered(&mut self, order_id: u64, deliverable_hash: String) {
        let mut order = self.order(order_id);
        require!(env::predecessor_account_id() == order.agent_id, "ERR_NOT_AGENT");
        require!(order.status == OrderStatus::Funded, "ERR_ORDER_NOT_FUNDED");
        require!(deliverable_hash.len() <= 128, "ERR_HASH_TOO_LONG");
        order.status = OrderStatus::Delivered;
        order.delivered_at = Some(U64(now()));
        order.deliverable_hash = Some(deliverable_hash.clone());
        emit(
            "order_delivered",
            json!({ "order_id": order_id, "agent_id": order.agent_id, "deliverable_hash": deliverable_hash }),
        );
        self.orders.insert(order_id, order);
    }

    pub fn approve(&mut self, order_id: u64) {
        let order = self.order(order_id);
        require!(env::predecessor_account_id() == order.customer_id, "ERR_NOT_CUSTOMER");
        require!(order.status == OrderStatus::Delivered, "ERR_NOT_DELIVERED");
        self.settle(order, 0, "approved");
    }

    /// Anyone may release a delivered order once the dispute window has passed without a dispute.
    pub fn finalize(&mut self, order_id: u64) {
        let order = self.order(order_id);
        require!(order.status == OrderStatus::Delivered, "ERR_NOT_DELIVERED");
        let delivered_at = order.delivered_at.unwrap().0;
        require!(now() >= delivered_at + self.dispute_window_ns, "ERR_DISPUTE_WINDOW_OPEN");
        self.settle(order, 0, "auto_released");
    }

    pub fn dispute(&mut self, order_id: u64, reason_hash: String) {
        let mut order = self.order(order_id);
        require!(env::predecessor_account_id() == order.customer_id, "ERR_NOT_CUSTOMER");
        require!(order.status == OrderStatus::Delivered, "ERR_NOT_DELIVERED");
        require!(now() < order.delivered_at.unwrap().0 + self.dispute_window_ns, "ERR_DISPUTE_WINDOW_CLOSED");
        order.status = OrderStatus::Disputed;
        self.totals.orders_disputed += 1;
        emit("order_disputed", json!({ "order_id": order_id, "reason_hash": reason_hash }));
        self.orders.insert(order_id, order);
    }

    /// `refund_bps` of the order goes back to the customer; the rest flows through the waterfall.
    pub fn resolve_dispute(&mut self, order_id: u64, refund_bps: u16) {
        require!(env::predecessor_account_id() == self.arbiter_id, "ERR_NOT_ARBITER");
        require!(refund_bps <= 10_000, "ERR_BPS");
        let order = self.order(order_id);
        require!(order.status == OrderStatus::Disputed, "ERR_NOT_DISPUTED");
        let refund = order.amount.0 * refund_bps as u128 / 10_000;
        self.settle(order, refund, "dispute_resolved");
    }

    /// Customer reclaims escrow when the agent missed the deadline without delivering.
    pub fn cancel_order(&mut self, order_id: u64) {
        let order = self.order(order_id);
        require!(env::predecessor_account_id() == order.customer_id, "ERR_NOT_CUSTOMER");
        require!(order.status == OrderStatus::Funded, "ERR_ORDER_NOT_FUNDED");
        require!(now() > order.deadline.0, "ERR_BEFORE_DEADLINE");
        let refund = order.amount.0;
        self.settle(order, refund, "cancelled");
    }

    // ---------- funds ----------

    pub fn withdraw(&mut self) -> near_sdk::Promise {
        let account_id = env::predecessor_account_id();
        let amount = self.balances.get(&account_id).copied().unwrap_or(0);
        require!(amount > 0, "ERR_NOTHING_TO_WITHDRAW");
        self.balances.insert(account_id.clone(), 0);
        sub(&mut self.totals.claimable, amount);
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account_id.clone(), U128(amount), Some("loca withdraw".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_WITHDRAW_CALLBACK)
                    .on_withdraw(account_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.credit(&account_id, amount.0);
            emit("withdraw_failed", json!({ "account_id": account_id, "amount": amount }));
        } else {
            emit("withdrawn", json!({ "account_id": account_id, "amount": amount }));
        }
    }

    pub fn withdraw_bond(&mut self, amount: U128) {
        let mut agent = self.agent(&env::predecessor_account_id());
        require!(agent.active_loans == 0, "ERR_ACTIVE_LOANS");
        require!(agent.bond.0 >= amount.0 && amount.0 > 0, "ERR_BOND_AMOUNT");
        agent.bond = U128(agent.bond.0 - amount.0);
        sub(&mut self.totals.bonds_held, amount.0);
        self.credit(&agent.agent_id, amount.0);
        emit("bond_withdrawn", json!({ "agent_id": agent.agent_id, "amount": amount }));
        self.agents.insert(agent.agent_id.clone(), agent);
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            arbiter_id: self.arbiter_id.clone(),
            token_id: self.token_id.clone(),
            paused: self.paused,
            dispute_window_ns: U64(self.dispute_window_ns),
            max_advance_bps: self.max_advance_bps,
            approved_vendors: self.approved_vendors.clone(),
        }
    }

    pub fn get_agent(&self, agent_id: AccountId) -> Option<Agent> {
        self.agents.get(&agent_id).cloned()
    }

    pub fn get_score(&self, agent_id: AccountId) -> Option<ScoreReport> {
        self.agents.get(&agent_id).map(score::compute)
    }

    pub fn get_order(&self, order_id: u64) -> Option<Order> {
        self.orders.get(&order_id).cloned()
    }

    pub fn get_agent_orders(&self, agent_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Order> {
        let ids = self.agent_orders.get(&agent_id).cloned().unwrap_or_default();
        ids.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .filter_map(|id| self.orders.get(id).cloned())
            .collect()
    }

    pub fn get_offers(&self, order_id: u64) -> Vec<Offer> {
        self.orders
            .get(&order_id)
            .map(|o| o.offer_ids.iter().filter_map(|id| self.offers.get(id).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_offer(&self, offer_id: u64) -> Option<Offer> {
        self.offers.get(&offer_id).cloned()
    }

    pub fn get_loan(&self, loan_id: u64) -> Option<Loan> {
        self.loans.get(&loan_id).cloned()
    }

    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    /// Market-wide totals in one call. Value locked = escrow_held + offers_open + bonds_held + claimable,
    /// which always equals the contract's token balance.
    pub fn get_market(&self) -> MarketView {
        MarketView {
            totals: self.totals.clone(),
            agents: self.agent_ids.len(),
            next_order_id: self.next_order_id,
            next_offer_id: self.next_offer_id,
            next_loan_id: self.next_loan_id,
            block_timestamp: U64(now()),
        }
    }

    /// Registered agents in registration order, each with its current score.
    pub fn get_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AgentWithScore> {
        let from = from_index.unwrap_or(0);
        let to = (from + limit.unwrap_or(50).min(MAX_PAGE)).min(self.agent_ids.len());
        (from..to)
            .filter_map(|i| self.agent_ids.get(i))
            .filter_map(|id| self.agents.get(id))
            .map(|a| AgentWithScore { agent: a.clone(), score: score::compute(a) })
            .collect()
    }

    /// Orders by id, `from_id` inclusive.
    pub fn get_orders(&self, from_id: Option<u64>, limit: Option<u32>) -> Vec<Order> {
        let from = from_id.unwrap_or(0);
        let to = (from + limit.unwrap_or(50).min(MAX_PAGE) as u64).min(self.next_order_id);
        (from..to).filter_map(|i| self.orders.get(&i).cloned()).collect()
    }

    pub fn get_offer_list(&self, from_id: Option<u64>, limit: Option<u32>) -> Vec<Offer> {
        let from = from_id.unwrap_or(0);
        let to = (from + limit.unwrap_or(50).min(MAX_PAGE) as u64).min(self.next_offer_id);
        (from..to).filter_map(|i| self.offers.get(&i).cloned()).collect()
    }

    pub fn get_loans(&self, from_id: Option<u64>, limit: Option<u32>) -> Vec<Loan> {
        let from = from_id.unwrap_or(0);
        let to = (from + limit.unwrap_or(50).min(MAX_PAGE) as u64).min(self.next_loan_id);
        (from..to).filter_map(|i| self.loans.get(&i).cloned()).collect()
    }
}

#[near]
impl FungibleTokenReceiver for Loca {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token_id, "ERR_WRONG_TOKEN");
        require!(amount.0 > 0, "ERR_ZERO_AMOUNT");
        let msg: TransferMsg =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        // Deposits may arrive via NEAR Intents (1Click `customRecipientMsg`), where `sender_id` is
        // the Intents contract and a panic here would strand the funds. So a valid message names
        // its beneficiary, and a business-rule failure credits the beneficiary's withdrawable
        // balance instead of reverting.
        let (beneficiary, result) = match msg {
            TransferMsg::FundOrder { agent_id, terms_hash, deadline, customer_id } => {
                let customer = customer_id.unwrap_or(sender_id.clone());
                let r = self.fund_order(customer.clone(), amount.0, agent_id, terms_hash, deadline.0);
                (customer, r)
            }
            TransferMsg::MakeOffer { order_id, fee, expires_at, strategy, lender_id } => {
                let lender = lender_id.unwrap_or(sender_id.clone());
                let r = self.make_offer(lender.clone(), amount.0, order_id, fee.0, expires_at.0, strategy);
                (lender, r)
            }
            TransferMsg::PostBond { agent_id } => {
                let r = match self.agents.get(&agent_id).cloned() {
                    Some(mut agent) => {
                        agent.bond = U128(agent.bond.0 + amount.0);
                        add(&mut self.totals.bonds_held, amount.0);
                        emit("bond_posted", json!({ "agent_id": agent_id, "from": sender_id, "amount": amount }));
                        self.agents.insert(agent_id, agent);
                        Ok(())
                    }
                    None => Err("ERR_UNKNOWN_AGENT"),
                };
                (sender_id.clone(), r)
            }
        };
        if let Err(reason) = result {
            self.totals.deposits_rejected += 1;
            self.credit(&beneficiary, amount.0);
            emit(
                "deposit_rejected",
                json!({ "beneficiary": beneficiary, "sender_id": sender_id, "amount": amount, "reason": reason }),
            );
        }
        PromiseOrValue::Value(U128(0))
    }
}

impl Loca {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
    }

    fn agent(&self, id: &AccountId) -> Agent {
        self.agents.get(id).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_AGENT"))
    }

    fn order(&self, id: u64) -> Order {
        self.orders.get(&id).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_ORDER"))
    }

    fn offer(&self, id: u64) -> Offer {
        self.offers.get(&id).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_OFFER"))
    }

    /// Deduct a flat storage price from an account's prepaid balance.
    fn charge_storage(&mut self, payer: &AccountId, price: u128) -> Result<(), &'static str> {
        let bal = self.storage.get(payer).copied().unwrap_or(0);
        ensure(bal >= price, "ERR_STORAGE_DEPOSIT_REQUIRED")?;
        self.storage.insert(payer.clone(), bal - price);
        Ok(())
    }

    fn credit(&mut self, account_id: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let bal = self.balances.get(account_id).copied().unwrap_or(0);
        self.balances.insert(account_id.clone(), bal + amount);
        add(&mut self.totals.claimable, amount);
    }

    fn assert_vendor_allowed(&self, agent: &Agent, vendor_id: &AccountId) {
        require!(agent.policy.allowed_vendors.contains(vendor_id), "ERR_VENDOR_NOT_IN_POLICY");
        require!(self.approved_vendors.contains(vendor_id), "ERR_VENDOR_NOT_APPROVED");
    }

    fn fund_order(&mut self, customer_id: AccountId, amount: u128, agent_id: AccountId, terms_hash: String, deadline: u64) -> Result<(), &'static str> {
        let mut agent = self.agents.get(&agent_id).cloned().ok_or("ERR_UNKNOWN_AGENT")?;
        ensure(customer_id != agent.agent_id && customer_id != agent.operator_id, "ERR_CUSTOMER_RELATED_PARTY")?;
        ensure(deadline > now(), "ERR_BAD_DEADLINE")?;
        ensure(amount >= MIN_ORDER, "ERR_ORDER_TOO_SMALL")?;
        ensure(terms_hash.len() <= 128, "ERR_TERMS_HASH_TOO_LONG")?;
        // The agent pays for the order record; checked last so nothing is charged on a rejection.
        self.charge_storage(&agent_id, STORAGE_ORDER)?;
        let id = self.next_order_id;
        self.next_order_id += 1;
        let order = Order {
            id,
            agent_id: agent_id.clone(),
            customer_id: customer_id.clone(),
            amount: U128(amount),
            terms_hash: terms_hash.clone(),
            deadline: U64(deadline),
            status: OrderStatus::Funded,
            created_at: U64(now()),
            delivered_at: None,
            deliverable_hash: None,
            credit_request: None,
            offer_ids: Vec::new(),
            loan_id: None,
            customer_refund: U128(0),
        };
        agent.stats.orders_received += 1;
        self.totals.orders += 1;
        add(&mut self.totals.escrow_volume, amount);
        add(&mut self.totals.escrow_held, amount);
        let mut ids = self.agent_orders.get(&agent_id).cloned().unwrap_or_default();
        ids.push(id);
        self.agent_orders.insert(agent_id.clone(), ids);
        self.agents.insert(agent_id.clone(), agent);
        self.orders.insert(id, order);
        emit(
            "order_funded",
            json!({ "order_id": id, "agent_id": agent_id, "customer_id": customer_id,
                    "amount": U128(amount), "terms_hash": terms_hash, "deadline": U64(deadline) }),
        );
        Ok(())
    }

    fn make_offer(&mut self, lender_id: AccountId, principal: u128, order_id: u64, fee: u128, expires_at: u64, strategy: String) -> Result<(), &'static str> {
        let mut order = self.orders.get(&order_id).cloned().ok_or("ERR_UNKNOWN_ORDER")?;
        ensure(order.status == OrderStatus::Funded, "ERR_ORDER_NOT_FUNDED")?;
        ensure(order.loan_id.is_none(), "ERR_ORDER_ALREADY_PLEDGED")?;
        ensure(order.offer_ids.len() < MAX_OFFERS_PER_ORDER, "ERR_TOO_MANY_OFFERS")?;
        let req = order.credit_request.clone().ok_or("ERR_NO_REQUEST")?;
        ensure(now() < req.expires_at.0, "ERR_REQUEST_EXPIRED")?;
        ensure(principal == req.amount.0, "ERR_OFFER_MISMATCH")?;
        ensure(fee <= req.max_fee.0, "ERR_FEE_TOO_HIGH")?;
        ensure(expires_at > now(), "ERR_BAD_EXPIRY")?;
        let agent = self.agent(&order.agent_id);
        ensure(
            lender_id != agent.agent_id && lender_id != agent.operator_id && lender_id != order.customer_id,
            "ERR_LENDER_RELATED_PARTY",
        )?;
        ensure(strategy.len() <= 64, "ERR_STRATEGY_TOO_LONG")?;
        self.charge_storage(&lender_id, STORAGE_OFFER)?;
        let id = self.next_offer_id;
        self.next_offer_id += 1;
        let offer = Offer {
            id,
            order_id,
            lender_id: lender_id.clone(),
            principal: U128(principal),
            fee: U128(fee),
            expires_at: U64(expires_at),
            strategy: strategy.clone(),
            status: OfferStatus::Open,
            created_at: U64(now()),
        };
        order.offer_ids.push(id);
        self.totals.offers_made += 1;
        add(&mut self.totals.offers_open, principal);
        self.offers.insert(id, offer);
        self.orders.insert(order_id, order);
        emit(
            "offer_made",
            json!({ "offer_id": id, "order_id": order_id, "lender_id": lender_id,
                    "principal": U128(principal), "fee": U128(fee), "expires_at": U64(expires_at),
                    "strategy": strategy }),
        );
        Ok(())
    }

    /// Return deposits of every still-open offer on an order.
    fn release_open_offers(&mut self, order: &Order) {
        for id in &order.offer_ids {
            let mut offer = self.offer(*id);
            if offer.status == OfferStatus::Open {
                offer.status = OfferStatus::Withdrawn;
                sub(&mut self.totals.offers_open, offer.principal.0);
                self.credit(&offer.lender_id, offer.principal.0);
                emit("offer_released", json!({ "offer_id": id, "lender_id": offer.lender_id }));
                self.offers.insert(*id, offer);
            }
        }
    }

    /// Repayment waterfall. Customer refund first (it is the customer's money), then the
    /// lender up to principal + fee from the agent side, then the agent's bond covers any
    /// shortfall, and the agent keeps the remainder.
    fn settle(&mut self, mut order: Order, customer_refund: u128, outcome: &str) {
        let mut agent = self.agent(&order.agent_id);
        let mut agent_side = order.amount.0 - customer_refund;
        let mut to_lender = 0u128;
        let mut from_bond = 0u128;
        let mut shortfall = 0u128;

        if let Some(loan_id) = order.loan_id {
            let mut loan = self.loans.get(&loan_id).cloned().unwrap();
            let owed = loan.principal.0 + loan.fee.0;
            to_lender = owed.min(agent_side);
            agent_side -= to_lender;
            shortfall = owed - to_lender;
            from_bond = shortfall.min(agent.bond.0);
            agent.bond = U128(agent.bond.0 - from_bond);
            shortfall -= from_bond;
            let t = &mut self.totals;
            sub(&mut t.outstanding, loan.principal.0);
            sub(&mut t.bonds_held, from_bond);
            add(&mut t.bond_drawn, from_bond);
            add(&mut t.repaid_to_lenders, to_lender + from_bond);
            if shortfall > 0 {
                t.loans_defaulted += 1;
                add(&mut t.default_loss, shortfall);
            } else {
                t.loans_repaid += 1;
                add(&mut t.fees_paid, loan.fee.0);
            }
            loan.repaid = U128(to_lender + from_bond);
            loan.recovered_from_bond = U128(from_bond);
            loan.closed_at = Some(U64(now()));
            if shortfall > 0 {
                loan.status = LoanStatus::Defaulted;
                agent.stats.loans_defaulted += 1;
                agent.stats.default_loss = U128(agent.stats.default_loss.0 + shortfall);
            } else {
                loan.status = LoanStatus::Repaid;
                if from_bond > 0 {
                    agent.stats.loans_repaid_with_bond += 1;
                } else {
                    agent.stats.loans_repaid += 1;
                }
            }
            agent.stats.principal_repaid =
                U128(agent.stats.principal_repaid.0 + loan.principal.0.min(loan.repaid.0));
            agent.active_loans -= 1;
            self.credit(&loan.lender_id, to_lender + from_bond);
            emit(
                if shortfall > 0 { "loan_defaulted" } else { "loan_repaid" },
                json!({ "loan_id": loan_id, "order_id": order.id, "lender_id": loan.lender_id,
                        "paid_from_escrow": U128(to_lender), "paid_from_bond": U128(from_bond),
                        "shortfall": U128(shortfall) }),
            );
            self.loans.insert(loan_id, loan);
        }

        self.credit(&order.customer_id, customer_refund);
        self.credit(&order.agent_id, agent_side);

        let earned = order.amount.0 - customer_refund;
        sub(&mut self.totals.escrow_held, order.amount.0);
        add(&mut self.totals.agent_revenue, agent_side);
        add(&mut self.totals.customer_refunds, customer_refund);
        if customer_refund == order.amount.0 {
            self.totals.orders_refunded += 1;
        } else {
            self.totals.orders_settled += 1;
        }
        agent.stats.revenue = U128(agent.stats.revenue.0 + earned);
        if customer_refund == 0 {
            agent.stats.orders_completed += 1;
            let pair = (order.agent_id.clone(), order.customer_id.clone());
            if !self.customer_pairs.contains(&pair) {
                self.customer_pairs.insert(pair);
                agent.stats.unique_customers += 1;
            }
        } else if outcome == "cancelled" {
            agent.stats.orders_refunded += 1;
        } else {
            agent.stats.disputes_lost += 1;
        }

        order.status = if customer_refund == order.amount.0 { OrderStatus::Refunded } else { OrderStatus::Released };
        order.customer_refund = U128(customer_refund);
        self.release_open_offers(&order);
        emit(
            "order_settled",
            json!({ "order_id": order.id, "outcome": outcome, "customer_refund": U128(customer_refund),
                    "to_lender": U128(to_lender + from_bond), "to_agent": U128(agent_side),
                    "lender_shortfall": U128(shortfall) }),
        );
        self.agents.insert(agent.agent_id.clone(), agent);
        self.orders.insert(order.id, order);
    }
}

#[cfg(test)]
mod tests;
