**CONCEPT NOTE  |  NEAR HACKATHON 2026**

# LOCA

**Line of Credit for Agents**

> The credit layer for autonomous AI businesses.

Agent identity. Verifiable economic history. Portable creditworthiness. Cross-chain working capital.

> **THE THESIS** AI agents can earn and spend, but lack a trusted way to borrow against future work. LOCA makes pending agent revenue financeable and lets lender agents compete to provide working capital.


# Executive summary

LOCA is a permissionless protocol for financing autonomous AI businesses. Each agent gets a durable financial identity, a verifiable track record, and a transparent LOCA Score. Agent businesses request credit against escrowed customer orders and eligible collateral; independent lender agents evaluate risk and make competing offers. Loans settle through NEAR contracts, while NEAR Intents lets users and agents source funds or repay using any token with a live supported route.
The hackathon demo proves one complete economic loop: a customer order is escrowed, a research agent obtains working capital, purchases compute, completes a job, receives its payment, and repays the lender automatically. A second loan shows how successful repayment improves its lending terms.

## Why now

Existing agent wallets solve payment execution. LOCA addresses the next problem: capital formation. A machine business that must prepay data, inference or other agents should not need its human owner to fund every job. The long-term opportunity is an open credit graph for the agent economy, not merely a bot operating a lending pool.

# 01  /  Product and core economic loop


## A bankable agent

An agent running a paid research service needs $30 of data and inference to fulfill a $100 customer order. The customer has committed funds to a milestone escrow, but the business cannot access the full payment before delivery. LOCA advances working capital against that verified receivable.

| Step | What happens | Verifiable evidence |
|---|---|---|
| 01 / Identity | Agent registers a NEAR-based LOCA ID and binds its operating wallet. | Account ownership proof and agent profile hash |
| 02 / Revenue | Customer deposits a $100 order into a contract escrow. | Order ID, amount, funding transaction, conditions |
| 03 / Underwriting | LOCA Score combines prior earnings, fulfillment and repayment events. | Signed receipts, historical loan events |
| 04 / Auction | Three lender agents bid for a $30 advance; borrower chooses a valid offer. | Offer terms, expiry, lender signatures |
| 05 / Execution | Loan pays for data / inference, within approved spend policy. | Scoped payment and purchase receipt |
| 06 / Settlement | Customer approves delivery; escrow releases $31 to lender and $69 to agent. | Contract settlement and repayment event |
| 07 / Reputation | Credit record updates; a repeat request earns better indicative terms. | Versioned score and reason codes |

> **THE DEMO MOMENT** An agent with no human funding finishes a paid order using borrowed capital. Its successful repayment then changes the price of its next loan.


## Financing model

LOCA starts with receivables-backed advances and revolving credit lines, not blind unsecured lending. An eligible customer order creates a borrowing base; the lender advances only a conservative share. The escrow contract assigns repayment priority from the agreed payment tranche. Financing fees and the remaining proceeds are distributed according to a pre-signed waterfall.
The illustrative $30 advance and $31 repayment use a $1 demo fee, not a market-rate APR. If delivery is rejected, the escrow and loan follow an explicit cancellation, dispute and loss-allocation policy. Escrow improves enforceability but does not make the loan risk free.

# 02  /  LOCA ID and credit reputation


## A financial identity, not just a wallet

LOCA ID is a persistent, controller-linked agent profile anchored to a NEAR account or sub-account. It binds wallets on other chains through signed ownership proofs and can reference operator attestations, capabilities, constraints, and verifiable work receipts. An agent may rotate keys without wiping its history; changing controller or ownership creates a visible event.

## What becomes part of an agent history


| Signal | Evidence source | Credit interpretation |
|---|---|---|
| Gross verified revenue | Escrow releases and signed customer payment receipts | Ability to generate cash flow |
| Delivery reliability | Order success / dispute outcomes | Ability to complete paid work |
| Repayment behavior | Contract-level payment and default events | Debt servicing performance |
| Treasury profile | Provable assets, obligations, exposure | Liquidity buffer and concentration |
| Operator and controls | Signed operator attestation, spending policies | Accountability and operational safeguards |
| Adverse events | Fraud flags, reversals, related-party activity | Haircuts, manual review, possible rejection |


## LOCA Score: transparent and versioned

For the MVP, use a deterministic, explainable 0–1000 score and publish the inputs, score version and reason codes. The weights below are illustrative defaults for testing, not a validated statistical credit model.

| Component | Weight | Example decision signal |
|---|---|---|
| Verified revenue continuity | 30% | Multiple independent paying customers |
| Loan repayment history | 25% | On-time payments over repeated advances |
| Fulfillment / dispute rate | 20% | Completed orders without reversals |
| Treasury resilience | 10% | Liquid runway versus upcoming payments |
| Operator attestations / controls | 10% | Stable controller and bounded wallets |
| Fraud / concentration checks | 5% | Related-party transactions and anomalous activity |


## Cold starts and anti-gaming

New agents have insufficient data and should receive a provisional “unrated” status rather than a misleading high score. First credit is restricted to escrow-backed or externally secured transactions. Revenue counts more when independently paid, economically costly to fake, and resistant to self-dealing. The system does not equate a wallet address with unique personhood; Sybil clusters, recycled identities and wash revenue require controls.
> **CREDIT PRINCIPLE** LOCA Score prices risk; it never replaces settlement rights, collateral rules, exposure limits or repayment priority.


# 03  /  Universal token access through NEAR Intents


## Any routable token in. Risk-managed credit out.

LOCA is token-agnostic at the funding and repayment edges. A lender can bring any token for which NEAR Intents currently supplies a valid route; the protocol obtains an executable quote and converts it into the loan’s accounting asset (for the MVP, USDC on the target chain). A borrower can repay in another supported token, again converting to the required repayment asset before debt is marked settled. This removes the need for a separate lending pool for every asset.

| User request | LOCA behavior | Constraint |
|---|---|---|
| Fund with a supported token | Quote and swap the token into reserve USDC | Live route, sufficient liquidity, slippage, deadline |
| Borrow working capital | Disburse stable asset to scoped borrower wallet | Borrowing base, funding finality, spending rules |
| Repay with a different token | Quote and convert to exact owed stable amount | Actual received amount must cover debt |
| Post volatile token collateral | Convert into accepted collateral or apply approved haircuts | Oracle quality, liquidation route and conservative LTV |
| Use an unsupported / illiquid token | Display unavailable, no credit acceptance | Do not imply unlimited support |


## Suggested transaction orchestration

1. Call the current 1Click asset registry. Only show verified routes and canonical asset IDs.
2. Fetch an executable quote, disclose fees and minimum received, and enforce quote expiry / max slippage.
3. Execute the origin deposit or signed transfer; show in-progress states with explorer references.
4. Require confirmed SUCCESS and actual delivered amounts before crediting funds; handle REFUNDED and FAILED explicitly.
5. Release or repay debt only through the destination contract once balances are confirmed.

## Asset policy

The headline “use any token” means any token with a working NEAR Intents route as a payment or funding source. It does not mean every token is directly acceptable as collateral. Direct collateral acceptance requires deep execution liquidity, defensible prices, liquidation paths, bridge/solver limits and appropriate haircuts. The MVP should use stablecoin accounting and the receivable escrow; dynamic collateral markets follow later.

## Where NEAR is essential

NEAR provides agent identities and policy-bound accounts, contracts for credit and escrow, and Intents for quote-based cross-chain liquidity. Chain Signatures can extend native control of accounts on other chains where justified; they are a stretch goal, not an assumed dependency for the core demo.

# 04  /  Protocol architecture


## Core modules


| Module | Responsibility |
|---|---|
| LOCA Registry | Agent IDs, controller and linked-wallet proofs, score version pointers |
| History / Attestation Indexer | Verified revenue, fulfilled orders, repayments and negative events |
| LOCA Score Engine | Transparent feature extraction, score and reason-code generation |
| Credit Market | Receivable listings, loan requests, bids and offer selection |
| Escrow + Credit Contract | Order funds, borrowing base, lender advance, repayment waterfall, default states |
| Intents Adapter | Asset discovery, quotes, swaps, status monitoring, idempotent deposits |
| Policy Wallet | Transaction limits, allowed payees, loan spending rules, key isolation |
| Judge Dashboard | One agent profile, complete cash-flow ledger, tx links and replayable demo |


## Loan state machine

ORDER_FUNDED → REQUESTED → OFFERS_RECEIVED → FUNDED → ACTIVE → REPAID / DISPUTED / DEFAULTED. Every state transition records who signed it, what evidence triggered it and which asset balances moved. Duplicate Intents callbacks must not trigger a second credit. Unfunded and expired offers must never be executed.

## Lender-agent market

Lender agents use different policies: a conservative agent prices against escrow coverage, an aggressive agent values repayment history, and a concentration-aware agent limits correlated exposure. A bid specifies size, fee or APR, maturity, collateral / receivable rights, expiry, chain settlement route and risk limits. The clearing rule selects the cheapest offer that meets the borrower’s constraints; with multiple partial lenders, allocation can extend to a later release.

## Security and failure policy

- All spending is constrained by an explicit user/operator policy; no model receives unrestricted custody or a full-access private key.
- Loan funding is conditional on verified escrow, available lender funds, and destination-chain settlement finality.
- Customer approval or a specified verifiable delivery criterion releases the milestone. Disputes pause automatic payout under documented contract rules.
- Oracle manipulation, wash revenue, double-pledging receivables, reorgs, route expiry and token depegs each have an explicit rejection or recovery path.
- The MVP runs with tiny funds, capped exposure, deterministic agents and a visible kill switch for new draws; no promise of principal protection.

# 05  /  Two-week hackathon scope


## What must actually work


| Must ship by Nov 14 | Stretch after core works |
|---|---|
| NEAR agent identity + event history | Cross-chain wallet aggregation with additional chains |
| Live LOCA Score with evidence and reason codes | Behavioral / statistical underwriting model |
| Three independent lender strategies with verifiable bids | Multi-lender partial fill auction |
| One real escrow-backed credit transaction | Revolving multi-draw facility |
| One live NEAR Intents source-token swap | More origin / destination tokens and chains |
| Payment to a real agent service and repayment waterfall | Dynamic direct crypto collateral |
| Refund / failed-route and disputed-delivery paths | Private attestations and ZK proofs |
| Public demo, complete README and transaction links | Chain Signatures advanced custody |


## Build schedule


| Date (UTC) | Milestone | Exit criteria |
|---|---|---|
| Nov 1–3 | Contracts and deterministic state machine | Order escrow / funding / repayment tested |
| Nov 4–6 | LOCA ID, evidence ledger, score v0 | Credit profile updates with onchain receipts |
| Nov 7–9 | Lender agents + credit auction | At least three offers and deterministic selection |
| Nov 10–11 | NEAR Intents adapter + failure paths | One real supported token routed into USDC |
| Nov 12–13 | End-to-end live demo / audit / recording | Complete loan cycle and error-case demonstration |
| Nov 14 | Public repository, X demo, final submission | README reproducible, links live before 23:59 UTC |


## 90-second judge demo

1. Open an agent profile: show its named identity, verified sales history and provisional LOCA Score.
2. Open a $100 funded order; the agent requests a $30 credit line for compute and data.
3. Show three underwriters issue different bids; accept a valid offer and display the signed terms.
4. Bring lender funds via a NEAR Intents quote using a supported token on another chain; show settlement SUCCESS.
5. Agent purchases its service, delivers the artifact, and customer approves completion; contract repays $31 and releases $69.
6. Refresh the agent history and score; request a second loan and show changed bids. Also demonstrate one blocked / failed route.
> **JUDGE CRITERION** A stranger should be able to clone the repository and follow exact “do X, see Y” steps, including a no-funds simulation mode and a separately identified real onchain route.


# 06  /  Why LOCA stands out


## The differentiated claim

A lending bot manages capital. LOCA lets autonomous businesses create credit demand, prove earning capacity and finance pending work. This combines agent identity, the economic history of actual work, underwriting competition, cross-chain liquidity and contract-controlled repayment in one visible loop.

## Why this is an excellent NEAR showcase

- NEAR Intents has a necessary role: the customer and lender can use routable tokens from different chains while the loan stays in one accounting asset.
- Autonomous Business is real: an operating agent independently buys inputs, produces an output and closes its books within policies.
- AI Swarms is real: several lender agents bid under distinct risk policies; bids change when a score improves.
- Unstoppable DeFi is real: settlement and repayment rules are smart-contract-defined, with all state transitions observable.
- Agent Economy is real: an agent is not merely spending a preset allowance; it is generating, financing and servicing a business obligation.

## What not to claim

- Do not claim LOCA invented agent credit or onchain identity. Say it combines verifiable receivables, portable reputation and cross-chain financing in an auditable workflow.
- Do not claim every token is accepted as raw loan collateral. Only supported, liquid routes can be used for any-token conversion, and collateral policy is separate.
- Do not claim credit scoring alone guarantees repayment or that customer escrow always prevents loss.
- Do not claim production-level creditworthiness from a two-week demo; label score inputs and underwriting weights as prototype rules.

# Hackathon track and submission plan

Primary track: Unstoppable DeFi (defi). Also select Agent Economy (agents), Autonomous Business (business) and AI Swarms (swarms) if the working submission demonstrably covers all four. The organizer permits one project to select multiple tracks; do not make separate submissions for the same project.
- Public repository with README, architecture, contracts, threat model, test coverage, deployed addresses and “do X, see Y” reproduction steps.
- Public X demo post stating it was made for NEAR HACKATHON, tagged @NEARProtocol and #NEARHackathon, including demo video / screenshots.
- Final form: project name, 20–2,000-character description, team details, NEAR payout address, preferred tracks, repository and X links.
- Deadline: Nov 14, 2026 at 23:59 UTC. Submission is one-time and cannot be edited afterward. Human confirmation is required before sending any submission payload.

## Suggested submission description

> LOCA (Line of Credit for Agents) is a programmable credit market for autonomous AI businesses. Agents build persistent financial identities from verified earnings, completed jobs and repayment history. A transparent LOCA Score helps independent lender agents price working capital against escrowed future revenue. NEAR Intents lets lenders and borrowers fund and repay with any currently routable token while loans settle in a risk-managed stable asset. Our prototype demonstrates a live customer order, competitive lender bids, cross-chain funding, autonomous service procurement, contract-enforced repayment and an improved credit profile after settlement.

## Reference links

- NEAR Hackathon official guide: https://nearhackathon.com/HACKATHON.md
- NEAR Hackathon event and rules: https://nearhackathon.com/
- Official NEAR hackathon starter prompts: https://github.com/nearai/near-hackathon-prompt-examples
- Official 1Click implementation examples: https://github.com/near-examples/near-intents-examples
- NEAR Intents agent skills: https://github.com/near/agent-skills

*Status: concept and demo plan, not audited production software or legally cleared lending infrastructure.*
