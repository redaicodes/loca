// Join the Loca market from your own NEAR testnet account, in any role.
//
//   LOCA_ACCOUNT_ID=you.testnet LOCA_PRIVATE_KEY=ed25519:... pnpm join <command> [--flags]
//
// Run `pnpm join help` for the command list. Every command is one contract call (or a short
// loop of them for `lender run`), signed by the account in LOCA_ACCOUNT_ID. Testnet only.

import "dotenv/config";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto } from "near-api-js";
import { STRATEGIES } from "../src/agents/lenders.js";
import { sha256 } from "../src/agents/research.js";
import { call, ContractError } from "../src/lib/near.js";
import { fmtUsd, usd, type Agent, type Config, type Loan, type Offer, type Order, type ScoreReport } from "../src/lib/types.js";

const CONTRACT = process.env.LOCA_CONTRACT ?? "market.loca-swarm-mvwu8dfo.testnet";
// Free public RPCs rate-limit; fail over across several, with backoff.
const RPCS = (process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org,https://test.rpc.fastnear.com").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, wait: 800, backoff: 1.7 })));
const SEC = 1_000_000_000n;

const HELP = `Loca: join the market on NEAR testnet

Set LOCA_ACCOUNT_ID and LOCA_PRIVATE_KEY (or NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY) to your testnet account (an agent, operator, lender or
customer account). Optional: LOCA_CONTRACT (default ${CONTRACT}).

Anyone
  status [account]                         roles, balances and score for an account
  faucet [--amount 500]                    register with test USDC and mint yourself some
  storage [--amount 0.1]                   prepay market storage (agents and lenders)

Agent (the account that borrows and delivers work)
  agent register --operator <id> --name "My Agent" --service "what it sells"   (attaches 0.1 NEAR storage)
  agent issue-key [--allowance 1]          add a key limited to the agent methods; run the agent on it
  agent request --order <id> --amount 30 --vendor <id> --max-fee 3 [--minutes 10]
  agent accept --offer <id>                take a lender's bid; the vendor is paid
  agent deliver --order <id> --deliverable <file or text>
  agent withdraw                           pull your settled balance

Operator (the human or company accountable for an agent)
  operator policy --agent <id> --vendors <id,id> --max 50
  operator bond --agent <id> --amount 10   first-loss bond, covers lenders before anyone else

Lender
  lender bid --order <id> --fee 1.20 [--minutes 5] [--strategy manual]
  lender run [--strategy repayment-history] [--max-exposure 200]
                                           bot: watches open requests and bids by strategy
                                           (${STRATEGIES.map((s) => s.id).join(", ")})
  lender withdraw

Customer
  customer order --agent <id> --amount 100 [--deadline-min 60] [--terms "brief"]
  customer approve --order <id>
  customer dispute --order <id> --reason "what went wrong"
  customer cancel --order <id>             after a missed deadline
  customer withdraw

Vendors are approved by the market owner (add_vendor). Ask in the repo's issues to be listed.`;

// ---------------------------------------------------------------- plumbing

const argv = process.argv.slice(2);
const [role, maybeAction] = argv;
const action = maybeAction?.startsWith("--") ? undefined : maybeAction;
function flag(name: string, fallback?: string): string {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`Missing --${name}`);
  return v;
}

function me(): Account {
  const id = process.env.LOCA_ACCOUNT_ID ?? process.env.NEAR_ACCOUNT_ID, key = process.env.LOCA_PRIVATE_KEY ?? process.env.NEAR_PRIVATE_KEY;
  if (!id || !key) throw new Error("Set LOCA_ACCOUNT_ID and LOCA_PRIVATE_KEY (your testnet account) first. See docs/JOIN.md.");
  return new Account(id, provider, key as KeyPairString);
}
const view = <T>(method: string, args: Record<string, unknown> = {}, contract = CONTRACT) =>
  provider.callFunction({ contractId: contract, method, args }) as Promise<T>;
const config = () => view<Config>("get_config");
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

// Restricted (function-call) keys cannot attach NEAR and should not reserve 150 TGas per call.
const AGENT_METHODS = ["request_credit", "accept_offer", "mark_delivered", "withdraw", "update_profile"];
const AGENT_GAS = 30_000_000_000_000n;

async function tx(method: string, args: Record<string, unknown>, opts: { contract?: string; deposit?: bigint; gas?: bigint } = {}) {
  const r = await call(me(), opts.contract ?? CONTRACT, method, args, opts.deposit ?? 0n, opts.gas);
  const rejected = r.events.find((e) => e.event === "deposit_rejected");
  if (rejected) console.log(`Refused: ${rejected.data.reason}. The deposit was credited back to ${rejected.data.beneficiary}; run "withdraw" to pull it.`);
  for (const e of r.events) if (e.event !== "deposit_rejected") console.log(`  ${e.event} ${JSON.stringify(e.data)}`);
  console.log(`  tx https://testnet.nearblocks.io/txns/${r.hash}`);
  return r;
}
/** Prepay market storage if the balance is low. Agents pay for orders and loans, lenders for bids. */
async function ensureStorage(min = "0.02", top = "0.1") {
  const bal = BigInt(await view<string>("storage_balance_of", { account_id: me().accountId }));
  if (bal >= nearToYocto(min as `${number}`)) return;
  console.log(`Prepaying ${top} NEAR of market storage (orders, bids and loans are charged a few thousandths each).`);
  await tx("storage_deposit", {}, { deposit: nearToYocto(top as `${number}`) });
}

async function ftCall(amount: bigint, msg: unknown) {
  const { token_id } = await config();
  return tx("ft_transfer_call", { receiver_id: CONTRACT, amount: amount.toString(), msg: JSON.stringify(msg) }, { contract: token_id, deposit: 1n });
}

// ---------------------------------------------------------------- commands

async function status(id: string) {
  const [cfg, agent, score, claimable] = await Promise.all([
    config(), view<Agent | null>("get_agent", { agent_id: id }), view<ScoreReport | null>("get_score", { agent_id: id }),
    view<string>("get_balance", { account_id: id }),
  ]);
  const usdc = await view<string>("ft_balance_of", { account_id: id }, cfg.token_id).catch(() => "0");
  const agents = await view<{ agent: Agent }[]>("get_agents", { from_index: 0, limit: 100 });
  const operates = agents.filter((a) => a.agent.operator_id === id).map((a) => a.agent.agent_id);
  console.log(`Account   ${id}\nMarket    ${CONTRACT}`);
  console.log(`USDC      ${fmtUsd(BigInt(usdc))} in wallet, ${fmtUsd(BigInt(claimable))} claimable in the market`);
  const storage = BigInt(await view<string>("storage_balance_of", { account_id: id }));
  console.log(`Storage   ${(Number(storage / 10n ** 18n) / 1e6).toFixed(4)} NEAR prepaid`);
  if (agent) {
    console.log(`Agent     registered, operator ${agent.operator_id}, score ${score?.score} (${score?.rated ? "rated" : "unrated"})`);
    console.log(`          policy v${agent.policy_version}: max ${fmtUsd(BigInt(agent.policy.max_principal))}, vendors ${agent.policy.allowed_vendors.join(", ") || "none"}`);
    console.log(`          bond ${fmtUsd(BigInt(agent.bond))}, ${agent.stats.orders_completed} orders done, ${agent.stats.loans_repaid} loans repaid, ${agent.stats.loans_defaulted} defaulted`);
    if (!agent.policy_version) console.log(`          next: your operator runs "operator policy" so you can borrow`);
  }
  if (operates.length) console.log(`Operator  of ${operates.join(", ")}`);
  if (cfg.approved_vendors.includes(id)) console.log(`Vendor    approved`);
  if (!agent && !operates.length && !cfg.approved_vendors.includes(id)) console.log(`Roles     none yet (lenders and customers need no registration, just test USDC: "faucet")`);
}

async function faucet() {
  const { token_id } = await config();
  const amount = usd(Number(flag("amount", "500")));
  await tx("register", { account_ids: [me().accountId, CONTRACT] }, { contract: token_id });
  await tx("mint", { account_id: me().accountId, amount: amount.toString() }, { contract: token_id });
  console.log(`Minted ${fmtUsd(amount)} test USDC to ${me().accountId}.`);
}

async function lenderRun() {
  const strategy = STRATEGIES.find((s) => s.id === flag("strategy", "repayment-history"));
  if (!strategy) throw new Error(`Unknown strategy. Use one of: ${STRATEGIES.map((s) => s.id).join(", ")}`);
  const maxExposure = usd(Number(flag("max-exposure", "200")));
  const seen = new Set<number>();
  console.log(`Lender bot as ${me().accountId}, strategy ${strategy.id}, max ${fmtUsd(maxExposure)} out at once. Ctrl-C to stop.`);
  for (;;) {
    try {
      const m = await view<{ next_order_id: number; next_loan_id: number }>("get_market");
      const [orders, loans] = await Promise.all([
        view<Order[]>("get_orders", { from_id: Math.max(0, m.next_order_id - 40), limit: 40 }),
        view<Loan[]>("get_loans", { from_id: Math.max(0, m.next_loan_id - 100), limit: 100 }),
      ]);
      const mine = loans.filter((l) => l.status === "Active" && l.lender_id === me().accountId);
      const out = mine.reduce((a, l) => a + BigInt(l.principal), 0n);
      for (const o of orders) {
        const req = o.credit_request;
        if (!req || o.loan_id !== null || o.status !== "Funded" || seen.has(o.id) || BigInt(req.expires_at) < nowNs() + 20n * SEC) continue;
        seen.add(o.id);
        if (out + BigInt(req.amount) > maxExposure) { console.log(`#${o.id}: skip, would exceed max exposure`); continue; }
        const [agent, score] = await Promise.all([view<Agent>("get_agent", { agent_id: o.agent_id }), view<ScoreReport>("get_score", { agent_id: o.agent_id })]);
        const exposure = mine.filter((l) => l.agent_id === o.agent_id).reduce((a, l) => a + BigInt(l.principal), 0n);
        const d = strategy.decide({ order: o, request: req, agent, score, exposureToAgent: exposure });
        if (!d.bid) { console.log(`#${o.id}: no bid (${d.rationale.join("; ")})`); continue; }
        const expires = BigInt(req.expires_at) - 5n * SEC;
        await ensureStorage();
        console.log(`#${o.id}: bidding ${fmtUsd(d.fee)} on ${fmtUsd(BigInt(req.amount))} for ${o.agent_id} (${d.rationale.join("; ")})`);
        await ftCall(BigInt(req.amount), { MakeOffer: { order_id: o.id, fee: d.fee.toString(), expires_at: expires.toString(), strategy: strategy.id } });
      }
      if (BigInt(await view<string>("get_balance", { account_id: me().accountId })) > usd(20)) await tx("withdraw", {});
    } catch (e) {
      console.log(`error: ${e instanceof ContractError ? e.code ?? e.message : String(e).slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
}

async function main() {
  const r = `${role ?? ""} ${action ?? ""}`.trim();
  switch (r.startsWith("status") ? "status" : r) {
    case "status": return status(argv[1] && !argv[1].startsWith("--") ? argv[1] : me().accountId);
    case "faucet": return faucet();

    case "agent register": {
      const profile = { name: flag("name"), service: flag("service", "") };
      // 0.01 NEAR pays for the agent record; the rest prepays its first orders and loans.
      await tx("register_agent", { operator_id: flag("operator"), profile_hash: sha256(JSON.stringify(profile)) }, { deposit: nearToYocto("0.1") });
      return console.log(`Registered. Profile hash commits to ${JSON.stringify(profile)}. Next: your operator sets a spend policy.`);
    }
    case "agent request": {
      const minutes = BigInt(flag("minutes", "10"));
      await tx("request_credit", {
        order_id: Number(flag("order")), amount: usd(Number(flag("amount"))).toString(), vendor_id: flag("vendor"),
        max_fee: usd(Number(flag("max-fee"))).toString(), expires_at: (nowNs() + minutes * 60n * SEC).toString(),
      }, { gas: AGENT_GAS });
      const offers = await view<Offer[]>("get_offers", { order_id: Number(flag("order")) });
      return console.log(`Requested. Bids so far: ${offers.length}. Accept one with "agent accept --offer <id>".`);
    }
    case "agent accept": return void (await tx("accept_offer", { offer_id: Number(flag("offer")) }, { gas: AGENT_GAS }));
    case "agent issue-key": {
      // Run with the agent account's full-access key. Prints a key the agent process should use instead.
      const kp = KeyPair.fromRandom("ed25519");
      await me().addFunctionCallAccessKey({ publicKey: kp.getPublicKey().toString(), contractId: CONTRACT, methodNames: AGENT_METHODS, allowance: nearToYocto(flag("allowance", "1") as `${number}`) });
      console.log(`Added a function-call key to ${me().accountId}. It can call only ${AGENT_METHODS.join(", ")} on ${CONTRACT},`);
      console.log(`cannot attach NEAR and cannot touch tokens. Give the agent process this key and keep the full-access key offline:\n`);
      return console.log(`LOCA_PRIVATE_KEY=${kp.toString()}`);
    }
    case "storage": return void (await tx("storage_deposit", {}, { deposit: nearToYocto(flag("amount", "0.1") as `${number}`) }));
    case "agent deliver": {
      const d = flag("deliverable");
      const { existsSync, readFileSync } = await import("node:fs");
      const body = existsSync(d) ? readFileSync(d, "utf8") : d;
      return void (await tx("mark_delivered", { order_id: Number(flag("order")), deliverable_hash: sha256(body) }, { gas: AGENT_GAS }));
    }
    case "agent withdraw": case "lender withdraw": case "customer withdraw": case "withdraw": {
      // A token transfer to an unregistered account bounces (the contract keeps the balance owed).
      const { token_id } = await config();
      const reg = await view<unknown>("storage_balance_of", { account_id: me().accountId }, token_id).catch(() => null);
      if (!reg) {
        try {
          await tx("register", { account_ids: [me().accountId] }, { contract: token_id });
        } catch {
          // A restricted agent key can't call the token contract.
          throw new Error(`${me().accountId} isn't registered with the token yet, and this key can't register it. Ask your operator to run "pnpm join faucet" once with the account's full-access key.`);
        }
      }
      const r = await tx("withdraw", {}, { gas: 60_000_000_000_000n });
      if (r.events.some((e) => e.event === "withdraw_failed")) console.log("Withdraw failed and your balance was restored. Is your account registered with the token?");
      return;
    }

    case "operator policy":
      return void (await tx("set_spend_policy", {
        agent_id: flag("agent"), allowed_vendors: flag("vendors").split(",").map((v) => v.trim()), max_principal: usd(Number(flag("max"))).toString(),
      }));
    case "operator bond": return void (await ftCall(usd(Number(flag("amount"))), { PostBond: { agent_id: flag("agent") } }));

    case "lender bid": {
      const order = await view<Order>("get_order", { order_id: Number(flag("order")) });
      if (!order?.credit_request) throw new Error("That order has no open credit request.");
      const expires = nowNs() + BigInt(flag("minutes", "5")) * 60n * SEC;
      await ensureStorage();
      const r = await ftCall(BigInt(order.credit_request.amount), {
        MakeOffer: { order_id: order.id, fee: usd(Number(flag("fee"))).toString(), expires_at: expires.toString(), strategy: flag("strategy", "manual") },
      });
      const made = r.events.find((e) => e.event === "offer_made");
      if (made) console.log(`Bid placed: offer #${made.data.offer_id}. The agent accepts with "agent accept --offer ${made.data.offer_id}".`);
      return;
    }
    case "lender run": return lenderRun();

    case "customer order": {
      const deadline = nowNs() + BigInt(flag("deadline-min", "60")) * 60n * SEC;
      return void (await ftCall(usd(Number(flag("amount"))), {
        FundOrder: { agent_id: flag("agent"), terms_hash: sha256(flag("terms", "order")), deadline: deadline.toString() },
      }));
    }
    case "customer approve": return void (await tx("approve", { order_id: Number(flag("order")) }));
    case "customer dispute": return void (await tx("dispute", { order_id: Number(flag("order")), reason_hash: sha256(flag("reason")) }));
    case "customer cancel": return void (await tx("cancel_order", { order_id: Number(flag("order")) }));

    default: console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e instanceof ContractError ? `Refused by the contract: ${e.code ?? e.message}` : e instanceof Error ? e.message : e);
  process.exit(1);
});
