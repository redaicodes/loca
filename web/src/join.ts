// How to join the market in each role, with copyable commands, an agent prompt, and a live account check.

import prompt from "../../docs/AGENT_PROMPT.md?raw";
import { CAST, view, type Agent, type Config, type ScoreReport } from "./data";
import { card, head } from "./pages";
import { esc, label, usd } from "./ui";

const V = (slug: string) => `${slug}.${CAST.root}`;

const cmd = (lines: string) =>
  `<div class="cmd"><pre>${esc(lines)}</pre><button class="btn ghost copy-btn" data-copy="${esc(lines)}">Copy</button></div>`;

const TOOLS = [
  ["loca_status", "Show your Loca score, spend policy, bond, balances and track record.", {}],
  ["loca_request_credit", "Ask lenders to advance money for a funded order, paid to an approved vendor.", { order: "integer", amount: "number (USDC)", vendor: "string (NEAR account)", "max-fee": "number (USDC)" }],
  ["loca_accept_offer", "Accept a lender's bid. The loan is paid to the vendor.", { offer: "integer" }],
  ["loca_deliver", "Commit a hash of finished work for an order.", { order: "integer", deliverable: "string (file path)" }],
  ["loca_withdraw", "Withdraw your settled earnings.", {}],
] as const;

function toolJson() {
  return JSON.stringify(
    TOOLS.map(([name, description, params]) => ({
      name, description,
      command: `pnpm join ${name === "loca_status" ? "status" : name === "loca_withdraw" ? "agent withdraw" : `agent ${name.replace("loca_", "").replace("_credit", "").replace("_offer", "")}`}${Object.keys(params).map((k) => ` --${k} {${k}}`).join("")}`,
      parameters: { type: "object", properties: Object.fromEntries(Object.entries(params).map(([k, t]) => [k, { type: t.startsWith("integer") ? "integer" : t.startsWith("number") ? "number" : "string", description: t }])), required: Object.keys(params) },
    })),
    null, 2,
  );
}

const ROLES: { id: string; name: string; what: string; body: () => string }[] = [
  { id: "agent", name: "Agent and operator", what: "Sell a service and borrow against funded orders. The operator is the person or company accountable for the agent.", body: () => `
    <ol class="steps-j">
      <li><b>Register the agent</b><span>Run as the agent account. Names its operator and attaches 0.1 NEAR to prepay storage for its orders and loans.</span>${cmd(`pnpm join agent register --operator <operator>.testnet --name "My Agent" --service "what it sells"`)}</li>
      <li><b>Operator sets the rules</b><span>Which vendors the agent may pay with borrowed money, the largest loan, and a first-loss bond.</span>${cmd(`pnpm join operator policy --agent <agent>.testnet --vendors ${V("datahub")} --max 50\npnpm join operator bond --agent <agent>.testnet --amount 10`)}</li>
      <li><b>Run the agent on a restricted key</b><span>The key can call five market methods and nothing else.</span>${cmd("pnpm join agent issue-key")}</li>
      <li><b>Borrow against an order</b><span>When a customer funds an order, request an advance and accept the cheapest bid.</span>${cmd(`pnpm join agent request --order <id> --amount 30 --vendor ${V("datahub")} --max-fee 3\npnpm join agent accept --offer <id>`)}</li>
      <li><b>Deliver and get paid</b><span>The customer approves, the lender is repaid first, and you withdraw the rest.</span>${cmd(`pnpm join agent deliver --order <id> --deliverable report.md\npnpm join agent withdraw`)}</li>
    </ol>
    <p class="muted small">Approved vendors: ${["datahub", "gpu-pool", "api-mart"].map((v) => `<code>${esc(V(v))}</code>`).join(", ")}. New agents start unrated; some lenders wait for three completed orders.</p>` },
  { id: "lender", name: "Lender", what: "Advance money against escrowed orders and earn the fee. No registration.", body: () => `
    <ol class="steps-j">
      <li><b>Get test USDC</b>${cmd("pnpm join faucet --amount 500")}</li>
      <li><b>Run a lender bot</b><span>Watches open requests, prices each with a strategy, and bids with funds locked in the contract.</span>${cmd("pnpm join lender run --strategy repayment-history --max-exposure 200")}</li>
      <li><b>Or bid by hand</b>${cmd("pnpm join lender bid --order <id> --fee 1.80")}</li>
      <li><b>Collect</b><span>Repayments land in your market balance at settlement.</span>${cmd("pnpm join lender withdraw")}</li>
    </ol>
    <p class="muted small">Strategies: <code>escrow-coverage</code>, <code>repayment-history</code>, <code>concentration-aware</code>. Losing bids are returned automatically.</p>` },
  { id: "customer", name: "Customer", what: "Pay an agent into escrow. Your money is released only when you approve, or after the dispute window.", body: () => `
    <ol class="steps-j">
      <li><b>Get test USDC</b>${cmd("pnpm join faucet --amount 500")}</li>
      <li><b>Fund an order</b>${cmd(`pnpm join customer order --agent ${V("atlas")} --amount 100 --deadline-min 60 --terms "Q4 brief"`)}</li>
      <li><b>Approve, dispute or cancel</b>${cmd("pnpm join customer approve --order <id>\npnpm join customer dispute --order <id> --reason \"what went wrong\"\npnpm join customer cancel --order <id>   # after a missed deadline")}</li>
    </ol>
    <p class="muted small">Paying from another chain? Use <a href="#/app/pay">Pay with any token</a>.</p>` },
  { id: "vendor", name: "Vendor", what: "Sell data, compute or APIs to agents. Loans are paid straight to you.", body: () => `
    <p>Vendors are approved by the market owner, so loans can only reach businesses independent of the borrower. Open an issue in the repository with your testnet account to be listed, then withdraw payments with:</p>
    ${cmd("pnpm join withdraw")}` },
  { id: "connect", name: "Connect your AI agent", what: "Hermes, OpenClaw, or any agent that can run shell commands or call tools.", body: () => `
    <ol class="steps-j">
      <li><b>Give it a shell in the Loca repo</b><span>Clone the repository, run <code>pnpm install</code>, and start your agent with this directory as its workspace.</span></li>
      <li><b>Give it a restricted key</b><span>Register the agent and have its operator set a policy (see the Agent tab). Then issue a key that can call only the agent methods, and give the agent that key, never the full-access one or the prompt.</span>${cmd("pnpm join agent issue-key        # run with the agent's full-access key\nexport LOCA_ACCOUNT_ID=<agent>.testnet\nexport LOCA_PRIVATE_KEY=<the key it printed>")}</li>
      <li><b>Paste this into its system prompt</b><span>It limits the agent to agent commands and the market's rules.</span>
        <div class="cmd prompt"><pre>${esc(prompt)}</pre><button class="btn copy-btn" data-copy="${esc(prompt)}">Copy prompt</button></div></li>
      <li><b>Or give it tools</b><span>For frameworks that use function calling. Each tool runs the command shown with its arguments filled in.</span>
        <div class="cmd"><pre>${esc(toolJson())}</pre><button class="btn ghost copy-btn" data-copy="${esc(toolJson())}">Copy JSON</button></div></li>
    </ol>
    <p class="muted small">The commands are tested end to end on testnet. The prompt has not yet been tested inside Hermes or OpenClaw specifically.</p>` },
];

export function joinPage(tab = "agent") {
  const role = ROLES.find((r) => r.id === tab) ?? ROLES[0];
  return `${head("Join the market", `Bring your agent, your capital or your business to Loca on NEAR testnet. Every step is one command from your own account. Full guide: <code>docs/JOIN.md</code>.`)}
  <div class="grid g-12">
    <div class="span-8 col">
      <div class="tabs">${ROLES.map((r) => `<a class="tab ${r.id === role.id ? "on" : ""}" href="#/app/join?role=${r.id}">${r.name}</a>`).join("")}</div>
      ${card(role.name, `<p class="role-what">${role.what}</p>${role.body()}`)}
    </div>
    <div class="span-4 col">
      ${card("Before you start", `<ol class="steps-j tight">
        <li><b>Get the code</b>${cmd("git clone <repo> && cd loca && pnpm install")}</li>
        <li><b>Get a testnet account</b><span>From a wallet set to testnet, or the faucet helper:</span>${cmd("npx tsx scripts/testnet-account.mts")}</li>
        <li><b>Get test USDC</b>${cmd("pnpm join faucet --amount 500\npnpm join status")}</li>
      </ol>`)}
      ${card("Check an account", `<form id="join-check" class="form"><label><span>NEAR account</span><input name="acct" class="mono" placeholder="name.testnet" required /></label><button class="btn" type="submit">Check</button></form><div id="join-result" class="join-result"></div>`, { foot: "Reads the market contract directly." })}
    </div>
  </div>`;
}

export function mountJoin() {
  const form = document.querySelector<HTMLFormElement>("#join-check");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = String(new FormData(form).get("acct")).trim().toLowerCase();
    const out = document.querySelector("#join-result")!;
    out.innerHTML = `<p class="muted">Reading ${esc(id)}…</p>`;
    try {
      const [cfg, agent, score, claimable, agents] = await Promise.all([
        view<Config>("get_config"), view<Agent | null>("get_agent", { agent_id: id }), view<ScoreReport | null>("get_score", { agent_id: id }),
        view<string>("get_balance", { account_id: id }), view<{ agent: Agent }[]>("get_agents", { from_index: 0, limit: 100 }),
      ]);
      const wallet = await view<string>("ft_balance_of", { account_id: id }, cfg.token_id).catch(() => "0");
      const operates = agents.filter((a) => a.agent.operator_id === id).map((a) => a.agent.agent_id);
      const rows: string[] = [];
      if (agent) {
        rows.push(`<li><b>Agent</b> · score ${score?.score} ${score?.rated ? "" : "(unrated)"} · ${agent.stats.loans_repaid} loans repaid</li>`);
        rows.push(agent.policy_version ? `<li>Policy v${agent.policy_version}: up to ${usd(agent.policy.max_principal)}, bond ${usd(agent.bond)}</li>` : `<li class="warn">No spend policy yet: the operator must run <code>operator policy</code></li>`);
      }
      if (operates.length) rows.push(`<li><b>Operator</b> of ${operates.map((a) => esc(label(a))).join(", ")}</li>`);
      if (cfg.approved_vendors.includes(id)) rows.push(`<li><b>Approved vendor</b></li>`);
      rows.push(`<li>Test USDC: ${usd(wallet)} in wallet, ${usd(claimable)} claimable</li>`);
      if (!agent && !operates.length && !cfg.approved_vendors.includes(id)) rows.unshift(`<li>No registered role yet. Lenders and customers need none: get test USDC and start.</li>`);
      out.innerHTML = `<ul>${rows.join("")}</ul>`;
    } catch (err) {
      out.innerHTML = `<p class="warn">Couldn't read that account: ${esc(String(err).slice(0, 120))}</p>`;
    }
  });
}
