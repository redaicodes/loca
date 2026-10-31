// Attack the live market and record what stops each attempt. Writes docs/guardrails.json.
//
//   pnpm guardrails
//
// Uses its own accounts under SWARM_ACCOUNT_ID (join-agent, join-op, join-cust, join-lender,
// guard-nostore), so the swarm's agents are not disturbed. Two layers are tested:
//   contract  the Loca contract refuses (a failed receipt, or a deposit credited back)
//   runtime   NEAR refuses before the contract runs (the agent's function-call key)

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto } from "near-api-js";
import { call, ContractError, type TxResult } from "../src/lib/near.js";
import { usd } from "../src/lib/types.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SWARM_ACCOUNT_ID!;
const SUB = process.env.SWARM_SUBKEY as KeyPairString;
const MARKET = `market.${ROOT}`;
const USDC = `usdc.${ROOT}`;
const DATAHUB = `datahub.${ROOT}`;
const AGENT_METHODS = ["request_credit", "accept_offer", "mark_delivered", "withdraw", "update_profile"];
const SEC = 1_000_000_000n;

const provider = new FailoverRpcProvider(
  ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"]
    .map((url) => new JsonRpcProvider({ url }, { retries: 4, wait: 800, backoff: 1.7 })),
);
const acct = (slug: string, key: string = SUB) => new Account(`${slug}.${ROOT}`, provider, key as KeyPairString);
const root = new Account(ROOT, provider, process.env.SWARM_PRIVATE_KEY as KeyPairString);
const view = <T>(method: string, args: Record<string, unknown> = {}, contract = MARKET) =>
  provider.callFunction({ contractId: contract, method, args }) as Promise<T>;
const now = () => BigInt(Date.now()) * 1_000_000n;

type Layer = "contract" | "runtime";
interface Case { title: string; actor: string; attempt: string; layer: Layer; expected: string; got: string; tx: string | null; passed: boolean }
const cases: Case[] = [];

async function attempt(title: string, actor: string, desc: string, layer: Layer, expected: string, fn: () => Promise<TxResult>) {
  let got = "SUCCEEDED", tx: string | null = null;
  try {
    const r = await fn();
    tx = r.hash;
    const rej = r.events.find((e) => e.event === "deposit_rejected");
    if (rej) got = String(rej.data.reason);
  } catch (e) {
    if (e instanceof ContractError) { got = e.code ?? e.message.slice(0, 80); tx = e.hash; }
    else {
      const m = String((e as Error).message ?? e);
      // NEAR rejects these before execution, so there is no transaction; keep the error's name.
      const name = (e as Error).constructor?.name ?? "";
      got = `${name} ${m}`.match(/MethodNameMismatch|ReceiverMismatch|DepositWithFunctionCall|NotEnoughAllowance|ERR_[A-Z_]+/)?.[0] ?? `${name}: ${m}`.slice(0, 120);
    }
  }
  const passed = got === expected;
  cases.push({ title, actor, attempt: desc, layer, expected, got, tx, passed });
  console.log(`${passed ? "BLOCKED " : "UNEXPECTED"}  ${title}: ${got}${tx ? `  https://testnet.nearblocks.io/txns/${tx}` : ""}`);
}

const ft = (from: Account, amount: bigint, msg: unknown) =>
  call(from, USDC, "ft_transfer_call", { receiver_id: MARKET, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
const lastOrder = async () => (await view<{ next_order_id: number }>("get_market")).next_order_id - 1;

async function main() {
  const op = acct("join-op"), cust = acct("join-cust"), lender = acct("join-lender"), agentFull = acct("join-agent");

  // ---------- setup (not recorded) ----------
  for (const slug of ["guard-nostore", "join-lender2"]) {
    await root.createSubAccount({ accountOrPrefix: slug, publicKey: KeyPair.fromString(SUB).getPublicKey().toString(), nearToTransfer: nearToYocto("0.5") }).catch(() => {});
  }
  const lender2 = acct("join-lender2");
  await call(root, USDC, "register", { account_ids: [lender2.accountId, `guard-nostore.${ROOT}`] });
  for (const a of [cust, lender, lender2, op]) await call(root, USDC, "mint", { account_id: a.accountId, amount: usd(500).toString() });
  await call(op, MARKET, "storage_deposit", { account_id: agentFull.accountId }, nearToYocto("0.1"));
  for (const l of [lender, lender2]) {
    if (BigInt(await view<string>("storage_balance_of", { account_id: l.accountId })) > 0n) {
      await call(l, MARKET, "storage_withdraw", {}); // start without storage, to show the refusal
    }
  }
  if (!(await view("get_agent", { agent_id: `guard-nostore.${ROOT}` }))) {
    await call(acct("guard-nostore"), MARKET, "register_agent", { operator_id: op.accountId, profile_hash: "guard" }, nearToYocto("0.01"));
  }
  // The agent process gets a key that can call only the agent methods on the market.
  const kp = KeyPair.fromRandom("ed25519");
  await agentFull.addFunctionCallAccessKey({ publicKey: kp.getPublicKey().toString(), contractId: MARKET, methodNames: AGENT_METHODS, allowance: nearToYocto("0.5") });
  const agent = acct("join-agent", kp.toString());
  // A failover provider retries invalid transactions on every endpoint and hides the reason, so
  // the key-permission attempts go through one endpoint directly.
  const agentDirect = new Account(agent.accountId, new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" }, { retries: 3, wait: 1500, backoff: 2 }), kp.toString() as KeyPairString);
  const deadline = (now() + 3600n * SEC).toString();
  const reqExpiry = () => (now() + 600n * SEC).toString();
  console.log("setup done\n");

  // ---------- who may pay for an order ----------
  await attempt("Operator pays its own agent", "operator", "fund an order for the agent it operates, to fake revenue", "contract", "ERR_CUSTOMER_RELATED_PARTY",
    () => ft(op, usd(50), { FundOrder: { agent_id: agentFull.accountId, terms_hash: "wash", deadline } }));
  await attempt("Dust order", "customer", "fund a $0.50 order to bloat contract state", "contract", "ERR_ORDER_TOO_SMALL",
    () => ft(cust, 500_000n, { FundOrder: { agent_id: agentFull.accountId, terms_hash: "dust", deadline } }));
  await attempt("Order for an agent with no prepaid storage", "customer", "make the market pay for a new order's storage", "contract", "ERR_STORAGE_DEPOSIT_REQUIRED",
    () => ft(cust, usd(20), { FundOrder: { agent_id: `guard-nostore.${ROOT}`, terms_hash: "spam", deadline } }));

  const funded = await ft(cust, usd(100), { FundOrder: { agent_id: agentFull.accountId, terms_hash: "guardrail-run", deadline } });
  const orderId = Number(funded.events.find((e) => e.event === "order_funded")!.data.order_id);

  // ---------- what the agent may borrow ----------
  await attempt("Advance above 50% of the order", "agent", "borrow $60 against a $100 order", "contract", "ERR_EXCEEDS_ADVANCE_RATE",
    () => call(agent, MARKET, "request_credit", { order_id: orderId, amount: usd(60).toString(), vendor_id: DATAHUB, max_fee: usd(3).toString(), expires_at: reqExpiry() }, 0n, 30_000_000_000_000n));
  await attempt("Loan routed to the operator", "agent", "send the borrowed money to its own operator", "contract", "ERR_VENDOR_NOT_IN_POLICY",
    () => call(agent, MARKET, "request_credit", { order_id: orderId, amount: usd(30).toString(), vendor_id: op.accountId, max_fee: usd(3).toString(), expires_at: reqExpiry() }, 0n, 30_000_000_000_000n));
  await call(op, MARKET, "set_spend_policy", { agent_id: agentFull.accountId, allowed_vendors: [DATAHUB, lender2.accountId], max_principal: usd(50).toString() });
  await attempt("Loan to a vendor the protocol hasn't approved", "agent", "pay a vendor the operator listed but the market never approved", "contract", "ERR_VENDOR_NOT_APPROVED",
    () => call(agent, MARKET, "request_credit", { order_id: orderId, amount: usd(30).toString(), vendor_id: lender2.accountId, max_fee: usd(3).toString(), expires_at: reqExpiry() }, 0n, 30_000_000_000_000n));
  await call(op, MARKET, "set_spend_policy", { agent_id: agentFull.accountId, allowed_vendors: [DATAHUB], max_principal: usd(50).toString() });
  await call(agent, MARKET, "request_credit", { order_id: orderId, amount: usd(30).toString(), vendor_id: DATAHUB, max_fee: usd(3).toString(), expires_at: reqExpiry() }, 0n, 30_000_000_000_000n);

  // ---------- who may lend ----------
  const offerExp = () => (now() + 300n * SEC).toString();
  await attempt("Customer lends against its own order", "customer", "bid on the order it paid for", "contract", "ERR_LENDER_RELATED_PARTY",
    () => ft(cust, usd(30), { MakeOffer: { order_id: orderId, fee: usd(1).toString(), expires_at: offerExp(), strategy: "x" } }));
  await attempt("Lender bids without prepaid storage", "lender", "make the market pay for the bid's storage", "contract", "ERR_STORAGE_DEPOSIT_REQUIRED",
    () => ft(lender, usd(30), { MakeOffer: { order_id: orderId, fee: usd(1).toString(), expires_at: offerExp(), strategy: "x" } }));
  await call(lender, MARKET, "storage_deposit", {}, nearToYocto("0.05"));
  await call(lender2, MARKET, "storage_deposit", {}, nearToYocto("0.05"));
  await attempt("Fee above the agent's maximum", "lender", "bid $5 when the agent capped fees at $3", "contract", "ERR_FEE_TOO_HIGH",
    () => ft(lender, usd(30), { MakeOffer: { order_id: orderId, fee: usd(5).toString(), expires_at: offerExp(), strategy: "x" } }));
  const bid = await ft(lender, usd(30), { MakeOffer: { order_id: orderId, fee: usd(1.5).toString(), expires_at: offerExp(), strategy: "manual" } });
  const offerId = Number(bid.events.find((e) => e.event === "offer_made")!.data.offer_id);
  await call(agent, MARKET, "accept_offer", { offer_id: offerId }, 0n, 30_000_000_000_000n);
  await attempt("Second loan on the same order", "lender", "lend against an order that already backs a loan", "contract", "ERR_ORDER_ALREADY_PLEDGED",
    () => ft(lender2, usd(30), { MakeOffer: { order_id: orderId, fee: usd(1).toString(), expires_at: offerExp(), strategy: "x" } }));
  await attempt("Bond pulled during a loan", "agent account", "withdraw the first-loss bond while a loan is open", "contract", "ERR_ACTIVE_LOANS",
    () => call(agentFull, MARKET, "withdraw_bond", { amount: usd(5).toString() }));

  // ---------- settlement ----------
  await attempt("Customer cancels before the deadline", "customer", "take the escrow back while the agent is still working", "contract", "ERR_BEFORE_DEADLINE",
    () => call(cust, MARKET, "cancel_order", { order_id: orderId }));
  await call(agent, MARKET, "mark_delivered", { order_id: orderId, deliverable_hash: "guardrail-report" }, 0n, 30_000_000_000_000n);
  await attempt("Early release", "anyone", "release the escrow before the customer's dispute window closes", "contract", "ERR_DISPUTE_WINDOW_OPEN",
    () => call(root, MARKET, "finalize", { order_id: orderId }));

  // ---------- the agent's own key ----------
  await attempt("Agent key moves tokens", "agent key", "transfer USDC straight out of the agent's wallet", "runtime", "ReceiverMismatch",
    () => call(agentDirect, USDC, "ft_transfer", { receiver_id: op.accountId, amount: "1" }, 0n, 30_000_000_000_000n));
  await attempt("Agent key calls an admin method", "agent key", "approve its own vendor on the market", "runtime", "MethodNameMismatch",
    () => call(agentDirect, MARKET, "add_vendor", { vendor_id: op.accountId }, 0n, 30_000_000_000_000n));
  await attempt("Agent key attaches money", "agent key", "attach NEAR to a call", "runtime", "DepositWithFunctionCall",
    () => call(agentDirect, MARKET, "request_credit", { order_id: orderId, amount: "1", vendor_id: DATAHUB, max_fee: "1", expires_at: reqExpiry() }, 1n, 30_000_000_000_000n));

  await call(cust, MARKET, "approve", { order_id: orderId });
  await agentFull.deleteKey(kp.getPublicKey().toString()).catch(() => {});

  const out = { contract: MARKET, ranAt: new Date().toISOString(), orderId, cases };
  writeFileSync(join(ROOT_DIR, "docs/guardrails.json"), JSON.stringify(out, null, 2));
  const failed = cases.filter((c) => !c.passed);
  console.log(`\n${cases.length - failed.length}/${cases.length} attempts blocked as expected. Written to docs/guardrails.json`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
