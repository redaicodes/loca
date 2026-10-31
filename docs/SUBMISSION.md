# Submission kit

Deadline: **2026-11-14 23:59 UTC**. Submission is one-shot and cannot be edited. Re-read https://nearhackathon.com/HACKATHON.md before sending.

## Still needed from the team

- [ ] Make the GitHub repository public (judges cannot open a private repo)
- [ ] Record the demo video (script below)
- [ ] Publish the X post (draft below), tagging @NEARProtocol and #NEARHackathon, with the video attached
- [ ] Project name (draft: `LOCA: Line of Credit for Agents`)
- [ ] Team lead's name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`)
- [ ] Mainnet NEAR account for the payout (e.g. `yourname.near`), created in your own wallet
- [ ] Agree to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."
- [ ] Confirm the final JSON payload before it is sent

Tracks: `defi`, `agents`, `business`, `swarms`

## Description (`idea`, 20–2000 chars)

> AI agents can earn and spend, but they cannot borrow against work they have already been hired for. LOCA (Line of Credit for Agents) is a credit market on NEAR for agent businesses. A customer escrows payment for an order in the LOCA contract. The agent requests an advance of up to 50% of it to buy inputs such as data or compute. Lender agents with different risk policies post fully funded bids, and the agent accepts the cheapest valid one. The loan is paid directly to an approved vendor, never to the agent. When the customer approves delivery, or the dispute window lapses, the contract repays the lender first, then a first-loss bond covers any shortfall, and the agent keeps the rest. Every order and loan updates an onchain record and a deterministic LOCA Score that anyone can recompute from a contract view. In our testnet run the first loan cost $1.20; after repaying it, the same agent's next loan cost $0.60. NEAR fits in three ways: contracts hold escrow, policy and settlement; named accounts give each agent and operator an identity; and NEAR Intents 1Click lets a customer pay with ETH, SOL, BTC or USDC on other chains. The payment arrives as exactly the USDC owed, via ft_transfer_call, and opens the order in a single step. Guardrails block related-party orders, loans routed to the agent's own operator, advances over the cap and double-pledged orders. Prototype on testnet; the Intents leg is shown with live mainnet dry quotes.

## X post draft

> AI agents can get paid, but they can't borrow against a job they've already won.
>
> We built LOCA at #NEARHackathon: a customer escrows $100, three lender agents bid to advance $30, the loan pays the data vendor directly, and the escrow repays the lender when the work is approved.
>
> After one repaid loan, the agent's next loan costs half as much: $1.20 → $0.60.
>
> On @NEARProtocol: contracts run escrow and repayment, and NEAR Intents lets the customer pay in ETH, SOL or BTC from any chain, landing in escrow as USDC.
>
> Repo + testnet demo: <link>
> What would you want an agent's credit score to measure?

Optional tags: @NearLegion @NearBuilders

## 90-second video script

1. **0–10s:** dashboard hero, then the agent card. "This research agent has 3 paid orders and a LOCA Score of 620."
2. **10–30s:** terminal running `pnpm demo:sim`. The order is escrowed, the agent requests $30, and three lenders bid $1.37, $1.20 and $1.58.
3. **30–45s:** the loan pays the vendor, the report is delivered and the customer approves. The waterfall shows $31.20 to the lender and $68.80 to the agent.
4. **45–60s:** the score moves 620 → 747, the second auction runs, and the winning bid is $0.60.
5. **60–75s:** `pnpm intents:quote`. ETH, SOL and BTC each route to exactly $100 USDC; the unlisted token is refused.
6. **75–90s:** the guardrails cards, then a NearBlocks link for the waterfall transaction.
