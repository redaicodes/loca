// Rehearse an in-place upgrade of the live market on a local sandbox before touching testnet.
//
//   OLD_WASM=path/to/deployed.wasm npx tsx scripts/upgrade-rehearsal.ts
//
// Deploys the old build, trades on it (a levered order that settles, an open one, a bond), deploys the
// current build over it, runs `migrate`, then checks that history, totals and balances survived and
// that the new rules hold: bond locks, operator-only bond withdrawal, and pruning with storage refunds.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Account, nearToYocto } from "near-api-js";
import { call, chainNowNs, connect, ContractError, view } from "../src/lib/near.js";
import { usd } from "../src/lib/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = process.env.OLD_WASM ?? join(ROOT, "runs/wasm-v3/loca.wasm");
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

  const before = await view<{ totals: Record<string, unknown> }>(p, M, "get_market");
  const agentBefore = await view<Record<string, unknown>>(p, M, "get_agent", { agent_id: agent.accountId });
  const scoreBefore = await view<{ score: number }>(p, M, "get_score", { agent_id: agent.accountId });
  console.log(`old build: ${before.totals.orders} orders, ${before.totals.loans} loans\n`);

  // ---------- upgrade ----------
  await loca.deployContract(readFileSync(NEW));
  await call(loca, M, "migrate", { charged_from_order: 1 }); // pretend order 0 predates storage charging
  const after = await view<{ totals: Record<string, unknown>; prune_cursor: number }>(p, M, "get_market");
  check(JSON.stringify(after.totals) === JSON.stringify(before.totals), "market totals carried over unchanged");
  check(JSON.stringify(await view(p, M, "get_agent", { agent_id: agent.accountId })) === JSON.stringify(agentBefore), "agent record (stats, bond, policy) carried over");
  check((await view<{ score: number }>(p, M, "get_score", { agent_id: agent.accountId })).score === scoreBefore.score, "score unchanged");
  check((await view<{ status: string }>(p, M, "get_order", { order_id: openId })).status === "Funded", "open order still in escrow");
  check(BigInt(await view<string>(p, M, "storage_balance_of", { account_id: agent.accountId })) > 0n, "prepaid storage balances carried over");

  // ---------- new rules on migrated state ----------
  await refused(call(agent, M, "withdraw_bond", { agent_id: agent.accountId, amount: usd(5).toString() }), "ERR_NOT_OPERATOR", "agent takes its operator's bond");
  const now1 = await chainNowNs(p);
  await call(agent, M, "request_credit", { order_id: openId, amount: usd(10).toString(), vendor_id: vendor.accountId, max_fee: usd(1).toString(), expires_at: (now1 + 20n * SEC).toString() });
  await refused(call(operator, M, "withdraw_bond", { agent_id: agent.accountId, amount: usd(5).toString() }), "ERR_BOND_LOCKED", "operator pulls the bond while lenders may bid");
  const stranger = await ft(cust, usd(5), { PostBond: { agent_id: agent.accountId } });
  check(stranger.events.some((e) => e.event === "deposit_rejected" && e.data.reason === "ERR_NOT_OPERATOR"), "bond from a non-operator is credited back");

  // An order made after the upgrade pays the new storage prices.
  const lateId = await levered();

  // ---------- pruning ----------
  check((await call<number>(env.root, M, "prune", { limit: 50 })).value === 0, "nothing prunable while orders are recent");
  // Jump past the six-hour pruning window in chunks (a big jump stalls the sandbox's RPC).
  const start = await chainNowNs(p);
  while ((await chainNowNs(p)) - start < 6n * 3600n * SEC + 60n * SEC) {
    await (p as unknown as { sendJsonRpc(m: string, a: unknown): Promise<unknown> }).sendJsonRpc("sandbox_fast_forward", { delta_height: 5_000 });
    console.log(`      clock +${Number(((await chainNowNs(p)) - start) / SEC / 60n)} min`);
  }
  const st = async (a: Account) => BigInt(await view<string>(p, M, "storage_balance_of", { account_id: a.accountId }));
  const [aSt, l1St, ownerSt] = [await st(agent), await st(l1), BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId }))];
  const accBefore = await p.viewAccount({ accountId: M });
  const totalsPre = JSON.stringify((await view<{ totals: unknown }>(p, M, "get_market")).totals);
  const scorePre = (await view<{ score: number }>(p, M, "get_score", { agent_id: agent.accountId })).score;
  const pr = await call<number>(env.root, M, "prune", { limit: 50 });
  const tx = await p.viewTransactionStatus({ txHash: pr.hash, accountId: env.root.accountId, waitUntil: "FINAL" });
  const gas = tx.receipts_outcome.reduce((g, r) => g + BigInt(r.outcome.gas_burnt), 0n);
  const accAfter = await p.viewAccount({ accountId: M });
  check(pr.value === 4, `pruned the 4 settled orders (got ${pr.value}), gas ${(Number(gas) / 1e12).toFixed(1)} TGas`);
  check((await view(p, M, "get_order", { order_id: lateId })) === null, "post-upgrade order removed");
  check((await view(p, M, "get_order", { order_id: 1 })) === null, "settled order removed");
  check((await view<{ status: string }>(p, M, "get_order", { order_id: openId })) !== null, "open order kept");
  const freed = (BigInt(accBefore.storage_usage) - BigInt(accAfter.storage_usage)) * 10n ** 19n;
  console.log(`      freed ${Number(freed) / 1e24} NEAR of storage; agent +${Number((await st(agent)) - aSt) / 1e24}, l1 +${Number((await st(l1)) - l1St) / 1e24}, owner +${Number(BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId })) - ownerSt) / 1e24}`);
  check((await st(agent)) > aSt && (await st(l1)) > l1St, "freed storage refunded to the agent and the lenders");
  const balances = (await Promise.all([agent, l1, l2, operator, cust].map(st))).reduce((x, y) => x + y, 0n) +
    BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId }));
  check(BigInt(accAfter.amount) - BigInt(accAfter.storage_usage) * 10n ** 19n >= balances, "market can pay back every prepaid storage balance");
  check(BigInt(await view<string>(p, M, "storage_balance_of", { account_id: env.root.accountId })) > ownerSt, "pre-charging order refunded to the owner");
  const m = await view<{ totals: Record<string, unknown>; orders_pruned: number }>(p, M, "get_market");
  check(m.orders_pruned === 4, "orders_pruned counter");
  check(JSON.stringify(m.totals) === totalsPre, "totals unchanged by pruning");
  check((await view<{ score: number }>(p, M, "get_score", { agent_id: agent.accountId })).score === scorePre, "score unchanged by pruning");
} finally {
  await env.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nUpgrade rehearsal passed.");
process.exit(failures ? 1 : 0);
