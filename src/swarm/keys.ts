// Every swarm account has its own key. The simulator plays every role, so it holds one seed and derives
// each account's key from it; no two accounts share a key, and in a real deployment each party would hold
// only its own. Agents get only a function-call key for the market's agent methods (no full-access key
// at all). The market contract and the token are not derived here: their keys stay with the deployer.
//
// WebCrypto only, so the same code runs in Node and in the Cloudflare Worker.

import { baseEncode } from "near-api-js";

// PKCS#8 header for a raw 32-byte Ed25519 private key.
const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** `ed25519:<base58 seed||public>` for (seed, account, role). Role "agent" is the agent's function-call key. */
export async function deriveKey(seed: string, accountId: string, role: "full" | "agent" = "full"): Promise<string> {
  const priv = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`loca-swarm|${seed}|${accountId}|${role}`)));
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8_ED25519, ...priv]), { name: "Ed25519" }, true, ["sign"]);
  const { x } = (await crypto.subtle.exportKey("jwk", key)) as { x: string };
  return `ed25519:${baseEncode(new Uint8Array([...priv, ...fromB64url(x)]))}`;
}
