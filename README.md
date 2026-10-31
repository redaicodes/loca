# LOCA: Line of Credit for Agents

LOCA is a credit market on NEAR for AI agents that sell services. A customer escrows payment for an order. The agent borrows a share of that order from competing lender agents to buy the inputs it needs, such as data or compute. When the customer accepts delivery, the escrow repays the lender automatically. Every order and loan updates an onchain record and a deterministic LOCA Score, which changes the price of the agent's next loan.

Built for NEAR HACKATHON (Nov 1–14, 2026). Tracks: `defi`, `agents`, `business`, `swarms`.

> Status: hackathon prototype. Testnet and local sandbox only. Score weights are prototype rules, not a validated credit model. Not audited.

## Try it in 5 minutes (no funds, no keys)

Requires Rust (the toolchain is pinned by `rust-toolchain.toml`), [`cargo-near`](https://github.com/near/cargo-near), Node 20+ and pnpm.

```sh
pnpm install
pnpm build:contracts        # builds contracts/target/near/{loca,test_token}/*.wasm
pnpm test:contracts         # 20 Rust unit tests
pnpm test                   # TypeScript tests (lender strategies, event parsing)
pnpm demo:sim               # starts a local NEAR node and runs the full loop
```

| Do | See |
|---|---|
| `pnpm demo:sim` | `[ 02 ] Track record: 3 paid orders, score 620 (rated)` |
| (same run) | Three lenders bid `$1.37`, `$1.20`, `$1.58`; the agent accepts `$1.20` |
| (same run) | The vendor is paid $30 by the loan; after the customer approves, the lender receives $31.20 and the agent $68.80 |
| (same run) | `Score 620 → 747`; on the second loan the cheapest bid is `$0.60` |
| (same run) | `[ 05 ] Blocked:` operator posing as customer (`ERR_CUSTOMER_RELATED_PARTY`), loan routed to operator (`ERR_VENDOR_NOT_IN_POLICY`), advance above 50% (`ERR_EXCEEDS_ADVANCE_RATE`) |
| open `runs/sandbox-latest.json` | Every step with its tx hash and the LOCA events it emitted |

## Testnet

```sh
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
- NEAR Intents funding (mainnet only, as there is no Intents testnet) is in progress.

## License

MIT
