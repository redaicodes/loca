use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_000 * SEC;

fn usd(x: u128) -> u128 {
    x * 1_000_000
}
fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct World {
    c: Loca,
    t: u64,
    deposited: u128,
}

const ACCOUNTS: [&str; 10] = [
    "agent.near", "operator.near", "customer.near", "customer2.near", "customer3.near",
    "lender1.near", "lender2.near", "lender3.near", "vendor.near", "evil-vendor.near",
];

impl World {
    fn new() -> Self {
        let mut w = World { c: unsafe_init(), t: T0, deposited: 0 };
        w.as_("owner.near").c.add_vendor(acc("vendor.near"));
        w.as_("agent.near").c.register_agent(acc("operator.near"), "profile-hash".into());
        w.as_("operator.near")
            .c
            .set_spend_policy(acc("agent.near"), vec![acc("vendor.near")], U128(usd(50)));
        w
    }

    fn as_(&mut self, who: &str) -> &mut Self {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("loca.near"))
            .predecessor_account_id(acc(who))
            .block_timestamp(self.t)
            .build());
        self
    }

    fn ft(&mut self, from: &str, amount: u128, msg: Value) {
        self.deposited += amount;
        let _ = self.as_("usdc.near").c.ft_on_transfer(acc(from), U128(amount), msg.to_string());
    }

    fn fund_order(&mut self, customer: &str, amount: u128) -> u64 {
        let id = self.c.next_order_id;
        let deadline = self.t + 3_600 * SEC;
        self.ft(customer, amount, json!({ "FundOrder": { "agent_id": "agent.near", "terms_hash": "t", "deadline": U64(deadline) } }));
        id
    }

    fn request(&mut self, order_id: u64, amount: u128, max_fee: u128) {
        let exp = U64(self.t + 600 * SEC);
        self.as_("agent.near").c.request_credit(order_id, U128(amount), acc("vendor.near"), U128(max_fee), exp);
    }

    fn offer(&mut self, lender: &str, order_id: u64, principal: u128, fee: u128) -> u64 {
        let id = self.c.next_offer_id;
        let exp = U64(self.t + 300 * SEC);
        self.ft(lender, principal, json!({ "MakeOffer": { "order_id": order_id, "fee": U128(fee), "expires_at": exp, "strategy": "test" } }));
        id
    }

    fn bal(&self, who: &str) -> u128 {
        self.c.get_balance(acc(who)).0
    }

    /// Every token the contract received is accounted for exactly once.
    fn assert_conserved(&self) {
        let mut held = 0u128;
        for id in 0..self.c.next_order_id {
            let o = self.c.get_order(id).unwrap();
            if matches!(o.status, OrderStatus::Funded | OrderStatus::Delivered | OrderStatus::Disputed) {
                held += o.amount.0;
            }
        }
        for id in 0..self.c.next_offer_id {
            let o = self.c.get_offer(id).unwrap();
            if o.status == OfferStatus::Open {
                held += o.principal.0;
            }
        }
        held += self.c.get_agent(acc("agent.near")).unwrap().bond.0;
        for a in ACCOUNTS {
            held += self.bal(a);
        }
        assert_eq!(held, self.deposited, "token conservation violated");
        // The running totals must agree with state and with the contract's token balance.
        let t = self.c.get_market().totals;
        let mut escrow = 0u128;
        for id in 0..self.c.next_order_id {
            let o = self.c.get_order(id).unwrap();
            if matches!(o.status, OrderStatus::Funded | OrderStatus::Delivered | OrderStatus::Disputed) {
                escrow += o.amount.0;
            }
        }
        assert_eq!(t.escrow_held.0, escrow, "escrow_held drift");
        assert_eq!(t.bonds_held.0, self.c.get_agent(acc("agent.near")).unwrap().bond.0, "bonds_held drift");
        let claimable: u128 = ACCOUNTS.iter().map(|a| self.bal(a)).sum();
        assert_eq!(t.claimable.0, claimable, "claimable drift");
        assert_eq!(t.escrow_held.0 + t.offers_open.0 + t.bonds_held.0 + t.claimable.0, self.deposited, "value locked drift");
        let outstanding: u128 = self.c.get_loans(None, None).iter().filter(|l| l.status == LoanStatus::Active).map(|l| l.principal.0).sum();
        assert_eq!(t.outstanding.0, outstanding, "outstanding drift");
    }
}

fn unsafe_init() -> Loca {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("loca.near"))
        .predecessor_account_id(acc("owner.near"))
        .block_timestamp(T0)
        .build());
    Loca::new(acc("owner.near"), acc("arbiter.near"), acc("usdc.near"), 600, 5_000)
}

/// Build a track record: `n` completed orders spread across customers.
fn seed_history(w: &mut World, n: usize) {
    let customers = ["customer.near", "customer2.near", "customer3.near"];
    for i in 0..n {
        let c = customers[i % customers.len()];
        let id = w.fund_order(c, usd(20));
        w.as_("agent.near").c.mark_delivered(id, "d".into());
        w.as_(c).c.approve(id);
    }
}

#[test]
fn happy_path_waterfall_and_score_improves() {
    let mut w = World::new();
    seed_history(&mut w, 3);
    let before = w.c.get_score(acc("agent.near")).unwrap();
    assert!(before.rated);

    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o1 = w.offer("lender1.near", order, usd(30), usd(2));
    let o2 = w.offer("lender2.near", order, usd(30), usd(1));
    let o3 = w.offer("lender3.near", order, usd(30), usd(3));
    w.assert_conserved();

    w.as_("agent.near").c.accept_offer(o2);
    assert_eq!(w.bal("vendor.near"), usd(30));
    assert_eq!(w.bal("lender1.near"), usd(30)); // losing bids returned
    assert_eq!(w.bal("lender3.near"), usd(30));
    assert_eq!(w.c.get_offer(o1).unwrap().status, OfferStatus::Withdrawn);
    assert_eq!(w.c.get_offer(o3).unwrap().status, OfferStatus::Withdrawn);
    w.assert_conserved();

    w.as_("agent.near").c.mark_delivered(order, "report".into());
    w.as_("customer.near").c.approve(order);
    assert_eq!(w.bal("lender2.near"), usd(31));
    // 3 seeded orders x $20 + $69 from this one.
    assert_eq!(w.bal("agent.near"), usd(60) + usd(69));
    let loan = w.c.get_loan(0).unwrap();
    assert_eq!(loan.status, LoanStatus::Repaid);
    w.assert_conserved();

    let after = w.c.get_score(acc("agent.near")).unwrap();
    assert!(after.score > before.score, "{} !> {}", after.score, before.score);
    assert!(before.reason_codes.contains(&"NO_CREDIT_HISTORY".to_string()));
    assert!(!after.reason_codes.contains(&"NO_CREDIT_HISTORY".to_string()));

    let m = w.c.get_market();
    assert_eq!(m.agents, 1);
    assert_eq!((m.totals.orders, m.totals.orders_settled, m.totals.offers_made), (4, 4, 3));
    assert_eq!(m.totals.escrow_volume, U128(usd(160)));
    assert_eq!((m.totals.originated, m.totals.outstanding), (U128(usd(30)), U128(0)));
    assert_eq!((m.totals.fees_paid, m.totals.repaid_to_lenders), (U128(usd(1)), U128(usd(31))));
    assert_eq!(w.c.get_agents(None, None)[0].score.score, after.score);
    assert_eq!(w.c.get_orders(Some(2), Some(10)).len(), 2);
    assert_eq!(w.c.get_offer_list(None, None).len(), 3);
}

#[test]
fn new_agent_is_unrated() {
    let w = World::new();
    let s = w.c.get_score(acc("agent.near")).unwrap();
    assert!(!s.rated);
    assert!(s.reason_codes.contains(&"UNRATED_INSUFFICIENT_HISTORY".to_string()));
}

#[test]
#[should_panic(expected = "ERR_EXCEEDS_ADVANCE_RATE")]
fn advance_rate_is_capped() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(51), usd(1));
}

#[test]
#[should_panic(expected = "ERR_EXCEEDS_POLICY")]
fn operator_policy_caps_principal() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(200));
    w.request(order, usd(60), usd(1));
}

#[test]
fn operator_cannot_be_customer() {
    let mut w = World::new();
    w.fund_order("operator.near", usd(100));
    assert!(w.c.get_order(0).is_none());
    // Rejected deposits are credited back, never stranded.
    assert_eq!(w.bal("operator.near"), usd(100));
    w.assert_conserved();
}

#[test]
fn intents_deposit_funds_order_for_named_customer() {
    let mut w = World::new();
    w.deposited += usd(100);
    let msg = json!({ "FundOrder": { "agent_id": "agent.near", "terms_hash": "t",
        "deadline": U64(w.t + 3_600 * SEC), "customer_id": "customer.near" } });
    let _ = w.as_("usdc.near").c.ft_on_transfer(acc("intents.near"), U128(usd(100)), msg.to_string());
    let order = w.c.get_order(0).unwrap();
    assert_eq!(order.customer_id, acc("customer.near"));
    w.assert_conserved();
}

#[test]
fn intents_deposit_with_bad_terms_credits_beneficiary() {
    let mut w = World::new();
    w.deposited += usd(100);
    let msg = json!({ "FundOrder": { "agent_id": "nobody.near", "terms_hash": "t",
        "deadline": U64(w.t + 3_600 * SEC), "customer_id": "customer.near" } });
    let _ = w.as_("usdc.near").c.ft_on_transfer(acc("intents.near"), U128(usd(100)), msg.to_string());
    assert_eq!(w.bal("customer.near"), usd(100));
    assert_eq!(w.bal("intents.near"), 0);
    w.assert_conserved();
}

#[test]
#[should_panic(expected = "ERR_VENDOR_NOT_APPROVED")]
fn vendor_must_be_protocol_approved() {
    let mut w = World::new();
    w.as_("operator.near")
        .c
        .set_spend_policy(acc("agent.near"), vec![acc("evil-vendor.near")], U128(usd(50)));
    let order = w.fund_order("customer.near", usd(100));
    let exp = U64(w.t + 60 * SEC);
    w.as_("agent.near").c.request_credit(order, U128(usd(30)), acc("evil-vendor.near"), U128(usd(1)), exp);
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn agent_cannot_change_own_policy() {
    let mut w = World::new();
    w.as_("agent.near")
        .c
        .set_spend_policy(acc("agent.near"), vec![acc("vendor.near")], U128(usd(1_000)));
}

#[test]
#[should_panic(expected = "ERR_OFFER_EXPIRED")]
fn expired_offer_cannot_be_accepted() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.t += 301 * SEC;
    w.as_("agent.near").c.accept_offer(o);
}

#[test]
#[should_panic(expected = "ERR_OFFER_NOT_OPEN")]
fn order_cannot_be_pledged_twice() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o1 = w.offer("lender1.near", order, usd(30), usd(1));
    let o2 = w.offer("lender2.near", order, usd(30), usd(2));
    w.as_("agent.near").c.accept_offer(o1);
    w.as_("agent.near").c.accept_offer(o2);
}

#[test]
#[should_panic(expected = "ERR_PAUSED")]
fn kill_switch_blocks_new_draws() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("owner.near").c.set_paused(true);
    w.as_("agent.near").c.accept_offer(o);
}

#[test]
fn customer_cannot_lend_against_own_order() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    w.offer("customer.near", order, usd(30), usd(1));
    assert!(w.c.get_offers(order).is_empty());
    assert_eq!(w.bal("customer.near"), usd(30));
    w.assert_conserved();
}

#[test]
fn silent_customer_auto_release_after_window() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("agent.near").c.accept_offer(o);
    w.as_("agent.near").c.mark_delivered(order, "report".into());
    w.t += 601 * SEC;
    w.as_("lender1.near").c.finalize(order);
    assert_eq!(w.bal("lender1.near"), usd(31));
    assert_eq!(w.bal("agent.near"), usd(69));
    w.assert_conserved();
}

#[test]
#[should_panic(expected = "ERR_DISPUTE_WINDOW_OPEN")]
fn cannot_finalize_inside_window() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.as_("agent.near").c.mark_delivered(order, "r".into());
    w.as_("anyone.near").c.finalize(order);
}

#[test]
fn lost_dispute_bond_covers_lender_then_default() {
    let mut w = World::new();
    w.ft("operator.near", usd(10), json!({ "PostBond": { "agent_id": "agent.near" } }));
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("agent.near").c.accept_offer(o);
    w.as_("agent.near").c.mark_delivered(order, "bad report".into());
    w.as_("customer.near").c.dispute(order, "reason".into());
    w.as_("arbiter.near").c.resolve_dispute(order, 10_000);

    assert_eq!(w.bal("customer.near"), usd(100));
    assert_eq!(w.bal("lender1.near"), usd(10)); // bond only
    let loan = w.c.get_loan(0).unwrap();
    assert_eq!(loan.status, LoanStatus::Defaulted);
    assert_eq!(loan.recovered_from_bond, U128(usd(10)));
    let agent = w.c.get_agent(acc("agent.near")).unwrap();
    assert_eq!(agent.bond, U128(0));
    assert_eq!(agent.stats.loans_defaulted, 1);
    assert_eq!(agent.stats.default_loss, U128(usd(21)));
    assert_eq!(w.c.get_order(order).unwrap().status, OrderStatus::Refunded);
    let s = w.c.get_score(acc("agent.near")).unwrap();
    assert!(s.reason_codes.contains(&"DEFAULT_ON_RECORD".to_string()));
    let t = w.c.get_market().totals;
    assert_eq!((t.loans, t.loans_defaulted, t.loans_repaid), (1, 1, 0));
    assert_eq!(t.default_loss, U128(usd(21)));
    assert_eq!(t.bond_drawn, U128(usd(10)));
    assert_eq!(t.repaid_to_lenders, U128(usd(10)));
    assert_eq!((t.orders_disputed, t.orders_refunded), (1, 1));
    assert_eq!(t.fees_paid, U128(0));
    w.assert_conserved();
}

#[test]
fn partial_refund_lender_still_whole() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("agent.near").c.accept_offer(o);
    w.as_("agent.near").c.mark_delivered(order, "r".into());
    w.as_("customer.near").c.dispute(order, "late".into());
    w.as_("arbiter.near").c.resolve_dispute(order, 5_000);
    assert_eq!(w.bal("customer.near"), usd(50));
    assert_eq!(w.bal("lender1.near"), usd(31));
    assert_eq!(w.bal("agent.near"), usd(19));
    assert_eq!(w.c.get_loan(0).unwrap().status, LoanStatus::Repaid);
    w.assert_conserved();
}

#[test]
fn missed_deadline_customer_cancels() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("agent.near").c.accept_offer(o);
    w.t += 3_601 * SEC;
    w.as_("customer.near").c.cancel_order(order);
    assert_eq!(w.bal("customer.near"), usd(100));
    assert_eq!(w.c.get_loan(0).unwrap().status, LoanStatus::Defaulted);
    w.assert_conserved();
}

#[test]
#[should_panic(expected = "ERR_BEFORE_DEADLINE")]
fn customer_cannot_cancel_early() {
    let mut w = World::new();
    let order = w.fund_order("customer.near", usd(100));
    w.as_("customer.near").c.cancel_order(order);
}

#[test]
#[should_panic(expected = "ERR_ACTIVE_LOANS")]
fn bond_locked_while_loan_active() {
    let mut w = World::new();
    w.ft("operator.near", usd(10), json!({ "PostBond": { "agent_id": "agent.near" } }));
    let order = w.fund_order("customer.near", usd(100));
    w.request(order, usd(30), usd(3));
    let o = w.offer("lender1.near", order, usd(30), usd(1));
    w.as_("agent.near").c.accept_offer(o);
    w.as_("agent.near").c.withdraw_bond(U128(usd(10)));
}

#[test]
#[should_panic(expected = "ERR_WRONG_TOKEN")]
fn rejects_other_tokens() {
    let mut w = World::new();
    let _ = w.as_("fake-usdc.near").c.ft_on_transfer(
        acc("customer.near"),
        U128(usd(100)),
        json!({ "FundOrder": { "agent_id": "agent.near", "terms_hash": "t", "deadline": U64(T0 + SEC) } }).to_string(),
    );
}

#[test]
fn withdraw_zeroes_balance_before_transfer() {
    let mut w = World::new();
    let o = w.fund_order("customer.near", usd(20));
    w.as_("agent.near").c.mark_delivered(o, "d".into());
    w.as_("customer.near").c.approve(o);
    let _ = w.as_("agent.near").c.withdraw();
    assert_eq!(w.bal("agent.near"), 0);
}
