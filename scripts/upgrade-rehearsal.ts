// Rehearse an in-place upgrade of the live market on a local sandbox before touching testnet.
//
//   OLD_WASM=path/to/deployed.wasm npx tsx scripts/upgrade-rehearsal.ts
//
// Deploys the old build (the one live on testnet), trades on it (levered orders that settle, an open one
// with a withdrawn bid, a bond), deploys the current build over it, runs `migrate`, then checks that
// history, totals and balances survived and that the new rules hold: operator fee caps, deposits only in
// the sender's own name, withdrawn bids leaving the order, anyone cancelling an abandoned order after
// the grace period, and `prune_orders` removing an order the prune cursor had passed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Account, nearToYocto } from "near-api-js";
import { call, chainNowNs, connect, ContractError, view } from "../src/lib/near.js";
import { usd } from "../src/lib/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = process.env.OLD_WASM ?? join(ROOT, "runs/wasm-v4/loca.wasm");
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
  await call(agent, M, "register_agent", { operator_id: operator.accountId, profile_hash: "p" }, nearToYocto("0.5"));
  for (const l of [l1, l2]) await call(l, M, "storage_deposit", {}, nearToYocto("0.1"));
  await call(operator, M, "set_spend_policy", { agent_id: agent.accountId, allowed_vendors: [vendor.accountId], max_principal: usd(50).toString() });
  const ft = (from: Account, amount: bigint, msg: unknown) =>
    call(from, U, "ft_transfer_call", { receiver_id: M, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
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
  // On the old build a withdrawn bid stays in the order's list.
  await call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(1).toString(), expires_at: (now0 + 20n * SEC).toString() });
  const oldBid = await ft(l1, usd(10), { MakeOffer: { order_id: openId, fee: usd(1).toString(), expires_at: (now0 + 15n * SEC).toString(), strategy: "x" } });
  await call(l1, M, "withdraw_offer", { offer_id: Number(oldBid.events.find((e) => e.event === "offer_made")!.data.offer_id) });

  const before = await view<{ totals: Record<string, unknown>; prune_cursor: number; orders_pruned: number }>(p, M, "get_market");
  const agentBefore = await view<Record<string, unknown>>(p, M, "get_agent", { agent_id: agent.accountId });
  const stBefore = await view<string>(p, M, "storage_balance_of", { account_id: agent.accountId });
  console.log(`old build: ${before.totals.orders} orders, ${before.totals.loans} loans\n`);

  // ---------- upgrade ----------
  await loca.deployContract(readFileSync(NEW));
  await call(loca, M, "migrate", { forwarders: [] });
  const after = await view<{ totals: Record<string, unknown>; prune_cursor: number; orders_pruned: number }>(p, M, "get_market");
  check(JSON.stringify(after.totals) === JSON.stringify(before.totals), "market totals carried over unchanged");
  check(after.prune_cursor === before.prune_cursor && after.orders_pruned === before.orders_pruned, "prune cursor and counter carried over");
  check(JSON.stringify(await view(p, M, "get_agent", { agent_id: agent.accountId })) === JSON.stringify(agentBefore), "agent record (stats, bond, policy) carried over");
  check((await view<{ status: string }>(p, M, "get_order", { order_id: openId })).status === "Funded", "open order still in escrow");
  check((await view<string>(p, M, "storage_balance_of", { account_id: agent.accountId })) === stBefore, "prepaid storage balances carried over");
  check((await view<number>(p, M, "get_fee_cap", { agent_id: agent.accountId })) === 1000, "agents start with the 10% default fee cap");
  console.log(`      score after upgrade: ${(await view<{ score: number; rated: boolean }>(p, M, "get_score", { agent_id: agent.accountId })).score}`);

  // ---------- new rules on migrated state ----------
  const now1 = await chainNowNs(p);
  const fake = await ft(operator, usd(5), { FundOrder: { agent_id: agent.accountId, terms_hash: "wash", deadline: (now1 + 3600n * SEC).toString(), customer_id: "made-up.test.near" } });
  check(fake.events.some((e) => e.event === "deposit_rejected" && e.data.reason === "ERR_CUSTOMER_NOT_SENDER"), "order in a made-up customer's name is credited back");
  await refused(call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(2).toString(), expires_at: (now1 + 30n * SEC).toString() }), "ERR_FEE_ABOVE_POLICY", "agent asks for a 20% fee");
  await refused(call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(1).toString(), expires_at: (now1 + 2n * 3600n * SEC).toString() }), "ERR_BAD_EXPIRY", "request outliving the order");
  await call(operator, M, "set_spend_policy", { agent_id: agent.accountId, allowed_vendors: [vendor.accountId], max_principal: usd(50).toString(), max_fee_bps: 1500 });
  check((await view<number>(p, M, "get_fee_cap", { agent_id: agent.accountId })) === 1500, "operator raises the fee cap to 15%");
  await call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(1).toString(), expires_at: (now1 + 30n * SEC).toString() });
  const l2St = BigInt(await view<string>(p, M, "storage_balance_of", { account_id: l2.accountId }));
  const bid = await ft(l2, usd(10), { MakeOffer: { order_id: openId, fee: usd(1).toString(), expires_at: (now1 + 25n * SEC).toString(), strategy: "y" } });
  const bidId = Number(bid.events.find((e) => e.event === "offer_made")!.data.offer_id);
  await call(l2, M, "withdraw_offer", { offer_id: bidId });
  const openNow = await view<{ offer_ids: number[] }>(p, M, "get_order", { order_id: openId });
  check(!openNow.offer_ids.includes(bidId) && (await view(p, M, "get_offer", { offer_id: bidId })) === null, "withdrawn bid leaves the order");
  check(BigInt(await view<string>(p, M, "storage_balance_of", { account_id: l2.accountId })) === l2St, "its storage deposit goes back to the lender");
  await refused(call(l2, M, "cancel_order", { order_id: openId }), "ERR_BEFORE_DEADLINE", "stranger cancels before the deadline");

  // ---------- abandoned order: anyone cancels after the grace period, then prune_orders removes it ----------
  const start = await chainNowNs(p);
  while ((await chainNowNs(p)) - start < 6n * 3600n * SEC + 60n * SEC) {
    await (p as unknown as { sendJsonRpc(m: string, a: unknown): Promise<unknown> }).sendJsonRpc("sandbox_fast_forward", { delta_height: 5_000 });
    console.log(`      clock +${Number(((await chainNowNs(p)) - start) / SEC / 60n)} min`);
  }
  const pr = await call<number>(env.root, M, "prune", { limit: 50 });
  check(pr.value === 3, `prune removes the 3 settled orders (got ${pr.value}) and passes the open one`);
  await call(l2, M, "cancel_order", { order_id: openId });
  check((await view<{ status: string }>(p, M, "get_order", { order_id: openId })).status === "Refunded", "stranger cancels the abandoned order after the grace period");
  check((await call<number>(env.root, M, "prune", { limit: 50 })).value === 0, "the cursor has moved past it");
  check((await call<number>(env.root, M, "prune_orders", { order_ids: [openId] })).value === 1, "prune_orders removes it by id");
  const accAfter = await p.viewAccount({ accountId: M });
  const st = async (a: Account) => BigInt(await view<string>(p, M, "storage_balance_of", { account_id: a.accountId }));
  const balances = (await Promise.all([agent, l1, l2, operator, cust].map(st))).reduce((x, y) => x + y, 0n) +
    BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId }));
  check(BigInt(accAfter.amount) - BigInt(accAfter.storage_usage) * 10n ** 19n >= balances, "market can pay back every prepaid storage balance");
} finally {
  await env.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nUpgrade rehearsal passed.");
process.exit(failures ? 1 : 0);
