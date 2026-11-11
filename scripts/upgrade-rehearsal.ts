// Rehearse an in-place upgrade of the live market on a local sandbox before touching testnet.
//
//   OLD_WASM=path/to/deployed.wasm npx tsx scripts/upgrade-rehearsal.ts
//
// Deploys the old build (the one live on testnet), trades on it (levered orders that settle, an open one,
// a bond, a fee cap, a forwarder), deploys the current build over it, runs `migrate`, then checks that
// history, totals, settings and balances survived and that the new rules hold: a ten-minute minimum
// order window, operator order minimums, rejected deposits returned through the token, a request alone
// not locking the bond, agent earnings and storage paid to the operator, cancellations of untouched
// orders not counting and pruning at once, and the owner-set dispute window.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Account, nearToYocto } from "near-api-js";
import { call, chainNowNs, connect, ContractError, view } from "../src/lib/near.js";
import { usd } from "../src/lib/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = process.env.OLD_WASM ?? join(ROOT, "runs/wasm-v5/loca.wasm");
const NEW = join(ROOT, "contracts/target/near/loca/loca.wasm");
const TOKEN = join(ROOT, "contracts/target/near/test_token/test_token.wasm");
const SEC = 1_000_000_000n;

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures++;
}
async function refused(p: Promise<unknown>, code: string, what: string) {
  try {
    await p;
    check(false, `${what} (succeeded)`);
  } catch (e) {
    check(e instanceof ContractError && e.code === code, `${what}: ${e instanceof ContractError ? e.code : String(e).slice(0, 80)}`);
  }
}

const env = await connect("sandbox");
const p = env.provider;
try {
  const [loca, usdc, arbiter, operator, agent, vendor, cust, l1, l2] = await Promise.all(
    ["loca", "usdc", "arbiter", "operator", "agent", "vendor", "cust", "l1", "l2"].map((n) => env.account(n, n === "loca" ? "20" : "5")),
  );
  const M = loca.accountId, U = usdc.accountId;
  await usdc.deployContract(readFileSync(TOKEN));
  await call(usdc, U, "new", { symbol: "USDC", decimals: 6 });
  await loca.deployContract(readFileSync(OLD));
  await call(loca, M, "new", { owner_id: env.root.accountId, arbiter_id: arbiter.accountId, token_id: U, dispute_window_sec: 5, max_advance_bps: 5000 });
  await call(env.root, U, "register", { account_ids: [M, operator, agent, vendor, cust, l1, l2, arbiter].map((a) => (typeof a === "string" ? a : a.accountId)) });
  for (const a of [cust, operator, l1, l2]) await call(env.root, U, "mint", { account_id: a.accountId, amount: usd(500).toString() });
  await call(env.root, M, "add_vendor", { vendor_id: vendor.accountId });
  await call(env.root, M, "set_forwarders", { forwarders: ["intents.test.near"] });
  await call(agent, M, "register_agent", { operator_id: operator.accountId, profile_hash: "p" }, nearToYocto("0.5"));
  for (const l of [l1, l2]) await call(l, M, "storage_deposit", {}, nearToYocto("0.1"));
  await call(operator, M, "set_spend_policy", { agent_id: agent.accountId, allowed_vendors: [vendor.accountId], max_principal: usd(50).toString(), max_fee_bps: 1500 });
  const ft = (from: Account, amount: bigint, msg: unknown) =>
    call(from, U, "ft_transfer_call", { receiver_id: M, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
  const tokens = async (a: Account) => BigInt(await view<string>(p, U, "ft_balance_of", { account_id: a.accountId }));
  const st = async (a: Account) => BigInt(await view<string>(p, M, "storage_balance_of", { account_id: a.accountId }));
  await ft(operator, usd(20), { PostBond: { agent_id: agent.accountId } });

  /** One levered order that settles, with two bids. */
  const levered = async () => {
    const now = await chainNowNs(p);
    const r = await ft(cust, usd(100), { FundOrder: { agent_id: agent.accountId, terms_hash: "t", deadline: (now + 3600n * SEC).toString() } });
    const id = Number(r.events.find((e) => e.event === "order_funded")!.data.order_id);
    await call(agent, M, "request_credit", { order_id: id, amount: usd(30).toString(), vendor_id: vendor.accountId, max_fee: usd(3).toString(), expires_at: (now + 30n * SEC).toString() });
    const b = await ft(l1, usd(30), { MakeOffer: { order_id: id, fee: usd(1).toString(), expires_at: (now + 25n * SEC).toString(), strategy: "x" } });
    await ft(l2, usd(30), { MakeOffer: { order_id: id, fee: usd(2).toString(), expires_at: (now + 25n * SEC).toString(), strategy: "y" } });
    await call(agent, M, "accept_offer", { offer_id: Number(b.events.find((e) => e.event === "offer_made")!.data.offer_id) });
    await call(agent, M, "mark_delivered", { order_id: id, deliverable_hash: "d" });
    await call(cust, M, "approve", { order_id: id });
    return id;
  };
  for (let i = 0; i < 3; i++) await levered();
  const now0 = await chainNowNs(p);
  const openOrder = await ft(cust, usd(40), { FundOrder: { agent_id: agent.accountId, terms_hash: "open", deadline: (now0 + 3600n * SEC).toString() } });
  const openId = Number(openOrder.events.find((e) => e.event === "order_funded")!.data.order_id);

  const before = await view<{ totals: Record<string, unknown>; prune_cursor: number; orders_pruned: number }>(p, M, "get_market");
  const agentBefore = await view<Record<string, unknown>>(p, M, "get_agent", { agent_id: agent.accountId });
  const scoreBefore = await view<{ score: number }>(p, M, "get_score", { agent_id: agent.accountId });
  const stBefore = await st(agent);
  console.log(`old build: ${before.totals.orders} orders, ${before.totals.loans} loans, score ${scoreBefore.score}\n`);

  // ---------- upgrade ----------
  await loca.deployContract(readFileSync(NEW));
  await call(loca, M, "migrate", {});
  const after = await view<{ totals: Record<string, unknown>; prune_cursor: number; orders_pruned: number }>(p, M, "get_market");
  check(JSON.stringify(after.totals) === JSON.stringify(before.totals), "market totals carried over unchanged");
  check(after.prune_cursor === before.prune_cursor && after.orders_pruned === before.orders_pruned, "prune cursor and counter carried over");
  check(JSON.stringify(await view(p, M, "get_agent", { agent_id: agent.accountId })) === JSON.stringify(agentBefore), "agent record (stats, bond, policy) carried over");
  check((await view<{ status: string }>(p, M, "get_order", { order_id: openId })).status === "Funded", "open order still in escrow");
  check((await st(agent)) === stBefore, "prepaid storage balances carried over");
  check((await view<number>(p, M, "get_fee_cap", { agent_id: agent.accountId })) === 1500, "the operator's 15% fee cap carried over");
  check(JSON.stringify((await view<{ forwarders: string[] }>(p, M, "get_config")).forwarders) === '["intents.test.near"]', "forwarders carried over");
  check((await view<string>(p, M, "get_order_minimum", { agent_id: agent.accountId })) === usd(1).toString(), "agents start with the $1 protocol minimum");
  const scoreAfter = await view<{ score: number; version: string }>(p, M, "get_score", { agent_id: agent.accountId });
  check(scoreAfter.version === "v1", `score v1 on the same history: ${scoreBefore.score} -> ${scoreAfter.score}`);

  // ---------- new rules on migrated state ----------
  const now1 = await chainNowNs(p);
  const custTokens = await tokens(cust);
  const quick = await ft(cust, usd(5), { FundOrder: { agent_id: agent.accountId, terms_hash: "quick", deadline: (now1 + 60n * SEC).toString() } });
  check(quick.events.some((e) => e.event === "deposit_rejected" && e.data.reason === "ERR_DEADLINE_TOO_SOON" && e.data.returned === true), "order due in a minute: ERR_DEADLINE_TOO_SOON");
  check((await tokens(cust)) === custTokens && (await view<string>(p, M, "get_balance", { account_id: cust.accountId })) === "0", "its tokens went back to the customer through the token, no market balance left");
  await call(operator, M, "set_order_minimum", { agent_id: agent.accountId, min_order: usd(10).toString() });
  const small = await ft(cust, usd(5), { FundOrder: { agent_id: agent.accountId, terms_hash: "small", deadline: (now1 + 3600n * SEC).toString() } });
  check(small.events.some((e) => e.event === "deposit_rejected" && e.data.reason === "ERR_ORDER_TOO_SMALL"), "operator sets a $10 minimum; a $5 order is refused");
  await refused(call(agent, M, "set_order_minimum", { agent_id: agent.accountId, min_order: usd(1).toString() }), "ERR_NOT_OPERATOR", "agent lowers its own minimum");

  // A request alone no longer locks the bond. (Let the old build's request-time lock run out first.)
  const ff = async (until: bigint) => {
    while ((await chainNowNs(p)) < until) await (p as unknown as { sendJsonRpc(m: string, a: unknown): Promise<unknown> }).sendJsonRpc("sandbox_fast_forward", { delta_height: 200 });
  };
  await ff(now0 + 60n * SEC);
  const now3 = await chainNowNs(p);
  await call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(1).toString(), expires_at: (now3 + 1800n * SEC).toString() });
  await call(operator, M, "withdraw_bond", { agent_id: agent.accountId, amount: usd(1).toString() });
  check(true, "operator withdraws bond while a request with no bids is open");
  await ft(l1, usd(10), { MakeOffer: { order_id: openId, fee: usd(1).toString(), expires_at: (now3 + 1200n * SEC).toString(), strategy: "x" } });
  await refused(call(operator, M, "withdraw_bond", { agent_id: agent.accountId, amount: usd(1).toString() }), "ERR_BOND_LOCKED", "once a lender bids, the bond is locked");

  // Agent earnings and storage go to the operator.
  const opTokens = await tokens(operator);
  const owed = BigInt(await view<string>(p, M, "get_balance", { account_id: agent.accountId }));
  await call(agent, M, "withdraw", {}, 0n, 60n * 10n ** 12n);
  check(owed > 0n && (await tokens(operator)) === opTokens + owed && (await tokens(agent)) === 0n, `agent withdraws $${Number(owed) / 1e6}: paid to the operator`);
  await refused(call(l1, M, "withdraw_agent_storage", { agent_id: agent.accountId }), "ERR_NOT_OPERATOR", "stranger takes the agent's storage NEAR");
  const stNow = await st(agent);
  const half = stNow / 2n;
  await call(operator, M, "withdraw_agent_storage", { agent_id: agent.accountId, amount: half.toString() });
  check((await st(agent)) === stNow - half, "operator takes back half the agent's storage NEAR");

  // An order the agent never took on: cancelling it does not count, and it prunes at once.
  const now2 = await chainNowNs(p);
  const grief = await ft(cust, usd(10), { FundOrder: { agent_id: agent.accountId, terms_hash: "grief", deadline: (now2 + 601n * SEC).toString() } });
  const griefId = Number(grief.events.find((e) => e.event === "order_funded")!.data.order_id);
  const stGrief = await st(agent);
  const refundedBefore = (await view<{ stats: { orders_refunded: number } }>(p, M, "get_agent", { agent_id: agent.accountId })).stats.orders_refunded;
  await ff(now2 + 602n * SEC);
  await call(cust, M, "cancel_order", { order_id: griefId });
  const refundedAfter = (await view<{ stats: { orders_refunded: number } }>(p, M, "get_agent", { agent_id: agent.accountId })).stats.orders_refunded;
  check(refundedAfter === refundedBefore, "customer cancels an order the agent never took on: not counted against it");
  check((await call<number>(env.root, M, "prune_orders", { order_ids: [griefId] })).value === 1, "and anyone prunes it at once");
  check((await st(agent)) === stGrief + 5n * 10n ** 21n, "which hands the agent its storage back");

  await call(env.root, M, "set_dispute_window", { dispute_window_sec: 900 });
  check((await view<{ dispute_window_ns: string }>(p, M, "get_config")).dispute_window_ns === (900n * SEC).toString(), "owner sets a 15-minute dispute window");
  await refused(call(operator, M, "set_dispute_window", { dispute_window_sec: 30 }), "ERR_NOT_OWNER", "operator changes the dispute window");

  const accAfter = await p.viewAccount({ accountId: M });
  const balances = (await Promise.all([agent, l1, l2, operator, cust].map(st))).reduce((x, y) => x + y, 0n) +
    BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId }));
  check(BigInt(accAfter.amount) - BigInt(accAfter.storage_usage) * 10n ** 19n >= balances, "market can pay back every prepaid storage balance");
  const t = (await view<{ totals: Record<string, string> }>(p, M, "get_market")).totals;
  const locked = ["escrow_held", "offers_open", "bonds_held", "claimable"].reduce((x, k) => x + BigInt(t[k]), 0n);
  check(locked === BigInt(await view<string>(p, U, "ft_balance_of", { account_id: M })), "value locked equals the market's token balance");
} finally {
  await env.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nUpgrade rehearsal passed.");
process.exit(failures ? 1 : 0);
