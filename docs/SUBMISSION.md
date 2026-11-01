# Submission kit

Deadline: **2026-11-14 23:59 UTC**. One attempt, no edits. Re-read https://nearhackathon.com/HACKATHON.md before sending.

## Still needed from the team

- [ ] Record the demo video (script below) and publish the X post with it attached
- [ ] Project name (suggested: `Loca: Line of Credit for Agents`)
- [ ] Team lead's name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`)
- [ ] Mainnet NEAR account for the payout (e.g. `yourname.near`), created in your own wallet
- [ ] Whether anyone on the team submits a second project (both READMEs must then name each other)
- [ ] Agree to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."
- [ ] Confirm the final JSON payload before it is sent

Done: public repository with LICENSE, hosted app and swarm, README written for the AI screeners.

Tracks: `defi`, `agents`, `business`, `swarms`, `security`

Links: app https://loca.loca-ai.workers.dev · repo https://github.com/redaicodes/loca

## Description (`idea`, 20–2000 characters)

> AI agents get paid for work, but they can't borrow against it. An agent hired for a $100 research job often has to buy data or compute before it can deliver, and nobody lends to software with no balance sheet.
>
> Loca (Line of Credit for Agents) is a credit market on NEAR built for that gap. The customer pays into escrow in our contract. The agent asks for an advance of up to half the order. Lender agents post fully funded bids, priced from the agent's onchain record, and the agent takes the cheapest. The loan goes straight to an approved vendor, never to the agent. When the customer approves the work, the escrow repays the lender first, a first-loss bond from the agent's operator covers any shortfall, and the agent keeps the rest. Every loan updates a LOCA Score that anyone can recompute from a contract view, and the score sets the price of the next loan.
>
> It runs live on testnet: 16 agents, 14 customers, 7 lender agents and 6 vendors trade around the clock from a hosted swarm. So far: over 2,400 orders, 1,400 loans and a 94% repayment rate, every one a real transaction.
>
> NEAR does the heavy lifting. The contract holds escrow, spend policies and the repayment waterfall. Named accounts give every agent, operator and lender an identity. Agents sign with function-call keys that can call only five market methods, so a compromised agent can't move tokens. NEAR Intents lets a customer pay with ETH, SOL or BTC from another chain; the payment lands in escrow as USDC and opens the order in one step.
>
> We attacked the live market 16 ways, including self-dealing, routing a loan to the operator, over-advancing and key misuse. All 16 were refused: 13 by the contract, 3 by NEAR before execution. Prototype, not audited. The Intents leg uses live mainnet dry quotes, since Intents has no testnet.

## X post draft

Main post (under 280 characters):

> AI agents get paid for work but can't borrow against it.
>
> Loca, built at #NEARHackathon: customers pay into escrow, lender agents bid to front the agent's costs, and escrow repays them first.
>
> 16 agents are trading on @NEARProtocol testnet now: <app link>

Reply under it:

> How NEAR fits: the contract runs escrow and repayment, function-call keys limit agents to 5 market methods, and NEAR Intents lets customers pay from any chain. 16 attacks on the live market, all refused.
>
> Code: https://github.com/redaicodes/loca
>
> What should an agent's credit score measure?

Optional tags: @NearLegion @NearBuilders

## 90-second video script

Screen recording of the hosted app, with captions. No setup or slides.

| Time | Screen | Caption |
|---|---|---|
| 0–8s | Landing hero, stats strip ticking | AI agents get paid for work. They can't borrow against it. |
| 8–22s | Order replay window plays one settled loan | A customer pays an agent into escrow. Lenders bid to advance part of it for data or compute. The cheapest bid wins. |
| 22–30s | Replay reaches the payout split | The loan pays the vendor. On approval, escrow repays the lender first. The agent keeps the rest. |
| 30–48s | Live swarm: network lines pulsing, event stream | This is live on NEAR testnet: 16 agents, 7 lenders, every line a real transaction. |
| 48–60s | Agent page: score, components, function-call key | Each agent has a credit score from its onchain record, and signs with a key that can call only 5 market methods. |
| 60–70s | Lenders page | Lenders price the default rate. Reliable agents pay under 2%; unreliable ones get no bids. |
| 70–80s | Credit auctions: guardrail table | We attacked the market 16 ways. All 16 were refused. |
| 80–90s | Pay page quote, then landing | Customers can pay from any chain through NEAR Intents. Loca: Line of Credit for Agents. |
