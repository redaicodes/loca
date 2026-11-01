<div align="center">

<img src="https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/loca-mark.svg" width="64" alt="Loca">

# Loca

**A line of credit for AI agents, on NEAR.**

An agent borrows against an order its customer has already paid into escrow.<br>
Lender agents bid on the advance. The escrow pays them back before the agent gets paid.

[![Live on NEAR testnet](https://img.shields.io/badge/NEAR-live%20on%20testnet-00EC97?logo=near&logoColor=white)](https://testnet.nearblocks.io/address/market.loca-swarm-mvwu8dfo.testnet)
[![NEAR Hackathon 2026](https://img.shields.io/badge/NEAR%20HACKATHON-Nov%202026-1e1e1e)](https://x.com/hashtag/NEARHackathon)
[![Open the app](https://img.shields.io/badge/app-open%20live%20demo-2A4C9C)](https://loca.loca-ai.workers.dev)
[![Contract: Rust](https://img.shields.io/badge/contract-Rust%20%C2%B7%20near--sdk%205.30-B7410E?logo=rust&logoColor=white)](contracts/loca/src/lib.rs)
[![TypeScript](https://img.shields.io/badge/agents-TypeScript-3178C6?logo=typescript&logoColor=white)](src/agents/lenders.ts)
[![Hosted on Cloudflare Workers](https://img.shields.io/badge/hosted-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](worker/swarm.ts)
[![Tests: 40 passing](https://img.shields.io/badge/tests-28%20Rust%20%2B%2012%20TS-2ea44f)](#run-it-yourself)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

**Tracks:** `agents` · `defi` · `swarms` · `security` · `business`

[Live app](https://loca.loca-ai.workers.dev) · [Live swarm](https://loca.loca-ai.workers.dev/#/app/swarm) · [Launch video](https://loca.loca-ai.workers.dev/loca-launch.mp4) · [Market contract](https://testnet.nearblocks.io/address/market.loca-swarm-mvwu8dfo.testnet) · [Design notes](docs/DESIGN.md)

</div>

<br>

[![Watch the 84-second launch video](https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/video-poster.jpg)](https://loca.loca-ai.workers.dev/loca-launch.mp4)

<p align="center"><sub>Click to play the launch video (84 s, with sound).</sub></p>

## The problem

AI agents already sell work: research, code review, translation, support. Most jobs cost money before they pay. The agent has to buy data, compute or API calls first, and nobody lends to an agent. It has no credit history, no legal identity, and nothing a lender can hold onto.

An agent with a paid order does have one solid asset: the customer's money, sitting in escrow, waiting for delivery. Loca turns that into collateral.

## How a loan works

![An order on Loca: escrow, lender bids, vendor payment, delivery and repayment](https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/flow.gif)

1. **Nova** (a customer agent) hires **Atlas** (a research agent) and pays $100 into escrow on the Loca contract.
2. Atlas needs $30 of data to do the job, so it requests an advance against that order.
3. Lender agents send fully funded bids. Atlas accepts the cheapest one.
4. The loan pays the data vendor directly. Atlas never touches the borrowed money.
5. Atlas delivers. Nova approves, or anyone can finalize once the dispute window passes.
6. The escrow repays the lender (principal plus fee) first, and Atlas keeps the rest.
7. The outcome is written to Atlas's onchain record, and its **LOCA Score** moves. A better record gets cheaper bids next time.

If Atlas never delivers, Nova cancels after the deadline. The operator's first-loss bond covers the lender, and whatever is left is recorded as a default that every future lender can see.

## Try it in your browser

Nothing to install. A swarm of agents trades on the testnet contract around the clock, so the numbers change while you watch.

| Do | See |
|---|---|
| Open the [live app](https://loca.loca-ai.workers.dev) | Value locked, credit originated, loans and repayment rate, all read from the contract. The "Order replay" window steps through a real settled loan. |
| Open [Live swarm](https://loca.loca-ai.workers.dev/#/app/swarm) | Customers, agents, lenders and vendors as a graph. Lines pulse as escrows, loans and vendor payments land; the event stream adds a row every few seconds. |
| Click any agent, e.g. [Quill Translate](https://loca.loca-ai.workers.dev/#/app/agents/quill.loca-swarm-mvwu8dfo.testnet) | Its LOCA Score with the six components and reason codes, its spend policy, and its function-call key read live from NEAR. |
| Click any order number, then a "tx" link | The order's lifecycle (escrow, bids, loan, delivery, settlement) and each transaction on testnet.nearblocks.io. |
| Open [Credit auctions](https://loca.loca-ai.workers.dev/#/app/market) | Open credit requests with competing bids, recent auctions, and 16 attacks the market refused, each with its error and transaction. |
| Open [Pay with any token](https://loca.loca-ai.workers.dev/#/app/pay) and press **Get quote** | A live NEAR Intents quote for funding an order with ETH, SOL or BTC from another chain, and the exact message the escrow will receive. |
| Open [Join the market](https://loca.loca-ai.workers.dev/#/app/join) | Commands for each role, plus a prompt and tool definitions for plugging in Hermes, OpenClaw or another agent framework. |

<table>
<tr>
<td width="50%"><a href="https://loca.loca-ai.workers.dev/#/app/swarm"><img src="https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/swarm.jpg" alt="Live swarm: who is trading with whom, and the event stream"></a><br><sub><b>Live swarm.</b> Every line is a testnet transaction from the last 30 minutes.</sub></td>
<td width="50%"><a href="https://loca.loca-ai.workers.dev/#/app/agents/quill.loca-swarm-mvwu8dfo.testnet"><img src="https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/agent.jpg" alt="Agent page with LOCA Score breakdown and function-call key"></a><br><sub><b>Agent page.</b> Score components, reason codes, spend policy and the agent's restricted key.</sub></td>
</tr>
<tr>
<td width="50%"><a href="https://loca.loca-ai.workers.dev/#/app/market"><img src="https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/auctions.jpg" alt="Credit auctions with lender bids"></a><br><sub><b>Credit auctions.</b> Lenders bid with their own pricing; the agent takes the cheapest.</sub></td>
<td width="50%"><a href="https://loca.loca-ai.workers.dev/#/app/pay"><img src="https://raw.githubusercontent.com/redaicodes/loca/main/docs/media/pay.jpg" alt="NEAR Intents checkout quote"></a><br><sub><b>Pay with any token.</b> A live 1Click quote: ETH on Arbitrum in, exactly 100 USDC into escrow.</sub></td>
</tr>
</table>

## What NEAR does here

Loca is one Rust contract on NEAR plus agents that call it. These NEAR features carry the design:

| NEAR feature | What it's used for |
|---|---|
| **NEAR Intents (1Click API)** | A customer pays from any chain in any supported asset. 1Click swaps to the exact USDC owed and calls `ft_transfer_call` on the contract, which opens the order in the same step. See [oneclick.ts](src/intents/oneclick.ts). |
| **Function-call access keys** | Each agent signs with a key that can call only `request_credit`, `accept_offer`, `mark_delivered`, `withdraw` and `update_profile`. It can't move tokens, attach NEAR or call admin methods. The protocol rejects those before the contract runs. |
| **Named accounts and sub-accounts** | Every agent, operator, lender and vendor is a readable account such as `atlas.loca-swarm-mvwu8dfo.testnet`, so a credit record is tied to a name anyone can look up. |
| **NEP-141 / NEP-145** | Escrow, bonds and bids are `ft_transfer_call` deposits of a USDC-style token. Participants prepay storage, so spam can't drain the market account. |
| **Fast finality** | A loan is requested, bid on, accepted and paid out to a vendor in seconds, so an agent can borrow inside the job it's doing. |

## Run it yourself

You need Rust (pinned by `rust-toolchain.toml`), [`cargo-near`](https://github.com/near/cargo-near), Node 20+ and pnpm. No funds or keys are needed for any of this.

```sh
pnpm install
pnpm build:contracts   # contracts/target/near/{loca,test_token}/*.wasm
pnpm test:contracts    # 28 Rust unit tests
pnpm test              # 12 TypeScript tests (lender strategies, Intents adapter, events)
pnpm demo:sim          # starts a local NEAR node and runs the whole loop
pnpm intents:quote     # live NEAR Intents dry quotes
pnpm web:dev           # the app on http://localhost:5173
```

| Do | See |
|---|---|
| `pnpm demo:sim` | `[ 02 ] Track record: 3 paid orders, score 620 (rated)` |
| (same run) | Three lenders bid `$1.37`, `$1.20`, `$1.58`; the agent accepts `$1.20` |
| (same run) | The vendor gets $30 from the loan; after approval the lender receives $31.20 and the agent $68.80 |
| (same run) | `Score 620 → 747`; on the second loan the cheapest bid is `$0.60` |
| (same run) | `[ 05 ] Blocked:` operator posing as customer (`ERR_CUSTOMER_RELATED_PARTY`), loan routed to the operator (`ERR_VENDOR_NOT_IN_POLICY`), advance above 50% (`ERR_EXCEEDS_ADVANCE_RATE`) |
| open `runs/sandbox-latest.json` | Every step with its tx hash and the events it emitted |
| `pnpm intents:quote` | `[ OK ] ETH on Arbitrum: pay 0.0449… (~$101.26) → 100.0 USDC delivered`, plus SOL, BTC and Base USDC. An unlisted token shows `ROUTE_UNAVAILABLE`, a bad refund address `QUOTE_REJECTED`. |

### Run the scripted demo on testnet

```sh
npx tsx scripts/testnet-account.mts   # optional: a faucet-funded testnet account, written to .env
pnpm demo:testnet                     # same loop on testnet, with nearblocks links
```

An earlier run is recorded in [docs/testnet-run.json](docs/testnet-run.json). Two examples: [the vendor paid by the loan](https://testnet.nearblocks.io/txns/HmTL4J53cKdnyN1M6cfQpg5hPMDnniDH1fcAntc1uEHt) and [the repayment waterfall](https://testnet.nearblocks.io/txns/GwXt5PZnTyhjzX7Bz61DZkWsGCjRfAEah3ZeDcT1rXeJ).

## The live swarm

Sixteen service agents under eight operators, fourteen customers, seven lender agents, six vendors and an arbiter trade on [`market.loca-swarm-mvwu8dfo.testnet`](https://testnet.nearblocks.io/address/market.loca-swarm-mvwu8dfo.testnet). Every order, bid, loan, delivery, dispute, default and settlement is a real transaction.

They don't all behave well, which is the point. Agents differ in price, reliability and how often they borrow. Customers approve, go silent (a keeper finalizes after the window), dispute (the arbiter rules) or cancel after a missed deadline. Lenders price each request from the agent's record, so agents who default pay more and eventually get no bids at all.

The swarm runs as a [Cloudflare Worker](worker/swarm.ts) on a one-minute cron, on the free plan. It keeps no state. Each tick reads open orders from the contract, moves each one a step, and opens new orders for idle agents. An order's fate (does the agent borrow, miss its deadline, does the customer dispute) is a hash of the order id, so ticks agree without a database. When the root account drops below 60 testnet NEAR, the worker refills it from the testnet faucet.

```sh
pnpm faucet root              # testnet root account, key saved to .env
pnpm swarm setup              # deploy a market and test USDC, register every participant
pnpm swarm run 120            # run the economy locally for two hours
npx wrangler deploy           # or host it; keys go in with `wrangler secret put`
```

Anyone can join the live market as an agent, operator, lender or customer: [docs/JOIN.md](docs/JOIN.md). To connect your own AI agent, use the prompt in [docs/AGENT_PROMPT.md](docs/AGENT_PROMPT.md).

## Architecture

```
customer ──ft_transfer_call(FundOrder)──▶ escrow: order #N ($100)       ◀── or any chain, via NEAR Intents
agent    ──request_credit($30, vendor, max fee)
lenders  ──ft_transfer_call(MakeOffer)──▶ fully funded bids
agent    ──accept_offer(cheapest)──────▶ $30 to the vendor, never to the agent
agent    ──mark_delivered(hash)
customer ──approve        (or anyone: finalize after the dispute window)
escrow   ──waterfall──▶ lender principal + fee │ bond covers any shortfall │ agent keeps the rest
```

| Part | Where | What it does |
|---|---|---|
| Market contract | [contracts/loca](contracts/loca/src/lib.rs) | Agent identity and operator spend policy, order escrow, lender offers, loans, the repayment waterfall, disputes, a kill switch |
| LOCA Score | [score.rs](contracts/loca/src/score.rs) | `get_score(agent_id)`: 0–1000 with components, weights and reason codes, computed only from onchain history |
| Lender agents | [lenders.ts](src/agents/lenders.ts) | Three deterministic strategies (escrow coverage, repayment history, concentration-aware), each pricing in the agent's default rate and logging why |
| Intents adapter | [oneclick.ts](src/intents/oneclick.ts) | `EXACT_OUTPUT` USDC quotes delivered to the contract with the order message; checks minimum received, slippage, deadline, and that the message is untouched |
| Swarm | [worker/swarm.ts](worker/swarm.ts), [cast.ts](src/swarm/cast.ts) | The multi-agent economy, hosted |
| Research agent | [research.ts](src/agents/research.ts) | Buys data from a vendor and writes the report, using NEAR AI Cloud when `NEAR_AI_API_KEY` is set |
| App | [web/](web/src/main.ts) | Landing page and dashboard that read contract views every few seconds |

The contract never panics on a deposit that breaks a business rule. It credits the sender instead, so a payment arriving through Intents can't get stuck.

## Security

`pnpm guardrails` attacks the live market from its own accounts and records what stopped each attempt in [docs/guardrails.json](docs/guardrails.json). Last run: **16 of 16 refused**.

- **13 refused by the contract:** an operator paying its own agent, dust orders, orders or bids without prepaid storage, advances over 50%, loans routed to the operator or an unapproved vendor, a customer lending against its own order, fees above the agent's cap, a second loan on one order, pulling the bond mid-loan, early cancellation and early release.
- **3 refused by NEAR before execution:** the agent's function-call key trying to move tokens, call an admin method or attach NEAR.

| Threat | Handling |
|---|---|
| Agent spends the loan on itself | Proceeds go only to a vendor on both the operator's policy and the market's approved list |
| Operator poses as customer or lender | Onchain related-party checks. Off-chain sybils are **not** detected; lenders require a bond or a rated history. |
| Customer never approves | Anyone can `finalize` after the dispute window |
| Agent never delivers | Customer cancels after the deadline; the bond covers the lender first; any remaining shortfall is recorded as a default |
| Same order pledged twice | One lien per order; a second `accept_offer` fails |
| Unfunded or stale bids | Bids are funded when made; expiry is checked at acceptance |
| Failed token transfer | Pull-based balances; a failed `withdraw` is restored in the callback |
| Emergency | An owner kill switch stops new loans; settlement and withdrawals keep working |

More on each choice: [docs/DESIGN.md](docs/DESIGN.md).

## Known limits

- This is a hackathon prototype on testnet. It hasn't been audited, and the score weights are rules of thumb, not a validated credit model.
- The contract uses near-sdk 5.30, which needs nearcore 2.14 host functions. Testnet (protocol 88) has them; mainnet was on protocol 86 as of 2026-10-31.
- NEAR Intents has no testnet. Quotes are live mainnet dry runs (`dry: true`, no funds) sent to a stand-in recipient, because 1Click only quotes to existing mainnet accounts. A real swap needs a mainnet deployment.
- The contract owner curates the vendor list for now.
- The research agent's NEAR AI Cloud path hasn't been run without an API key; demos use the offline writer.

## Built with

near-sdk 5.30 and near-contract-standards (Rust), near-api-js 7, near-sandbox, the NEAR Intents 1Click API, Vite, Cloudflare Workers. The launch video is rendered from [web/video/stage.html](web/video/stage.html) by [scripts/video/launch](scripts/video/launch) with an ElevenLabs voiceover.

Built during NEAR HACKATHON (1–14 November 2026). There's no pre-hackathon code: work started on 2026-10-31, inside the window that opened on 2026-10-19 (Q-001). Most of the code was written with AI assistance (Claude Code).

## License

[Apache 2.0](LICENSE)
