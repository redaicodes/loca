// The hosted agent swarm: a Cloudflare Worker that wakes every minute and moves the market one step.
//
// It keeps no state of its own. Each tick reads the open orders from the market contract and advances
// every one by a single step (borrow, bid, accept, deliver, approve, settle), then opens a few new
// orders. Each order's fate (does the agent borrow, miss the deadline, does the customer dispute) is a
// hash of its id, so every tick reaches the same decisions. Every account signs with its own key, derived
// from SWARM_SEED (src/swarm/keys.ts); agents hold only a function-call key for five market methods, and
// the worker holds no key for the market contract or the token.
//
// Free-plan limits shape the code: at most 50 network requests and a few ms of CPU per run, so one block
// hash and one nonce lookup per signer are shared across a tick, and signing uses native WebCrypto.

import { actions, baseDecode, base64Encode, createTransaction, encodeTransaction, KeyType, PublicKey, Signature, SignedTransaction } from "near-api-js";
import type { BidContext, BidDecision } from "../src/agents/lenders.js";
import { underwrite } from "../src/agents/underwriter.js";
import { AGENT_METHODS, AGENTS, CUSTOMERS, DISPUTE_WINDOW_SEC, LENDERS, OPERATORS, VENDORS, lenderQuote, vendorsOf, type AgentSpec } from "../src/swarm/cast.js";
import { deriveKey } from "../src/swarm/keys.js";
import type { Agent, Loan, Offer, Order, ScoreReport } from "../src/lib/types.js";

export interface Env {
  SWARM_ACCOUNT_ID: string;
  SWARM_PRIVATE_KEY: string;
  /** Seed every participant's key is derived from (src/swarm/keys.ts). */
  SWARM_SEED: string;
  RPCS?: string;
  /** New orders opened per tick when the root is well funded. */
  PACE?: string;
  PAUSED?: string;
  /** NEAR AI Cloud key for the AI underwriter lender; without it that lender sits out. */
  NEAR_AI_API_KEY?: string;
  NEAR_AI_MODEL?: string;
}

const TGAS = 1_000_000_000_000n;
const NEAR = 10n ** 24n;
const SEC = 1_000_000_000n;
const USDC_UNIT = 1_000_000n;
const REQUEST_BUDGET = 46; // free plan: 50 subrequests per invocation, keep a margin
const ORDER_TTL_SEC = 12 * 60;
const CREDIT_TTL_SEC = 4 * 60;

// ---------------------------------------------------------------- deterministic per-order fate

/** A stable pseudo-random number in [0,1) for (order, purpose). */
function roll(orderId: number, salt: string): number {
  let h = 2166136261 ^ orderId;
  for (const c of salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- chain access

class OutOfBudget extends Error {}
class TxFailed extends Error {
  constructor(message: string, readonly hash?: string) { super(message); }
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

class Signer {
  nonce?: bigint;
  private key?: CryptoKey;
  publicKey!: PublicKey;
  private chain: Promise<unknown> = Promise.resolve();
  /** The secret may still be being derived; `ready` resolves once it is loaded. */
  constructor(readonly accountId: string, private readonly secret: Promise<string>) {}
  async ready() {
    if (this.key) return;
    const raw = baseDecode((await this.secret).replace(/^ed25519:/, ""));
    this.publicKey = new PublicKey({ keyType: KeyType.ED25519, data: raw.slice(32, 64) });
    this.key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", d: b64url(raw.slice(0, 32)), x: b64url(raw.slice(32, 64)) }, { name: "Ed25519" }, false, ["sign"]);
  }
  async sign(hash: Uint8Array): Promise<Uint8Array> {
    await this.ready();
    return new Uint8Array(await crypto.subtle.sign("Ed25519", this.key!, new Uint8Array(hash)));
  }
  /** One transaction at a time per signer, so nonces stay in order. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => {}).then(fn);
    this.chain = next;
    return next;
  }
}

class Chain {
  requests = 0;
  txs = 0;
  private blockHash?: Uint8Array;
  private rpcs: string[];
  constructor(rpcs: string) {
    this.rpcs = rpcs.split(",").map((s) => s.trim()).filter(Boolean);
  }
  left() { return REQUEST_BUDGET - this.requests; }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.requests >= REQUEST_BUDGET) throw new OutOfBudget("request budget spent");
      const url = this.rpcs[(this.requests + attempt) % this.rpcs.length];
      this.requests++;
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "loca", method, params }) });
        if (r.status === 429 || r.status >= 500) { last = new Error(`${url} ${r.status}`); continue; }
        const j = (await r.json()) as { result?: T; error?: { name?: string; cause?: { name?: string }; data?: unknown; message?: string } };
        if (j.error) {
          const name = j.error.cause?.name ?? j.error.name ?? "";
          if (/TIMEOUT|TOO_MANY|INTERNAL/i.test(name) && method !== "send_tx") { last = new Error(name); continue; }
          throw new TxFailed(`${name} ${JSON.stringify(j.error.data ?? j.error.message ?? "").slice(0, 200)}`);
        }
        return j.result as T;
      } catch (e) {
        if (e instanceof TxFailed || e instanceof OutOfBudget) throw e;
        last = e;
      }
    }
    throw last;
  }

  async view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: b64(JSON.stringify(args)) });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as T;
  }

  async account(id: string) {
    return this.rpc<{ amount: string; storage_usage: number }>("query", { request_type: "view_account", finality: "optimistic", account_id: id });
  }

  async send(s: Signer, receiver: string, action: ReturnType<typeof actions.functionCall>): Promise<string> {
    return s.serial(async () => {
      await s.ready();
      if (!this.blockHash) this.blockHash = baseDecode((await this.rpc<{ header: { hash: string } }>("block", { finality: "final" })).header.hash);
      if (s.nonce === undefined) {
        const ak = await this.rpc<{ nonce: number }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: s.accountId, public_key: s.publicKey.toString() });
        s.nonce = BigInt(ak.nonce);
      }
      if (this.left() < 1) throw new OutOfBudget("request budget spent");
      const nonce = ++s.nonce;
      const tx = createTransaction(s.accountId, s.publicKey, receiver, nonce, [action], this.blockHash);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(encodeTransaction(tx))));
      const signed = new SignedTransaction({ transaction: tx, signature: new Signature({ keyType: KeyType.ED25519, data: await s.sign(hash) }) });
      this.txs++;
      let res: { status: { Failure?: unknown }; transaction: { hash: string }; receipts_outcome: { outcome: { status: { Failure?: unknown } } }[] };
      try {
        res = await this.rpc("send_tx", { signed_tx_base64: base64Encode(signed.encode()), wait_until: "EXECUTED_OPTIMISTIC" });
      } catch (e) {
        s.nonce = undefined; // re-read the nonce next time in case this one was not used
        throw e;
      }
      const failure = res.status.Failure ?? res.receipts_outcome.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
      if (failure) {
        const msg = JSON.stringify(failure);
        throw new TxFailed(msg.match(/ERR_[A-Z_]+/)?.[0] ?? msg.slice(0, 160), res.transaction.hash);
      }
      return res.transaction.hash;
    });
  }
}

const call = (method: string, args: Record<string, unknown>, tgas = 100n, deposit = 0n) =>
  actions.functionCall(method, args, tgas * TGAS, deposit);

// ---------------------------------------------------------------- the tick

interface Ctx {
  env: Env;
  chain: Chain;
  id: (slug: string) => string;
  market: string;
  usdc: string;
  signer: (slug: string) => Signer;
  agentSigner: (slug: string) => Signer;
  root: Signer;
  now: bigint;
  log: (kind: string, text: string, data?: Record<string, unknown>) => void;
}

const fmt = (raw: string | bigint) => `$${(Number(BigInt(raw)) / 1e6).toFixed(2)}`;
const slugOf = (accountId: string) => accountId.split(".")[0];
const agentBySlug = new Map(AGENTS.map((a) => [a.slug, a]));
const lenderBySlug = new Map(LENDERS.map((l) => [l.slug, l]));

async function sha256hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Advance one open order by one step. Returns false if it had nothing to do. */
async function step(c: Ctx, o: Order, offers: Offer[], loans: Loan[]): Promise<boolean> {
  const spec = agentBySlug.get(slugOf(o.agent_id));
  if (!spec) return false;
  const created = BigInt(o.created_at);
  const age = Number((c.now - created) / SEC);
  const customer = slugOf(o.customer_id);

  if (o.status === "Funded") {
    if (c.now > BigInt(o.deadline) + 5n * SEC) {
      const hash = await c.chain.send(c.signer(customer), c.market, call("cancel_order", { order_id: o.id }));
      c.log(o.loan_id !== null ? "loan_defaulted" : "order_refunded", `${customer} reclaims #${o.id} after a missed deadline`, { tx: hash });
      return true;
    }
    const wantsLoan = roll(o.id, "borrow") < spec.borrowRate && Number(BigInt(o.amount) / USDC_UNIT) >= 30;

    if (wantsLoan && !o.credit_request && o.loan_id === null && age < 150) {
      const principal = BigInt(Math.min(80, Math.round(Number(BigInt(o.amount) / USDC_UNIT) * (0.2 + roll(o.id, "size") * 0.25)))) * USDC_UNIT;
      const kinds = spec.vendors;
      const kind = kinds[Math.floor(roll(o.id, "kind") * kinds.length)];
      const choices = vendorsOf(kind);
      const vendor = c.id(choices[Math.floor(roll(o.id, "vendor") * choices.length)]);
      const hash = await c.chain.send(c.agentSigner(spec.slug), c.market, call("request_credit", {
        order_id: o.id, amount: principal.toString(), vendor_id: vendor, max_fee: ((principal * 8n) / 100n).toString(),
        expires_at: (c.now + BigInt(CREDIT_TTL_SEC) * SEC).toString(),
      }, 30n));
      c.log("credit_requested", `${spec.name} asks ${fmt(principal)} against #${o.id}`, { tx: hash });
      return true;
    }

    if (o.credit_request && o.loan_id === null && c.now < BigInt(o.credit_request.expires_at) - 20n * SEC) {
      const mine = offers.filter((f) => f.order_id === o.id);
      const open = mine.filter((f) => f.status === "Open" && BigInt(f.expires_at) > c.now + 10n * SEC);
      const requestedAt = BigInt(o.credit_request.expires_at) - BigInt(CREDIT_TTL_SEC) * SEC;
      if (!mine.length && c.now < requestedAt + 110n * SEC) return bid(c, o, spec, loans);
      if (open.length) {
        const best = open.sort((x, y) => Number(BigInt(x.fee) - BigInt(y.fee)))[0];
        const hash = await c.chain.send(c.agentSigner(spec.slug), c.market, call("accept_offer", { offer_id: best.id }, 30n));
        c.log("loan_funded", `${spec.name} takes ${lenderBySlug.get(slugOf(best.lender_id))?.name ?? best.lender_id} at ${fmt(best.fee)}; ${fmt(best.principal)} paid to ${slugOf(o.credit_request.vendor_id)}`, { tx: hash });
        return true;
      }
    }

    // Some agents miss the deadline: they never deliver, the customer cancels, and the bond covers the lender.
    if (roll(o.id, "miss") > spec.reliability) return false;
    // The work takes a minute or two.
    if (age < 60 + roll(o.id, "work") * 60) return false;
    const hash = await c.chain.send(c.agentSigner(spec.slug), c.market, call("mark_delivered", { order_id: o.id, deliverable_hash: (await sha256hex(`${o.id}:${o.terms_hash}`)).slice(0, 32) }, 30n));
    c.log("order_delivered", `${spec.name} delivers #${o.id}`, { tx: hash });
    return true;
  }

  if (o.status === "Delivered") {
    const since = Number((c.now - BigInt(o.delivered_at!)) / SEC);
    const r = roll(o.id, "verdict");
    if (r < 0.83) {
      if (since < 15) return false;
      const hash = await c.chain.send(c.signer(customer), c.market, call("approve", { order_id: o.id }));
      c.log("order_settled", `${customer} approves #${o.id}; escrow repays the lender first`, { tx: hash });
    } else if (r < 0.95) {
      if (since < DISPUTE_WINDOW_SEC + 5) return false;
      const hash = await c.chain.send(c.root, c.market, call("finalize", { order_id: o.id }));
      c.log("order_settled", `${customer} stayed silent; keeper finalizes #${o.id}`, { tx: hash });
    } else if (since < DISPUTE_WINDOW_SEC - 3) {
      const hash = await c.chain.send(c.signer(customer), c.market, call("dispute", { order_id: o.id, reason_hash: (await sha256hex(`dispute ${o.id}`)).slice(0, 16) }));
      c.log("order_disputed", `${customer} disputes #${o.id}`, { tx: hash });
    } else {
      // A busy tick reached this order after its dispute window closed: the customer missed its chance.
      const hash = await c.chain.send(c.root, c.market, call("finalize", { order_id: o.id }));
      c.log("order_settled", `${customer} missed the dispute window; keeper finalizes #${o.id}`, { tx: hash });
    }
    return true;
  }

  if (o.status === "Disputed") {
    const refundBps = (1 + Math.floor(roll(o.id, "refund") * 6)) * 1000;
    const hash = await c.chain.send(c.signer("arbiter"), c.market, call("resolve_dispute", { order_id: o.id, refund_bps: refundBps }));
    c.log("order_settled", `arbiter refunds ${refundBps / 100}% of #${o.id}`, { tx: hash });
    return true;
  }
  return false;
}

/** Every lender prices the request with its own strategy; those that bid lock the principal in the contract. */
async function bid(c: Ctx, o: Order, spec: AgentSpec, loans: Loan[]): Promise<boolean> {
  const [agent, score] = await Promise.all([
    c.chain.view<Agent>(c.market, "get_agent", { agent_id: o.agent_id }),
    c.chain.view<ScoreReport>(c.market, "get_score", { agent_id: o.agent_id }),
  ]);
  const ctx = (lenderId: string): BidContext => ({
    order: o, request: o.credit_request!, agent, score,
    exposureToAgent: loans.filter((l) => l.status === "Active" && l.lender_id === lenderId && l.agent_id === o.agent_id).reduce((a, l) => a + BigInt(l.principal), 0n),
  });
  const quotes: { l: (typeof LENDERS)[number]; d: BidDecision; strategy: string }[] = LENDERS.filter((l) => !l.ai)
    .map((l) => ({ l, d: lenderQuote(l, ctx(c.id(l.slug))), strategy: l.strategy.id }))
    .filter((q) => q.d.bid);
  // The AI underwriter reads the same public record and answers through a model; its reason goes on chain
  // in the offer's strategy field, so anyone can see why it priced the loan the way it did.
  const ai = LENDERS.find((l) => l.ai);
  if (ai && c.env.NEAR_AI_API_KEY && c.chain.left() >= 6) {
    c.chain.requests++;
    try {
      const d = await underwrite(ctx(c.id(ai.slug)), { apiKey: c.env.NEAR_AI_API_KEY, model: c.env.NEAR_AI_MODEL });
      // The contract caps the field at 64 bytes, so keep it to printable ASCII.
      if (d.bid) quotes.push({ l: ai, d, strategy: `ai: ${d.rationale[0]}`.replace(/[^\x20-\x7e]/g, "").slice(0, 64) });
      else c.log("ai_declined", `${ai.name} (${d.model}) passes on #${o.id}: ${d.rationale[0]}`);
    } catch (e) {
      c.log("error", `ai underwriter on #${o.id}: ${String((e as Error).message).slice(0, 120)}`);
    }
  }
  if (!quotes.length) {
    if (c.now > BigInt(o.credit_request!.expires_at) - BigInt(CREDIT_TTL_SEC - 70) * SEC) return false; // already reported
    c.log("no_bids", `No lender would fund ${spec.name} (score ${score.score}); it works without a loan`);
    return true;
  }
  // Each lender's bid costs two requests (nonce + send); bid with as many as the budget allows, cheapest first.
  // The AI lender always gets a slot, so its decisions show up on chain even when it isn't cheapest.
  quotes.sort((a, b) => Number(b.l.ai ?? false) - Number(a.l.ai ?? false) || Number((a.d as { fee: bigint }).fee - (b.d as { fee: bigint }).fee));
  const room = Math.max(1, Math.floor((c.chain.left() - 2) / 2));
  await Promise.all(quotes.slice(0, Math.min(4, room)).map(async ({ l, d, strategy }) => {
    if (!d.bid) return;
    try {
      const hash = await c.chain.send(c.signer(l.slug), c.usdc, call("ft_transfer_call", {
        receiver_id: c.market, amount: o.credit_request!.amount,
        msg: JSON.stringify({ MakeOffer: { order_id: o.id, fee: d.fee.toString(), expires_at: o.credit_request!.expires_at, strategy } }),
      }, 100n, 1n));
      c.log("offer_made", `${l.name} bids ${fmt(d.fee)} (${(d.feeBps / 100).toFixed(2)}%) on #${o.id}`, { tx: hash });
    } catch (e) {
      if (e instanceof OutOfBudget) return;
      c.log("error", `${l.slug} bid on #${o.id}: ${String((e as Error).message).slice(0, 120)}`);
    }
  }));
  return true;
}

/** Open new orders for agents that have none in flight. */
async function newOrders(c: Ctx, open: Order[], count: number) {
  const busy = new Set(open.map((o) => slugOf(o.agent_id)));
  const minute = Math.floor(Date.now() / 60_000);
  const idle = AGENTS.filter((a) => !busy.has(a.slug));
  for (let i = 0; i < count && idle.length && c.chain.left() >= 6; i++) {
    const a = idle.splice((minute * 7 + i * 5) % idle.length, 1)[0];
    const r = roll(minute, `${a.slug}:${i}`);
    const customer = a.concentration && r < a.concentration ? CUSTOMERS[0] : CUSTOMERS[Math.floor(roll(minute, `c:${a.slug}`) * CUSTOMERS.length)];
    const amount = BigInt(Math.round(a.price[0] + roll(minute, `p:${a.slug}`) * (a.price[1] - a.price[0]))) * USDC_UNIT;
    const deadline = c.now + BigInt(ORDER_TTL_SEC) * SEC;
    const hash = await c.chain.send(c.signer(customer), c.usdc, call("ft_transfer_call", {
      receiver_id: c.market, amount: amount.toString(),
      msg: JSON.stringify({ FundOrder: { agent_id: c.id(a.slug), terms_hash: (await sha256hex(`${a.slug}:${customer}:${c.now}`)).slice(0, 16), deadline: deadline.toString() } }),
    }, 100n, 1n));
    c.log("order_funded", `${customer} escrows ${fmt(amount)} for ${a.name}`, { tx: hash });
  }
}

// ---------------------------------------------------------------- upkeep, a few accounts per tick

type Task = (c: Ctx) => Promise<void>;

function upkeepTasks(): Task[] {
  const tasks: Task[] = [];
  const nearFloor = (slug: string, floor: string, amount: string): Task => async (c) => {
    const v = await c.chain.account(c.id(slug));
    const free = BigInt(v.amount) - BigInt(v.storage_usage) * 10n ** 19n;
    if (free >= BigInt(Math.round(Number(floor) * 1000)) * (NEAR / 1000n)) return;
    await c.chain.send(c.root, c.id(slug), actions.transfer(BigInt(Math.round(Number(amount) * 1000)) * (NEAR / 1000n)));
    c.log("topup", `${slug} topped up with ${amount} testnet NEAR`);
  };
  const usdcFloor = (slug: string, floor: number, mint: number): Task => async (c) => {
    const bal = BigInt(await c.chain.view<string>(c.usdc, "ft_balance_of", { account_id: c.id(slug) }));
    if (bal >= BigInt(floor) * USDC_UNIT) return;
    await c.chain.send(c.root, c.usdc, call("mint", { account_id: c.id(slug), amount: (BigInt(mint) * USDC_UNIT).toString() }));
  };
  const withdraw = (slug: string, agent: boolean): Task => async (c) => {
    const owed = BigInt(await c.chain.view<string>(c.market, "get_balance", { account_id: c.id(slug) }));
    if (owed < 5n * USDC_UNIT) return;
    await c.chain.send(agent ? c.agentSigner(slug) : c.signer(slug), c.market, call("withdraw", {}, 60n));
  };
  const reclaimOwnerStorage: Task = async (c) => {
    const bal = BigInt(await c.chain.view<string>(c.market, "storage_balance_of", { account_id: c.env.SWARM_ACCOUNT_ID }));
    if (bal < NEAR / 2n) return;
    await c.chain.send(c.root, c.market, call("storage_withdraw", {}, 30n));
    c.log("storage", `root reclaims ${(Number(bal / (NEAR / 1000n)) / 1000).toFixed(2)} testnet NEAR of storage freed by pruning`);
  };
  const storage = (slug: string): Task => async (c) => {
    const bal = BigInt(await c.chain.view<string>(c.market, "storage_balance_of", { account_id: c.id(slug) }));
    if (bal >= (6n * NEAR) / 100n) return;
    await c.chain.send(c.root, c.market, call("storage_deposit", { account_id: c.id(slug) }, 30n, (3n * NEAR) / 10n));
    c.log("storage", `${slug} storage prepaid with 0.3 testnet NEAR`);
  };
  const bond = (a: AgentSpec): Task => async (c) => {
    const ag = await c.chain.view<Agent>(c.market, "get_agent", { agent_id: c.id(a.slug) });
    if (BigInt(ag.bond) >= (BigInt(a.bond) * USDC_UNIT) / 2n) return;
    await c.chain.send(c.signer(a.operator), c.usdc, call("ft_transfer_call", { receiver_id: c.market, amount: (BigInt(a.bond) * USDC_UNIT).toString(), msg: JSON.stringify({ PostBond: { agent_id: c.id(a.slug) } }) }, 100n, 1n));
    c.log("bond_posted", `${a.operator} tops up ${a.name}'s bond`);
  };
  for (const a of AGENTS) tasks.push(storage(a.slug), withdraw(a.slug, true), bond(a), nearFloor(a.slug, "0.3", "0.4"));
  for (const l of LENDERS) tasks.push(storage(l.slug), withdraw(l.slug, false), usdcFloor(l.slug, 400, 1500), nearFloor(l.slug, "0.3", "0.4"));
  for (const cu of CUSTOMERS) tasks.push(usdcFloor(cu, 400, 2000), nearFloor(cu, "0.15", "0.3"));
  for (const v of VENDORS) tasks.push(withdraw(v.slug, false), nearFloor(v.slug, "0.15", "0.3"));
  for (const o of OPERATORS) tasks.push(usdcFloor(o, 60, 300), nearFloor(o, "0.15", "0.3"));
  // Pruned orders return their storage deposits to the agents and lenders that paid them; the owner's
  // share (records from before storage was charged) comes back to the root.
  tasks.push(nearFloor("arbiter", "0.15", "0.3"), nearFloor("market", "1", "2"), reclaimOwnerStorage);
  return tasks;
}
const UPKEEP = upkeepTasks();

// ---------------------------------------------------------------- entry

export async function tick(env: Env): Promise<{ requests: number; txs: number; steps: number }> {
  const chain = new Chain(env.RPCS ?? "https://rpc.testnet.fastnear.com,https://test.rpc.fastnear.com");
  const rootId = env.SWARM_ACCOUNT_ID;
  const id = (slug: string) => `${slug}.${rootId}`;
  const signers = new Map<string, Signer>();
  const get = (accountId: string, role: "full" | "agent") => {
    let s = signers.get(`${accountId}|${role}`);
    if (!s) signers.set(`${accountId}|${role}`, (s = new Signer(accountId, deriveKey(env.SWARM_SEED, accountId, role))));
    return s;
  };
  const lines: string[] = [];
  const c: Ctx = {
    env, chain, id, market: id("market"), usdc: id("usdc"), now: BigInt(Date.now()) * 1_000_000n,
    signer: (slug) => get(id(slug), "full"),
    agentSigner: (slug) => get(id(slug), "agent"),
    root: new Signer(rootId, Promise.resolve(env.SWARM_PRIVATE_KEY)),
    log: (kind, text, data = {}) => lines.push(`${kind.padEnd(16)} ${text}${data.tx ? `  tx ${data.tx}` : ""}`),
  };
  let steps = 0;
  try {
    const m = await chain.view<{ next_order_id: number; next_offer_id: number; next_loan_id: number }>(c.market, "get_market");
    const [orders, offers, loans] = await Promise.all([
      chain.view<Order[]>(c.market, "get_orders", { from_id: Math.max(0, m.next_order_id - 60), limit: 60 }),
      chain.view<Offer[]>(c.market, "get_offer_list", { from_id: Math.max(0, m.next_offer_id - 100), limit: 100 }),
      chain.view<Loan[]>(c.market, "get_loans", { from_id: Math.max(0, m.next_loan_id - 60), limit: 60 }),
    ]);
    const open = orders.filter((o) => o.status === "Funded" || o.status === "Delivered" || o.status === "Disputed");

    // Upkeep first, two tasks per tick, so a busy market can't starve it.
    const minute = Math.floor(Date.now() / 60_000);
    for (let i = 0; i < 2; i++) {
      const task = UPKEEP[(minute * 2 + i) % UPKEEP.length];
      await task(c).catch((e) => c.log("error", `upkeep: ${String((e as Error).message).slice(0, 140)}`));
    }

    // Move every open order one step, oldest first, while the request budget lasts.
    for (const o of open) {
      if (chain.left() < 8) break;
      try {
        if (await step(c, o, offers, loans)) steps++;
      } catch (e) {
        if (e instanceof OutOfBudget) break;
        c.log("error", `#${o.id}: ${String((e as Error).message).slice(0, 140)}`);
      }
    }

    // Keep state bounded: settled orders older than six hours are pruned and their storage deposits refunded.
    if (minute % 2 === 0 && chain.left() >= 10) {
      const hash = await chain.send(c.root, c.market, call("prune", { limit: 12 }, 300n)).catch((e) => {
        c.log("error", `prune: ${String((e as Error).message).slice(0, 140)}`);
        return null;
      });
      if (hash) c.log("pruned", "settled orders older than 6h pruned; storage deposits refunded", { tx: hash });
    }

    // Pace new orders by the root's NEAR, which pays the swarm's gas. No faucet: it runs on what it has.
    if (!env.PAUSED && chain.left() >= 8) {
      const root = await chain.account(rootId);
      const near = Number(BigInt(root.amount) / NEAR);
      const pace = Number(env.PACE ?? 2);
      const count = near > 40 ? pace : near > 15 ? 1 : near > 5 ? (minute % 3 === 0 ? 1 : 0) : 0;
      if (count === 0) c.log("paused", `root has ${near} testnet NEAR; new orders paused until it is topped up`);
      await newOrders(c, open, count).catch((e) => c.log("error", `new order: ${String((e as Error).message).slice(0, 140)}`));
    }
  } catch (e) {
    if (!(e instanceof OutOfBudget)) c.log("error", `tick: ${String((e as Error).message).slice(0, 200)}`);
  }
  for (const l of lines) console.log(l);
  console.log(`tick: ${steps} steps, ${chain.txs} txs, ${chain.requests} requests`);
  return { requests: chain.requests, txs: chain.txs, steps };
}

// Minimal Workers runtime types, so the file also type-checks (and runs locally) under Node.
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }

export default {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(tick(env));
  },
  // GET / shows that the worker is alive; it never exposes keys or triggers a tick.
  async fetch(): Promise<Response> {
    return new Response(`Loca swarm worker. It runs on a schedule; methods its agents may call: ${AGENT_METHODS.join(", ")}.\n`, { headers: { "content-type": "text/plain" } });
  },
};
