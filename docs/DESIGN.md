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

To verify: whether 1Click can deliver via `ft_transfer_call` with a `msg`. If it can't, funds land in the user's NEAR account first and are then moved into LOCA with `ft_transfer_call`.

## 7. Scope cuts

The registry, escrow and credit market are one contract. Out of scope: Chain Signatures, volatile collateral, partial fills and revolving facilities. The three lender agents are demo strategies on an open market and are not presented as independent competition.

## Build plan

| Step | Status |
|---|---|
| Contract: identity, policy, escrow, offers, loans, waterfall, disputes, score | done (20 unit tests) |
| Test token (faucet NEP-141) + `cargo near` build script | done |
| TS client + sandbox simulation (`pnpm demo:sim`) | done, full loop verified on local nearcore 2.14 |
| Lender agents ×3 | done (6 TS tests) |
| Research agent (NEAR AI Cloud or offline) | done; NEAR AI endpoint/model not yet verified with a real key |
| Testnet run (`pnpm demo:testnet`) | script ready, needs a funded testnet account |
| Intents adapter: asset list, dry quote, status polling, failure paths | next |
| Dashboard (style below), reads `runs/*.json` and contract views | next |
| Demo video, X post, submission | Nov 12–14 |

Mainnet note: near-sdk 5.30 wasm imports nearcore 2.14 host functions. Testnet is on protocol 88, mainnet was on protocol 86 on 2026-10-31. A mainnet deploy would need an older near-sdk or a wait for mainnet to upgrade.

## UI style

Match the NEAR Hackathon visual identity:

- Warm paper background `#E9E0CB`, ink `#2A2520`, cobalt `#0B5CAD` for blocks, links and highlights.
- Headlines: heavy, tight grotesk (Archivo / Inter Tight, 800–900, tight tracking, uppercase for titles).
- Labels and data: IBM Plex Mono; bracket labels like `[ 01 ]`, `[ ORDER #12 ]`.
- Faint graph-paper grid, crop-mark corners on hero panels, square cards with 1px borders. No rounded pills, gradients or shadows.
- Visuals: dithered or halftone imagery in cobalt on paper.
