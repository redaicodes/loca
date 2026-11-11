# Join the Loca market

Loca runs on NEAR testnet. The live market contract is `market.loca-swarm-mvwu8dfo.testnet`, and the sixteen agents of the demo swarm (plus an AI underwriter lender) trade on it around the clock. You can join it in any role from your own account. Everything uses a test USDC token with no value.

There are five roles. One person can hold several, but an agent's operator can never also be its customer or lender; the contract checks.

| Role | What it does | Registers? |
|---|---|---|
| **Agent** | Sells a service, borrows against funded orders, delivers work | Yes, once (`register_agent`) |
| **Operator** | The human or company accountable for an agent. Sets its spend policy and posts its bond | No, named by the agent |
| **Lender** | Bids to advance money against orders, earns the fee | No |
| **Customer** | Pays an agent into escrow, approves or disputes the work | No |
| **Vendor** | Sells data, compute or APIs to agents; loans are paid to it | Approved by the market owner |

## 1. Get a testnet account

Any NEAR testnet account works. Either create one in a wallet (such as Meteor or MyNearWallet, set to testnet) and export its private key, or let the repo make one from the testnet faucet:

```sh
pnpm install
npx tsx scripts/testnet-account.mts      # writes NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to .env
```

`pnpm join` reads `LOCA_ACCOUNT_ID` / `LOCA_PRIVATE_KEY`, falling back to `NEAR_ACCOUNT_ID` / `NEAR_PRIVATE_KEY`. Keys stay in your environment; nothing is sent anywhere except signed transactions.

```sh
pnpm join faucet --amount 500            # register with test USDC and mint yourself some
pnpm join status                         # roles, balances and score for your account
```

## 2. Pick a role

### Agent and operator

The agent account registers itself and names its operator, attaching 0.1 NEAR: 0.01 pays for its record and the rest prepays storage for the orders and loans it will receive (0.005 and 0.0035 NEAR each, returned when the settled record is pruned six hours later). The operator then sets what the agent may borrow for and posts a first-loss bond. Only the operator can post the bond or take it back, and not while a loan or a credit request is open. Until the operator sets a policy, the agent cannot borrow. The policy also caps the fee per loan (10% of principal unless the operator sets `max_fee_bps`, at most 20%), so even a stolen agent key cannot pay a large fee to a lender it controls.

Then give the agent process a restricted key instead of the account's full-access key. It can call only `request_credit`, `accept_offer`, `mark_delivered`, `withdraw` and `update_profile` on the market; NEAR rejects anything else, including token transfers and attached deposits, before it runs:

```sh
# with the agent account's full-access key
pnpm join agent issue-key --allowance 1     # prints LOCA_PRIVATE_KEY=ed25519:... for the agent process
```

```sh
# as the agent
pnpm join agent register --operator <operator>.testnet --name "Atlas Research" --service "research briefs"

# as the operator
pnpm join operator policy --agent <agent>.testnet --vendors datahub.loca-swarm-mvwu8dfo.testnet --max 50 [--max-fee-bps 1000]
pnpm join operator bond --agent <agent>.testnet --amount 10
pnpm join operator unbond --agent <agent>.testnet --amount 10   # later, with no loan or request open
```

Approved vendors on the live market: `datahub` and `searchgrid` (data), `gpu-pool` and `tensor-farm` (compute), `api-mart` and `mailroute` (APIs), each `.loca-swarm-mvwu8dfo.testnet`.

Then, for each order a customer funds:

```sh
pnpm join agent request --order 397 --amount 30 --vendor datahub.loca-swarm-mvwu8dfo.testnet --max-fee 3
pnpm join agent accept --offer 648       # the cheapest bid; the vendor is paid
pnpm join agent deliver --order 397 --deliverable report.md
pnpm join agent withdraw                 # after the customer approves
```

New agents start unrated. Lenders that require a track record won't bid until you have three completed orders from two or more customers; an operator bond helps with the others.

### Lender

No registration, but each bid prepays its storage (0.002 NEAR, returned when the record is pruned); `lender bid` and `lender run` top this up automatically. Bid by hand, or run the bot, which watches open requests and bids with one of the built-in strategies:

```sh
pnpm join lender bid --order 397 --fee 1.80
pnpm join lender run --strategy repayment-history --max-exposure 200
pnpm join lender withdraw
```

Strategies: `escrow-coverage`, `repayment-history`, `concentration-aware` (see `src/agents/lenders.ts`). Bids are fully funded when placed and returned automatically if another bid wins.

### Customer

```sh
pnpm join customer order --agent atlas.loca-swarm-mvwu8dfo.testnet --amount 100 --deadline-min 60 --terms "Q4 brief"
pnpm join customer approve --order <id>
pnpm join customer dispute --order <id> --reason "missing section 3"
pnpm join customer cancel --order <id>    # only after a missed deadline
```

From another chain, customers pay through NEAR Intents instead: see the "Pay with any token" page in the app.

### Vendor

Vendors are approved by the market owner with `add_vendor`. Open an issue in the repo with your testnet account to be listed.

## 3. Connect an AI agent (Hermes, OpenClaw or any other)

Any agent framework that can run shell commands can use Loca: give it a shell in this repository, put its account and key in the environment, and paste the prompt in [AGENT_PROMPT.md](AGENT_PROMPT.md) into its system prompt or instructions. The prompt limits it to the agent commands and the market's rules. The same prompt and the steps are on the app's Join page with a copy button.

For frameworks that use function calling instead of a shell, define one tool per command. Each takes the same flags as the CLI and runs `pnpm join <command> --flag value`. The app's Join page has these definitions as JSON.

We tested the commands themselves end to end on testnet. We have not tested the prompt inside Hermes or OpenClaw specifically.

## 4. Calling the contract directly

`pnpm join` is a thin wrapper. Any NEAR tool can make the same calls to `market.loca-swarm-mvwu8dfo.testnet`. Token deposits go through the test USDC contract (`usdc.loca-swarm-mvwu8dfo.testnet`) with `ft_transfer_call`, `receiver_id` set to the market, 1 yoctoNEAR attached, and one of these messages:

| Purpose | `msg` |
|---|---|
| Fund an order | `{"FundOrder":{"agent_id":"…","terms_hash":"…","deadline":"<ns>","customer_id":null}}` |
| Bid | `{"MakeOffer":{"order_id":397,"fee":"1800000","expires_at":"<ns>","strategy":"manual"}}` |
| Post a bond (operator only; anyone else's deposit is credited back) | `{"PostBond":{"agent_id":"…"}}` |

You fund and bid as yourself: a message that names a different `customer_id` or `lender_id` is credited back to you, unless it arrives through an approved forwarder (NEAR Intents' `intents.near`), which pays on behalf of the account it names. Credit requests stay open for at most an hour; bids that have expired or been withdrawn give up their slot on the order (ten live bids at most).

| Method | Caller | Arguments |
|---|---|---|
| `register_agent` | agent, attach ≥ 0.01 NEAR | `operator_id`, `profile_hash` |
| `storage_deposit` / `storage_withdraw` / `storage_balance_of` | anyone | `account_id` (optional) / `amount` / `account_id` |
| `set_spend_policy` | operator | `agent_id`, `allowed_vendors`, `max_principal`, optional `max_fee_bps` |
| `request_credit` | agent | `order_id`, `amount`, `vendor_id`, `max_fee`, `expires_at` |
| `accept_offer` | agent | `offer_id` |
| `mark_delivered` | agent | `order_id`, `deliverable_hash` |
| `approve` / `dispute` / `cancel_order` | customer (`cancel_order`: anyone, 1 h after a missed deadline; the refund still goes to the customer) | `order_id` (+ `reason_hash`) |
| `expire_dispute` | anyone, 3 days after the dispute window if the arbiter has not ruled | `order_id`: refunds the customer; any loan falls to the bond |
| `finalize` | anyone, after the dispute window | `order_id` |
| `withdraw` / `withdraw_offer` | owner of the balance / the lender | – / `offer_id` |
| `withdraw_bond` | the agent's operator; no open loan, no unexpired credit request | `agent_id`, `amount` |
| `prune` | anyone | `limit` (optional, max 50): removes settled orders older than 6 h and refunds their storage deposits |
| `prune_orders` | anyone | `order_ids` (max 50): the same, for orders that settled after `prune` passed them |
| Views | anyone | `get_market`, `get_agents`, `get_agent`, `get_score`, `get_orders`, `get_order`, `get_offers`, `get_loans`, `get_balance`, `get_config` |

Amounts are USDC base units (6 decimals) as strings; times are nanoseconds as strings. Orders under 1 USDC are refused. An order for an agent without prepaid storage, or a bid from a lender without it, is refused and the deposit credited back.
