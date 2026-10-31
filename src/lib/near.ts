// Network bootstrap for sandbox (local, no funds) and testnet.

import { Account, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto, teraToGas } from "near-api-js";
import type { LocaEvent } from "./types.js";

export type Network = "sandbox" | "testnet";

export const EXPLORER: Record<Network, string | null> = {
  sandbox: null,
  testnet: "https://testnet.nearblocks.io/txns/",
};

export interface Env {
  network: Network;
  provider: JsonRpcProvider;
  root: Account;
  /** Create (or reuse) a funded account named `<name>.<root>`. */
  account(name: string, near?: string): Promise<Account>;
  close(): Promise<void>;
}

export interface TxResult<T = unknown> {
  hash: string;
  value: T;
  events: LocaEvent[];
  logs: string[];
}

export const GAS = teraToGas("150");

/** Call a contract method and collect tx hash, return value and LOCA events. */
export async function call<T = unknown>(
  from: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  deposit: bigint | string = 0n,
): Promise<TxResult<T>> {
  let res;
  try {
    res = await from.callFunctionRaw({ contractId, methodName, args, deposit, gas: GAS });
  } catch (e) {
    // near-api-js throws on a failed receipt; keep the tx hash and logs for the run log.
    const tr = (e as { transactionResult?: typeof res }).transactionResult;
    if (!tr) throw e;
    const logs = tr.receipts_outcome.flatMap((r) => r.outcome.logs);
    throw new ContractError((e as Error).message, tr.transaction.hash, logs);
  }
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  const failure = findFailure(res);
  if (failure) throw new ContractError(failure, res.transaction.hash, logs);
  const status = res.status as { SuccessValue?: string };
  let value: unknown = undefined;
  if (status.SuccessValue) {
    const raw = Buffer.from(status.SuccessValue, "base64").toString();
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }
  return { hash: res.transaction.hash, value: value as T, logs, events: parseEvents(logs) };
}

export async function view<T>(provider: JsonRpcProvider, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export class ContractError extends Error {
  constructor(message: string, readonly hash: string, readonly logs: string[]) {
    super(message);
  }
  /** The ERR_* code from a `require!` panic, if any. */
  get code(): string | undefined {
    return this.message.match(/ERR_[A-Z_]+/)?.[0];
  }
}

function findFailure(res: { status: unknown; receipts_outcome: { outcome: { status: unknown } }[] }): string | null {
  const all = [res.status, ...res.receipts_outcome.map((r) => r.outcome.status)];
  for (const s of all) {
    if (s && typeof s === "object" && "Failure" in s) return JSON.stringify((s as { Failure: unknown }).Failure);
  }
  return null;
}

export function parseEvents(logs: string[]): LocaEvent[] {
  return logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => JSON.parse(l.slice("EVENT_JSON:".length)))
    .filter((e) => e.standard === "loca")
    .map((e) => ({ event: e.event, data: e.data[0] }));
}

export async function chainNowNs(provider: JsonRpcProvider): Promise<bigint> {
  const block = await provider.viewBlock({ finality: "final" });
  return BigInt(block.header.timestamp_nanosec);
}

async function makeEnv(network: Network, provider: JsonRpcProvider, root: Account, prefix: string, close: () => Promise<void>): Promise<Env> {
  const cache = new Map<string, Account>();
  return {
    network,
    provider,
    root,
    close,
    async account(name, near = "5") {
      const id = `${prefix}${name}.${root.accountId}`;
      const hit = cache.get(id);
      if (hit) return hit;
      const key = KeyPair.fromRandom("ed25519");
      await root.createSubAccount({
        accountOrPrefix: `${prefix}${name}`,
        publicKey: key.getPublicKey().toString(),
        nearToTransfer: nearToYocto(near as `${number}`),
      });
      const acc = new Account(id, provider, key.toString() as KeyPairString);
      cache.set(id, acc);
      return acc;
    },
  };
}

export async function connect(network: Network): Promise<Env> {
  if (network === "sandbox") {
    const { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } = await import("near-sandbox");
    // near-sdk 5.30 imports host functions (gas keys, state init) that need nearcore >= 2.14.
    const sandbox = await Sandbox.start({ version: process.env.NEAR_SANDBOX_VERSION ?? "2.14.0" });
    const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    const root = new Account(DEFAULT_ACCOUNT_ID, provider, DEFAULT_PRIVATE_KEY as KeyPairString);
    return makeEnv(network, provider, root, "", () => sandbox.tearDown());
  }
  const accountId = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_PRIVATE_KEY;
  if (!accountId || !key) {
    throw new Error("Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a funded testnet account) in .env");
  }
  const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com" });
  const root = new Account(accountId, provider, key as KeyPairString);
  // Fresh prefix per run so repeated demos never collide.
  const prefix = `l${Date.now().toString(36)}-`;
  return makeEnv(network, provider, root, prefix, async () => {});
}
