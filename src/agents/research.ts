// The borrowing business: a research agent that sells reports. It spends borrowed capital on
// a data vendor, then writes the report. With NEAR_AI_API_KEY set it uses NEAR AI Cloud
// (OpenAI-compatible) for inference; otherwise it uses a deterministic offline writer so the
// simulation needs no keys or funds.

import { createHash } from "node:crypto";

export interface ResearchBrief {
  topic: string;
  questions: string[];
}

export interface Dataset {
  vendor: string;
  rows: { metric: string; value: string }[];
}

export interface Deliverable {
  markdown: string;
  hash: string;
  engine: string;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** What the vendor sells for the borrowed principal. Deterministic stand-in for a paid data API. */
export function vendorDataset(vendor: string, brief: ResearchBrief): Dataset {
  const seed = sha256(brief.topic);
  return {
    vendor,
    rows: brief.questions.map((q, i) => ({
      metric: q,
      value: `${parseInt(seed.slice(i * 4, i * 4 + 4), 16) % 1000} (sample ${i + 1})`,
    })),
  };
}

export async function writeReport(brief: ResearchBrief, data: Dataset): Promise<Deliverable> {
  const key = process.env.NEAR_AI_API_KEY;
  if (key) {
    try {
      const md = await nearAiReport(key, brief, data);
      return { markdown: md, hash: sha256(md), engine: `near-ai:${model()}` };
    } catch (e) {
      console.warn(`NEAR AI call failed, falling back to offline writer: ${(e as Error).message}`);
    }
  }
  const md = [
    `# ${brief.topic}`,
    "",
    ...brief.questions.map((q, i) => `- **${q}**: ${data.rows[i]?.value ?? "n/a"}`),
    "",
    `_Data: ${data.vendor}. Written by the offline writer (no inference key set)._`,
  ].join("\n");
  return { markdown: md, hash: sha256(md), engine: "offline" };
}

const model = () => process.env.NEAR_AI_MODEL ?? "deepseek-ai/DeepSeek-V3.1";

async function nearAiReport(key: string, brief: ResearchBrief, data: Dataset): Promise<string> {
  const base = process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model(),
      max_tokens: 600,
      messages: [
        { role: "system", content: "You write short, factual research briefs in markdown. Use only the data given." },
        { role: "user", content: `Topic: ${brief.topic}\nQuestions: ${brief.questions.join("; ")}\nData: ${JSON.stringify(data.rows)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content;
}
