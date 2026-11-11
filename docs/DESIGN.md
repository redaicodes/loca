# LOCA design notes

Decisions that change the original concept note, and why.

## 1. What the lender actually underwrites

The customer's money is already escrowed, so the lender is not taking customer payment risk. It takes **delivery risk**: if the agent fails to deliver and the customer is refunded, the escrow pays the customer, not the lender. The score and lender strategies are built around that.

## 2. Self-dealing attack and mitigations

Attack: an operator controls the agent, a "customer" account and a "vendor" account. The customer funds $100, the agent borrows $30 paid to the vendor, never delivers, and the customer cancels after the deadline. The lender loses $30 and the attacker keeps it.

Mitigations in the contract:

- Loan proceeds go **directly to a vendor**, never to the agent.
- The vendor must be on the agent's operator-set policy **and** on the protocol's approved-vendor list (curated in the MVP).
- On-chain related-party checks: customer ≠ agent/operator, lender ≠ agent/operator/customer, vendor ≠ agent/operator.
- An optional **first-loss bond** (posted by anyone, typically the operator) covers lender shortfall before the lender takes a loss.
- An advance cap of `max_advance_bps` of the order (50% by default).

Not mitigated: off-chain related parties (separate accounts owned by the same person). Lenders should require a bond or a rated history; the score reports `UNRATED_INSUFFICIENT_HISTORY` and `CUSTOMER_CONCENTRATION`. A brand-new agent cannot get unsecured credit, and the demo does not claim it can.

## 3. Customer free-riding

If release depended only on customer approval, a customer could take the deliverable and never approve. Instead:

- After `mark_delivered`, anyone can `finalize` once the dispute window has passed.
- Disputes go to an arbiter, who rules a refund percentage.
- A customer can cancel only after the deadline, and only if nothing was delivered.

## 4. Repayment waterfall

```
customer_refund (arbiter ruling or cancel)
→ lender: min(principal + fee, remaining escrow)
→ shortfall covered by agent bond
→ any remaining shortfall is a default (recorded in stats)
→ agent keeps the rest
```

Every payout is credited to an internal balance and pulled with `withdraw()`. A failed `ft_transfer` restores the balance in the callback, so settlement is atomic.

## 5. LOCA Score is a contract view

`get_score(agent_id)` is deterministic and uses only on-chain stats, so anyone can recompute it. It returns the version (`v0`), component values, weights and reason codes. The weights are prototype rules.

| Component | Weight | Source |
|---|---|---|
| revenue_continuity | 30% | completed orders (cap 10), unique customers (cap 5) |
| repayment_history | 25% | repaid / repaid-with-bond / defaulted; neutral when there is no history |
| fulfillment | 20% | completed / (completed + refunded + disputes lost) |
| treasury_bond | 10% | bond / policy max principal |
| operator_controls | 10% | operator spend policy present |
| customer_diversity | 5% | unique customers / completed orders |

An agent is rated only with at least 3 completed orders and at least 2 unique customers.

## 6. NEAR Intents placement

Intents has no testnet (HACKATHON.md Q-007). The core loop runs on testnet with a test NEP-141 token. The Intents leg is a separate, clearly labelled mainnet step: a dry quote by default, plus one tiny real swap into USDC on NEAR, run only with explicit human approval.

Intents fits best on the **customer and lender funding** edges: pay or fund from any routable token. Repayment comes out of escrow automatically, so "repay in another token" is secondary.

Verified: 1Click's `customRecipientMsg` makes it withdraw with `ft_transfer_call`, so a cross-chain payment can open an order directly. Two consequences, both implemented:

- `sender_id` is the Intents contract, so `FundOrder` and `MakeOffer` carry an explicit `customer_id` or `lender_id`.
- 1Click warns that funds are lost if the receiver's `ft_on_transfer` fails. LOCA therefore never panics on a business-rule failure in `ft_on_transfer`. It credits the beneficiary's withdrawable balance and emits `deposit_rejected`.

1Click only quotes to recipients that exist on mainnet.

## 7. Changes after an outside review (2026-11-05)

A cold review of the public repo (fresh clone, README steps only) found four real problems. All four are fixed and covered by tests.

- **The bond belonged to nobody in particular.** `withdraw_bond` paid the agent and only checked for open loans, so an agent could take its operator's bond, or the bond could be pulled after lenders had priced bids on it but before a loan existed. Now only the operator can post a bond (anyone else's deposit is credited back), only the operator can withdraw it, the money goes back to the operator, and `request_credit` locks the bond until that request expires. Tests: `agent_cannot_take_operators_bond`, `bond_locked_while_lenders_may_bid_on_it`, `bond_returns_to_operator_after_lock_expires`, `only_the_operator_can_post_a_bond`.
- **One key ran the whole swarm.** Every swarm account, including the market contract, shared one full-access key, so the function-call-key story held only for the agent process, not the accounts. Now each account has its own key derived from a seed (`src/swarm/keys.ts`), agent accounts hold only their function-call key (no full-access key at all), and the market and token keys stay with the deployer, not the hosted worker.
- **State grew without bound, and the swarm topped up from the faucet.** Each order, bid and loan stayed in state forever, so the swarm's root paid roughly 45 testnet NEAR a day in storage and refilled from the faucet by creating and deleting throwaway accounts. Now `prune` (permissionless) removes settled orders older than six hours with their bids and loan, and returns the storage deposit to whoever paid it. Prices were cut to just above measured record sizes. Scores and market totals are kept in agent stats and `totals`, so pruning changes neither. The faucet code is gone.
- **The agents were all rules.** Seven lenders run fixed strategies. An eighth, the AI underwriter (`src/agents/underwriter.ts`), sends the same public record to a model on NEAR AI Cloud and bids with its answer. Replies that are malformed, outside 0.5–20% or above the borrower's cap are dropped, and the model's one-line reason is stored on chain in the offer's `strategy` field.

The upgrade was rehearsed on a local node before it touched testnet (`scripts/upgrade-rehearsal.ts`): deploy the previous build, trade on it, upgrade and `migrate`, then check that totals, agent records, scores, balances and open escrow survived and that the new rules hold on the migrated state.

## 8. Changes after a second review (2026-11-11)

A second cold review, run against the live testnet market, scored the project 80/100 and found four more logic flaws the scripted attacks didn't cover. All are fixed and tested, and the contract was upgraded in place again.

- **A stolen agent key could pay itself through the fee.** The agent may set `max_fee` up to the whole remaining escrow, so a thief could request a $50 advance with a $50 fee, bid from a lender it controls, and collect through the waterfall. Now each operator's policy carries a fee cap (`max_fee_bps`, 10% by default, at most 20%), checked in `request_credit` and again in `accept_offer`. Tests: `agent_cannot_request_a_fee_above_its_operators_cap`, `operator_sets_the_fee_cap_within_the_protocol_ceiling`.
- **Customers and lenders could be invented.** `FundOrder.customer_id` and `MakeOffer.lender_id` were taken at face value, so an operator could fund tiny orders "from" made-up accounts, finalize them after the window and get its agent rated. Now a deposit may name someone else only when it comes from an owner-approved forwarder (NEAR Intents), and the score's revenue component weighs dollar volume as well as count, with $50 of completed volume required to be rated. Tests: `nobody_but_a_forwarder_funds_in_someone_elses_name`, `nobody_but_a_forwarder_bids_in_someone_elses_name`, `dollar_orders_do_not_make_an_agent_rated`.
- **Orders could be left behind.** The keeper looked only at the newest 60 orders, and `prune` passed over open orders for good, so about a thousand old orders sat unsettled, some with open loans. Now anyone can cancel an undelivered order an hour after its deadline (the refund still goes to the customer) and close a dispute the arbiter left for three days; `prune_orders(ids)` removes orders that settled after the cursor passed; and the keeper sweeps all of history in windows of 100.
- **Bid slots could be jammed.** Withdrawn bids stayed in the order's list of ten, so ten bid-and-withdraw cycles closed an order to bidding for free. Now a withdrawn bid leaves the order (and its storage deposit goes back), and expired bids give up their slot when a new bid needs it. Test: `withdrawn_and_expired_bids_free_their_slots`.
- Smaller: a credit request lasts at most an hour, which bounds how long it locks the bond; the AI lender's on-chain reason is cut on a word boundary.

## 9. Changes after a third review (2026-11-12)

A third cold review scored the project 79/100. It found ways to hurt an agent cheaply, money the restricted agent keys could not move, and a few places where the docs and the chain disagreed. The contract was upgraded in place a third time (v6), after the same local rehearsal.

- **Anyone could sink an agent's score and tie up its storage.** An order could be due one second after it was funded, and a customer cancellation at the deadline counted as a failure. Now an order must give the agent at least ten minutes (`ERR_DEADLINE_TOO_SOON`). A cancellation counts against the agent only if it took the order on by asking for credit. An order cancelled before that has no bids or loan, so `prune_orders` removes it at once and the agent gets its storage deposit straight back. Operators can also raise the smallest order their agent takes (`set_order_minimum`). Tests: `an_order_gives_the_agent_at_least_ten_minutes`, `an_order_the_agent_never_took_on_does_not_count_and_frees_its_storage_at_once`, `a_missed_deadline_after_asking_for_credit_counts_against_the_agent`, `the_operator_sets_a_minimum_order`.
- **Agent earnings were stranded.** Agent keys can call only five market methods, so the USDC an agent withdrew sat in its own account and nobody could move it. Its prepaid storage NEAR was stuck the same way. Now `withdraw` pays an agent's balance to its operator, and the operator can take back the agent's storage NEAR (`withdraw_agent_storage`). A stolen key gains nothing from either. Tests: `agent_earnings_are_paid_to_the_operator`, `the_operator_takes_back_the_agents_storage_near`. Test USDC withdrawn under the old rule is still in the swarm agents' accounts; it is the project's own faucet token.
- **A forwarder could vouch for made-up customers.** With NEAR Intents, whoever pays writes the message, so the forwarder exception from the second review could bring invented customers back. Now an order a forwarder funds for someone else can hurt the agent's score but never help it: defaults, refunds and lost disputes count, while completions, revenue and repayments do not. Test: `forwarded_orders_can_hurt_the_score_but_never_help_it`.
- **A stolen key could keep the bond locked.** The bond was locked from the moment of a credit request, so repeated requests kept it frozen. Now only a funded bid locks it, and only until that bid can no longer be accepted. An operator who sees a stolen key sets `max_principal` to 0, which stops new requests, and the bond is free again within the hour. Test: `a_credit_request_alone_does_not_lock_the_bond`.
- **The contract paid for some records.** A rejected deposit created a balance record, and `withdraw` left a zero entry behind. Now a rejected deposit from anyone but a forwarder is handed back to the token contract, which refunds the sender and leaves no record. `withdraw` deletes the entry. Fee-cap, order-minimum and agent-customer records are charged to the agent. Test: `withdrawing_and_rejected_deposits_leave_no_balance_records`.
- **The score barely reacted to defaults.** Repayment history was the plain share of loans repaid, so 3% defaults still left 97%. Score v1 counts each default ten times: 2% defaults leave 80%, 10% leave nothing, and over 5% adds `HIGH_DEFAULT_RATE`. Test: `defaults_weigh_ten_times_a_repaid_loan`. The owner can now set the dispute window (`set_dispute_window`, 30 seconds to 7 days), and the keeper reads it from `get_config`, so the live market can give a silent customer real time to object.
- **Docs that the chain contradicted.** The reviewer read the market's token balance and its value locked a few blocks apart and found them $216 apart. The comment on `get_market` said they are always equal, which isn't quite true. `withdraw` takes the amount out of the totals before the token transfer lands, so for a block or two the balance is higher. Tokens sent with a plain `ft_transfer` would also stay in the balance without belonging to anyone. Read in the same block after the upgrade, the two matched to the cent ($241,900.49). The comment now says this. The guardrail runs that NEAR refuses before execution now link the transactions that added and removed the restricted key, so anyone can check its five methods.

## 10. Scope cuts

The registry, escrow and credit market are one contract. Out of scope: Chain Signatures, volatile collateral, partial fills and revolving facilities. The seven rule-based lender agents run three demo strategies, each with its own spread, on an open market; they are not presented as independent competition.

## Build plan

| Step | Status |
|---|---|
| Contract: identity, policy, escrow, offers, loans, waterfall, disputes, score | done (22 unit tests) |
| Test token (faucet NEP-141) + `cargo near` build script | done |
| TS client + sandbox simulation (`pnpm demo:sim`) | done, full loop verified on local nearcore 2.14 |
| Lender agents ×3 | done (6 TS tests) |
| Research agent (NEAR AI Cloud or offline) | done; NEAR AI endpoint/model not yet verified with a real key |
| Testnet run (`pnpm demo:testnet`) | done: `lmvwp2jlc-loca.loca-mvwp1z4g.testnet`, log in docs/testnet-run.json |
| Intents adapter: asset list, dry quote, status polling, failure paths | done; live dry quotes in docs/intents-quotes.json |
| Dashboard (style below), reads run log + live contract views | done |
| Demo video, X post, submission | done (submitted 2026-11-02) |
| Review fixes: bond ownership and lock, per-account keys, pruning with storage refunds, AI underwriter, CI | done (35 Rust, 16 TS tests) |
| Second review: fee cap, sender-only deposits, volume-weighted score, timeouts anyone can trigger, `prune_orders`, reclaimable bid slots | done (46 Rust, 17 TS tests) |
| Third review: ten-minute order window, cancellations that count only if the agent took the order, operator payouts, unscored forwarded orders, bid-time bond lock, refunded rejections, score v1 | done (57 Rust, 17 TS tests) |

Mainnet note: near-sdk 5.30 wasm imports nearcore 2.14 host functions. Testnet is on protocol 88, mainnet was on protocol 87 on 2026-11-05. A mainnet deploy would need an older near-sdk or a wait for mainnet to upgrade.

## UI style

The app borrows the NEAR Hackathon palette and type, not its announcement graphics:

- Warm paper background `#E9E0CB`, ink `#2A2520`, brand blue `#2A4C9C` (deep `#1F3A78`). Chart series, validated together for colour-blind separation: blue = customer escrow, `#8E4A9E` = lender money, `#C2662D` = agent and bond, `#3A9A5B` = claimable.
- Logo: the advance (short bar) stacked on the order that backs it (long bar), reading as an L, on a blue tile.
- Landing page: one animated centrepiece (a replay of a real settled loan from the contract), everything else quiet; live numbers count up once. Live values use tabular figures and fixed-size containers so nothing shifts when they update.
- Archivo for UI text and headings; IBM Plex Mono for amounts, account ids, hashes and labels.
- App layout: dark ink sidebar, sticky search bar, square 1px-bordered surfaces, no gradients or shadows.
- Pages: Overview, Agents (and agent detail), Orders (and order detail), Credit market, Lenders, Pay with any token, Activity.
