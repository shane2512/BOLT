/**
 * FR-7.5 / FR-7.7 — the natural-language interface.
 *
 * "Was this business ever short in August?" is not a question a GraphQL query
 * answers. Answering it means knowing that shortfall is a property of a
 * `CoverageSnapshot`, that snapshots carry unix timestamps rather than months,
 * that "ever" means every class and every block in the index, and that the
 * honest answer when the index only reaches back to September is "your window
 * predates the data" rather than "no".
 *
 * So this is a reasoning step over the evidence bundle, not a query router
 * (FR-7.7 says so explicitly: printing raw query results does not satisfy it).
 * The bundle is assembled entirely from the subgraph in `snapshot.ts`; the model
 * is given that and nothing else, and is told that anything not in it does not
 * exist. Citations of block numbers are required, which is what makes the answer
 * checkable — a reader can take a block number out of the answer and look it up
 * on the explorer without trusting either us or the model.
 *
 * Neither Anthropic nor OpenRouter is one of the four sponsor integrations, so
 * Rule 0's docs-MCP requirement does not apply here. Originally written
 * against the Anthropic TypeScript SDK; swapped to OpenRouter's
 * OpenAI-compatible chat-completions endpoint (model `nvidia/nemotron-3-ultra-550b-a55b:free`
 * by default) per explicit direction. Plain `fetch` against OpenRouter's REST
 * API — no new SDK dependency needed for one request shape, and it avoids
 * carrying two overlapping LLM-client packages in the same app.
 */
export class MissingApiKey extends Error {
  constructor() {
    super(
      "OPENROUTER_API_KEY is not set. The evidence bundle is built and returned " +
        "regardless; only the reasoning step is unavailable."
    );
    this.name = "MissingApiKey";
  }
}

const SYSTEM = `You are the BOLT Solvency Monitor, answering questions from the public about a
business that holds other people's money.

THE ONLY THING YOU KNOW is the JSON evidence bundle in the user's message. It was
assembled from a deployed subgraph indexing the BoltRegistry contract and USDC
balances on Arc. Every figure in it is an on-chain event or an on-chain balance.

Rules, in order of importance:

1. NEVER state a fact that is not in the bundle. If the bundle cannot answer the
   question, say exactly what is missing and what the data does cover. An honest
   "the index only goes back to block N, which is 3 September — I cannot see
   August" is a correct answer; a guess is not.
2. CITE BLOCK NUMBERS. Every factual claim about what happened must name the
   block number (and the ISO timestamp, and the transaction hash where the bundle
   gives one) it comes from. This is what makes the answer checkable by someone
   who does not trust you.
3. REASON, do not dump. Work out the answer: convert timestamps to dates, compare
   ratios, follow money between accounts, connect a finding to the events that
   produced it. Do not paste rows of the bundle back at the reader.
4. Amounts are USDC base units with 6 decimals unless a field name ends in
   "Readable". 1000000 base units is 1.000000 USDC. Never present a base-unit
   integer as if it were dollars.
5. Coverage ratios are basis points: 10000 bps = 100%. A class is short when
   held < owed.
6. "mandateVersionClaimed" on a deposit is what the splitter asserted. The splits
   beside it are what actually happened on chain. When they disagree, say so —
   that disagreement is the product's most important signal.
7. Never say BOLT, or any business using it, is compliant with any regulation.
   BOLT provides technical enforcement and public verifiability. If asked about
   compliance, say that and stop.
8. Be brief and concrete. A few short paragraphs. No preamble, no headings unless
   the answer genuinely needs them, no offers to help further.`;

export interface Answer {
  answer: string;
  model: string;
  asOfBlock: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface OpenRouterResponse {
  model: string;
  choices: { message: { content: string; reasoning_details?: unknown } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  error?: { message: string };
}

/**
 * Asks the model the question against the bundle, via OpenRouter's
 * OpenAI-compatible `/chat/completions` endpoint. `reasoning.enabled` asks
 * OpenRouter to run the model's own reasoning step before answering — the
 * literal thing FR-7.7 requires ("reason, do not dump").
 */
export async function ask(
  bundle: unknown,
  question: string,
  opts: { apiKey?: string; model?: string } = {}
): Promise<Answer> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new MissingApiKey();

  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Evidence bundle:\n\n${JSON.stringify(bundle, null, 1)}\n\nQuestion: ${question}`
        }
      ],
      reasoning: { enabled: true }
    })
  });

  const body = (await res.json()) as OpenRouterResponse;
  if (!res.ok || body.error) {
    throw new Error(`OpenRouter request failed: HTTP ${res.status} ${body.error?.message ?? JSON.stringify(body)}`);
  }

  const answer = (body.choices[0]?.message.content ?? "").trim();

  return {
    answer,
    model: body.model ?? model,
    asOfBlock: String((bundle as { asOf?: { indexedAtBlock?: string } }).asOf?.indexedAtBlock ?? ""),
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0
    }
  };
}
