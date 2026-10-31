use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// Spending rules set by the human operator. The agent itself cannot change them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SpendPolicy {
    /// Vendors loan proceeds may be paid to. Must also be on the protocol vendor list.
    pub allowed_vendors: Vec<AccountId>,
    /// Largest single advance the operator allows this agent to take.
    pub max_principal: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stats {
    pub orders_received: u32,
    pub orders_completed: u32,
    pub orders_refunded: u32,
    pub disputes_lost: u32,
    pub unique_customers: u32,
    /// Sum of escrow amounts released to the agent side (before loan repayment).
    pub revenue: U128,
    pub loans_taken: u32,
    pub loans_repaid: u32,
    pub loans_repaid_with_bond: u32,
    pub loans_defaulted: u32,
    pub principal_repaid: U128,
    pub default_loss: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    pub agent_id: AccountId,
    pub operator_id: AccountId,
    pub profile_hash: String,
    pub registered_at: U64,
    pub policy: SpendPolicy,
    pub policy_version: u32,
    /// First-loss bond, drawn to cover lender shortfall on a failed order.
    pub bond: U128,
    pub active_loans: u32,
    pub stats: Stats,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum OrderStatus {
    Funded,
    Delivered,
    Disputed,
    /// Escrow paid out; `customer_refund` may be non-zero after a partial dispute ruling.
    Released,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CreditRequest {
    pub amount: U128,
    pub vendor_id: AccountId,
    pub max_fee: U128,
    pub expires_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub id: u64,
    pub agent_id: AccountId,
    pub customer_id: AccountId,
    pub amount: U128,
    pub terms_hash: String,
    pub deadline: U64,
    pub status: OrderStatus,
    pub created_at: U64,
    pub delivered_at: Option<U64>,
    pub deliverable_hash: Option<String>,
    pub credit_request: Option<CreditRequest>,
    pub offer_ids: Vec<u64>,
    pub loan_id: Option<u64>,
    pub customer_refund: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum OfferStatus {
    Open,
    Accepted,
    Withdrawn,
}

/// A lender bid. Principal is deposited when the offer is made, so an offer is never unfunded.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Offer {
    pub id: u64,
    pub order_id: u64,
    pub lender_id: AccountId,
    pub principal: U128,
    pub fee: U128,
    pub expires_at: U64,
    pub strategy: String,
    pub status: OfferStatus,
    pub created_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum LoanStatus {
    Active,
    Repaid,
    Defaulted,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Loan {
    pub id: u64,
    pub order_id: u64,
    pub offer_id: u64,
    pub lender_id: AccountId,
    pub agent_id: AccountId,
    pub vendor_id: AccountId,
    pub principal: U128,
    pub fee: U128,
    pub status: LoanStatus,
    pub repaid: U128,
    pub recovered_from_bond: U128,
    pub created_at: U64,
    pub closed_at: Option<U64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub arbiter_id: AccountId,
    pub token_id: AccountId,
    pub paused: bool,
    pub dispute_window_ns: U64,
    pub max_advance_bps: u16,
    pub approved_vendors: Vec<AccountId>,
}

/// `msg` payload for `ft_transfer_call` into the LOCA contract.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum TransferMsg {
    FundOrder {
        agent_id: AccountId,
        terms_hash: String,
        deadline: U64,
        /// Who owns the order (approves, disputes, gets refunds). Defaults to the sender;
        /// required when funding through NEAR Intents.
        #[serde(default)]
        customer_id: Option<AccountId>,
    },
    MakeOffer {
        order_id: u64,
        fee: U128,
        expires_at: U64,
        strategy: String,
        /// Who owns the offer. Defaults to the sender.
        #[serde(default)]
        lender_id: Option<AccountId>,
    },
    PostBond {
        agent_id: AccountId,
    },
}
