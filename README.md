# LOCA: Line of Credit for Agents

LOCA is a credit market on NEAR for AI agents that sell services. A customer escrows payment for an order. The agent borrows a share of that order from competing lender agents to buy the inputs it needs, such as data or compute. When the customer accepts delivery, the escrow repays the lender automatically. Every order and loan updates an onchain record and a deterministic LOCA Score, which changes the price of the agent's next loan.

Built for NEAR HACKATHON (Nov 1–14, 2026). Tracks: `defi`, `agents`, `business`, `swarms`.

> Status: hackathon prototype. Testnet and local sandbox only. Score weights are prototype rules, not a validated credit model. Not audited.

## Try it in 5 minutes (no funds, no keys)

Requires Rust (the toolchain is pinned by `rust-toolchain.toml`), [`cargo-near`](https://github.com/near/cargo-near), Node 20+ and pnpm.

```sh
pnpm install
pnpm build:contracts        # builds contracts/target/near/{loca,test_token}/*.wasm
pnpm test:contracts         # 22 Rust unit tests
pnpm test                   # 10 TypeScript tests (lender strategies, Intents adapter, events)
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

Eight AI service agents, six customers, three lender agents, three vendors and an arbiter trade on one LOCA market: [`market.loca-swarm-mvwu8dfo.testnet`](https://testnet.nearblocks.io/address/market.loca-swarm-mvwu8dfo.testnet). Every order, bid, loan, delivery, dispute, default and settlement is a real testnet transaction. Agents differ in price range, reliability and how often they borrow; customers approve, go silent (a keeper finalizes after the window), dispute (the arbiter rules) or cancel after a missed deadline. Lenders price each request with their strategy from the agent's onchain record.

```sh
pnpm faucet root            # faucet-funded swarm root account, key saved to .env (testnet only)
pnpm faucet topup 2         # sweep two more faucet accounts into it
pnpm swarm setup            # deploy a market + test USDC, create and register all participants
pnpm swarm run 120          # run the economy for 120 minutes
pnpm web:dev                # landing page at /, market dashboard at /#/app, live swarm at /#/app/swarm
```

The app reads everything from contract views: `get_market` (running totals: value locked, originated, outstanding, fees, defaults, bonds), `get_agents`, `get_orders`, `get_offer_list` and `get_loans`. A unit-test invariant checks the totals against state and against every token deposited.

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
- **Lender agents** ([lenders.ts](src/agents/lenders.ts)): escrow-coverage, repayment-history and concentration-aware strategies. Deterministic, with the rationale logged.
- **Intents adapter** ([oneclick.ts](src/intents/oneclick.ts)): asks 1Click for `EXACT_OUTPUT` USDC on NEAR, delivered to the LOCA contract with `customRecipientMsg`. 1Click then calls `ft_transfer_call` and the payment opens the order for the named `customer_id`. The adapter checks minimum received, slippage, deadline and that the message is untouched. Only status `SUCCESS` counts as funded; `REFUNDED` and `FAILED` are handled explicitly. The contract never panics on a deposit that breaks a business rule. It credits the beneficiary instead, so Intents deliveries cannot be stranded.
- **App** ([web/](web/src/main.ts)): landing page plus a dashboard that polls the market contract every few seconds and rebuilds the event stream from state changes. The Pay page requests live 1Click dry quotes from the browser.
- **Swarm** ([scripts/swarm.ts](scripts/swarm.ts)): the multi-agent economy described above.
- **Research agent** ([research.ts](src/agents/research.ts)): buys data from the vendor and writes the report, using NEAR AI Cloud when `NEAR_AI_API_KEY` is set and an offline writer otherwise.

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

MIT
