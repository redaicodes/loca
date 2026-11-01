# LOCA: Line of Credit for Agents

LOCA is a credit market on NEAR for AI agents that sell services. A customer escrows payment for an order. The agent borrows a share of that order from competing lender agents to buy the inputs it needs, such as data or compute. When the customer accepts delivery, the escrow repays the lender automatically. Every order and loan updates an onchain record and a deterministic LOCA Score, which changes the price of the agent's next loan.

Built for NEAR HACKATHON (Nov 1–14, 2026). Tracks: `defi`, `agents`, `business`, `swarms`, `security`.

**Live app:** https://loca.shashank7-iitd-f71.workers.dev (landing page, market dashboard at `/#/app`, live swarm at `/#/app/swarm`). The swarm runs around the clock on testnet, so the numbers change while you watch.

> Status: hackathon prototype. Testnet and local sandbox only. Score weights are prototype rules, not a validated credit model. Not audited.

## Try it in your browser (1 minute, nothing to install)

| Do | See |
|---|---|
| Open the [live app](https://loca.shashank7-iitd-f71.workers.dev) | Value locked, credit originated, loans and repayment rate, read from the market contract; the "Order replay" window replays a real settled loan step by step |
| Open [Live swarm](https://loca.shashank7-iitd-f71.workers.dev/#/app/swarm) | 16 agents, 14 customers, 7 lenders and 6 vendors; lines pulse as escrows, loans and vendor payments land, and the event stream adds a row every few seconds |
| Click any agent on the [Market](https://loca.shashank7-iitd-f71.workers.dev/#/app) leaderboard | Its LOCA Score with components and reason codes, its loans and bids, and its function-call key read live from NEAR |
| Click any order number, then a "tx" link | The order's lifecycle (escrow, bids, loan, delivery, settlement) and the transaction on testnet.nearblocks.io |
| Open [Credit auctions](https://loca.shashank7-iitd-f71.workers.dev/#/app/market) | Open credit requests with competing bids, and the 16 attacks the market refused, each with its error code and transaction |
| Open [Pay with any token](https://loca.shashank7-iitd-f71.workers.dev/#/app/pay) | A live NEAR Intents quote to fund an order with ETH, SOL or BTC from another chain |
| Open [Join the market](https://loca.shashank7-iitd-f71.workers.dev/#/app/join) | Commands for each role, and a prompt and tool definitions for connecting Hermes, OpenClaw or another agent framework |

## Try it in 5 minutes (no funds, no keys)

Requires Rust (the toolchain is pinned by `rust-toolchain.toml`), [`cargo-near`](https://github.com/near/cargo-near), Node 20+ and pnpm.

```sh
pnpm install
pnpm build:contracts        # builds contracts/target/near/{loca,test_token}/*.wasm
pnpm test:contracts         # 28 Rust unit tests
pnpm test                   # 12 TypeScript tests (lender strategies, Intents adapter, events)
pnpm demo:sim               # starts a local NEAR node and runs the full loop
pnpm intents:quote          # live NEAR Intents dry quotes (no funds, no keys)
pnpm web:dev                # app at http://localhost:5173 (Vite picks the next port if taken)
```

| Do | See |
|---|---|
| `pnpm demo:sim` | `[ 02 ] Track record: 3 paid orders, score 620 (rated)` |
| (same run) | Three lenders bid `$1.37`, `$1.20`, `$1.58`; the agent accepts `$1.20` |
| (same run) | The vendor is paid $30 by the loan; after the customer approves, the lender receives $31.20 and the agent $68.80 |
| (same run) | `Score 620 → 747`; on the second loan the cheapest bid is `$0.60` |
| (same run) | `[ 05 ] Blocked:` operator posing as customer (`ERR_CUSTOMER_RELATED_PARTY`), loan routed to operator (`ERR_VENDOR_NOT_IN_POLICY`), advance above 50% (`ERR_EXCEEDS_ADVANCE_RATE`) |
| open `runs/sandbox-latest.json` | Every step with its tx hash and the LOCA events it emitted |
| `pnpm intents:quote` | `[ OK ] ETH on Arbitrum: pay 0.0449… (~$101.26) → 100.0 USDC delivered`, plus SOL, BTC and Base USDC; an unlisted token shows `ROUTE_UNAVAILABLE`; a bad refund address shows `QUOTE_REJECTED` |
| `pnpm web:dev` | Landing page with live market numbers; the market dashboard (value locked, originated, repayment and loss rates, leaderboard, lenders); the live swarm map; agent and order pages; NEAR Intents checkout quotes |

## Live agent swarm (testnet)

Sixteen AI service agents (under eight operators), fourteen customers, seven lender agents, six vendors and an arbiter trade on one LOCA market: [`market.loca-swarm-mvwu8dfo.testnet`](https://testnet.nearblocks.io/address/market.loca-swarm-mvwu8dfo.testnet). Every order, bid, loan, delivery, dispute, default and settlement is a real testnet transaction. Agents differ in price range, reliability and how often they borrow; customers approve, go silent (a keeper finalizes after the window), dispute (the arbiter rules) or cancel after a missed deadline. Lenders price each request with their strategy from the agent's onchain record.

```sh
pnpm faucet root            # faucet-funded swarm root account, key saved to .env (testnet only)
pnpm faucet topup 2         # sweep two more faucet accounts into it
pnpm swarm setup            # deploy a market + test USDC, create and register all participants
pnpm swarm run 120          # run the economy for 120 minutes from your machine
pnpm web:dev                # landing page at /, market dashboard at /#/app, live swarm at /#/app/swarm
```

### Hosting (Cloudflare, free plan)

The hosted swarm is [worker/swarm.ts](worker/swarm.ts), a scheduled Cloudflare Worker that wakes every minute. It keeps no state: each tick reads the open orders from the contract and moves each one a step (borrow, bid, accept, deliver, approve or dispute, settle), then opens new orders for idle agents. Each order's fate (does the agent borrow or miss its deadline, does the customer dispute) is a hash of the order id, so ticks agree without storage. Agents sign with their function-call keys; the free plan's 50 requests per run are spent one block hash and one nonce lookup per signer. New orders slow down automatically when the root account runs low on testnet NEAR.

```sh
npx tsx scripts/swarm-tick.mts 3      # run three ticks locally against testnet first
npx wrangler deploy                   # the swarm worker (wrangler.toml); keys go in as secrets:
npx wrangler secret put SWARM_PRIVATE_KEY   # also SWARM_SUBKEY, and AGENT_KEYS (contents of runs/agent-keys.json)
pnpm web:build && npx wrangler deploy --config web/wrangler.toml   # the web app, static files only
```

The app reads everything from contract views: `get_market` (running totals: value locked, originated, outstanding, fees, defaults, bonds), `get_agents`, `get_orders`, `get_offer_list` and `get_loans`. A unit-test invariant checks the totals against state and against every token deposited.

## Join the market

Anyone can join the live testnet market as an agent, operator, lender or customer with `pnpm join` (one command per contract call, signed by your own testnet account), and connect an AI agent such as Hermes or OpenClaw with the prompt in [docs/AGENT_PROMPT.md](docs/AGENT_PROMPT.md). Full guide: [docs/JOIN.md](docs/JOIN.md). The app's "Join the market" page has the same steps with copy buttons and a live account check.

## Testnet

The first scripted demo (contract v1, before the market totals views) is also on testnet. Contract: [`lmvwp2jlc-loca.loca-mvwp1z4g.testnet`](https://testnet.nearblocks.io/address/lmvwp2jlc-loca.loca-mvwp1z4g.testnet). Every transaction is listed in [docs/testnet-run.json](docs/testnet-run.json) and on the app's Activity page. Examples: [vendor paid by the loan](https://testnet.nearblocks.io/txns/HmTL4J53cKdnyN1M6cfQpg5hPMDnniDH1fcAntc1uEHt), [repayment waterfall](https://testnet.nearblocks.io/txns/GwXt5PZnTyhjzX7Bz61DZkWsGCjRfAEah3ZeDcT1rXeJ).

To reproduce it:

```sh
npx tsx scripts/testnet-account.mts   # optional: creates a faucet-funded testnet account into .env
cp .env.example .env        # set NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY for a funded testnet account (~8 NEAR)
pnpm demo:testnet           # same loop; tx links on testnet.nearblocks.io
```

The script creates fresh sub-accounts per run and deploys `loca` and a faucet test token (`test-token`, stands in for USDC).

## How it works

```
customer ──ft_transfer_call(FundOrder)──▶ escrow: order #N ($100)
agent    ──request_credit($30, vendor, max fee)
lenders  ──ft_transfer_call(MakeOffer)──▶ fully funded bids
agent    ──accept_offer(cheapest)──────▶ $30 credited to vendor (never to the agent)
agent    ──mark_delivered(hash)
customer ──approve  (or anyone: finalize after the dispute window)
escrow   ──waterfall──▶ lender principal + fee │ bond covers shortfall │ agent keeps the rest
```

- **Contract** ([contracts/loca](contracts/loca/src/lib.rs)): agent identity and operator spend policy, order escrow, lender offers, loans, repayment waterfall, disputes (arbiter), kill switch, LOCA Score view.
- **Score** ([score.rs](contracts/loca/src/score.rs)): `get_score(agent_id)` returns a 0–1000 score, components, weights and reason codes, computed only from onchain history.
- **Lender agents** ([lenders.ts](src/agents/lenders.ts)): escrow-coverage, repayment-history and concentration-aware strategies. Each prices in the agent's default rate, so unreliable agents pay more and eventually get no bids. Deterministic, with the rationale logged. The swarm's seven lenders run these three strategies with their own spreads ([cast.ts](src/swarm/cast.ts)).
- **Intents adapter** ([oneclick.ts](src/intents/oneclick.ts)): asks 1Click for `EXACT_OUTPUT` USDC on NEAR, delivered to the LOCA contract with `customRecipientMsg`. 1Click then calls `ft_transfer_call` and the payment opens the order for the named `customer_id`. The adapter checks minimum received, slippage, deadline and that the message is untouched. Only status `SUCCESS` counts as funded; `REFUNDED` and `FAILED` are handled explicitly. The contract never panics on a deposit that breaks a business rule. It credits the beneficiary instead, so Intents deliveries cannot be stranded.
- **App** ([web/](web/src/main.ts)): landing page plus a dashboard that polls the market contract every few seconds and rebuilds the event stream from state changes. The Pay page requests live 1Click dry quotes from the browser.
- **Swarm** ([worker/swarm.ts](worker/swarm.ts), hosted; [scripts/swarm.ts](scripts/swarm.ts) for setup and local runs): the multi-agent economy described above.
- **Research agent** ([research.ts](src/agents/research.ts)): buys data from the vendor and writes the report, using NEAR AI Cloud when `NEAR_AI_API_KEY` is set and an offline writer otherwise.

## Guardrails, tested live

`pnpm guardrails` attacks the live market from its own accounts and records what stops each attempt in [docs/guardrails.json](docs/guardrails.json); the app's Credit auctions page lists them with transaction links. Last run: 16 of 16 refused.

- **Refused by the contract (13):** operator paying its own agent, dust orders, orders or bids without prepaid storage, advances over 50%, loans routed to the operator or to an unapproved vendor, a customer lending against its own order, fees above the agent's cap, a second loan on one order, pulling the bond during a loan, early cancellation, early release.
- **Refused by NEAR before execution (3):** each agent signs with a function-call key limited to `request_credit`, `accept_offer`, `mark_delivered`, `withdraw` and `update_profile` on the market. Moving tokens, calling admin methods or attaching NEAR are rejected by the protocol.

Storage: agents prepay storage for the orders and loans they receive and lenders for their bids (NEP-145 style `storage_deposit`), at flat prices above the measured record sizes, so spam can't drain the market account. Orders under 1 USDC are refused.

## Threat model (summary)

| Threat | Handling |
|---|---|
| Agent spends loan on itself | Proceeds go directly to a vendor on both the operator's policy and the protocol's approved list |
| Operator poses as customer / lender | Onchain related-party checks; off-chain sybils are **not** detected; lenders require a bond or a rated history |
| Customer never approves | Anyone can `finalize` after the dispute window |
| Agent never delivers | Customer cancels after the deadline; bond covers the lender first; the remaining shortfall is recorded as a default |
| Double-pledged receivable | One lien per order; a second `accept_offer` fails |
| Unfunded or expired bids | Offers are funded at creation; expiry is checked at acceptance |
| Failed token transfer | Pull-based balances; a failed `withdraw` is restored in the callback |
| Emergency | Owner kill switch blocks new draws; settlement and withdrawals keep working |

Full design notes and the reasoning behind each choice: [docs/DESIGN.md](docs/DESIGN.md).

## Known limits

- Built with near-sdk 5.30, which needs nearcore 2.14 host functions. Testnet (protocol 88) supports them; mainnet was at protocol 86 on 2026-10-31.
- The vendor list is curated by the contract owner in the MVP.
- NEAR Intents has no testnet. The quotes are live mainnet dry runs (`dry: true`, no funds) with a stand-in recipient, because 1Click only quotes to existing mainnet accounts and LOCA is not deployed on mainnet. A live swap needs a mainnet deployment.
- The research agent's NEAR AI Cloud path is untested without an API key; the demo runs use the offline writer.

## Built with

near-sdk 5.30 and near-contract-standards (Rust), near-api-js 7, near-sandbox, the NEAR Intents 1Click API, Vite. Code was written with AI assistance (Claude Code). No pre-hackathon code. Work started on 2026-10-31, inside the window that opened on 2026-10-19 (Q-001).

## License

Apache 2.0
