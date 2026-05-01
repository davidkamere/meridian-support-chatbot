import { summarizeCart } from "@/lib/cart";
import type {
  CartState,
  ChatTurn,
  OpenRouterResponse,
  RequestRewriteResult,
  VerifiedSession,
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const HISTORY_LIMIT = 8;
const REWRITE_MODEL = process.env.OPENROUTER_REWRITE_MODEL ?? OPENROUTER_MODEL;

const REWRITE_SYSTEM_PROMPT = `
You rewrite customer support requests into explicit operational instructions for a tool-using retail assistant.

Rules:
- Preserve the user's intent exactly.
- Do not answer the user.
- Do not invent products, SKUs, prices, or customer data.
- If the user refers to "the cheapest one", "that one", "the second one", or similar, resolve this by explicitly referencing the most recent products or cart context from conversation.
- If the user asks to add an item to the cart and names a product instead of a SKU, rewrite it so the assistant first resolves the product and then performs the cart action.
- If the request is already explicit, return a close paraphrase.
- Output only the rewritten instruction text.
`.trim();

export async function rewriteSupportRequest(
  message: string,
  history: ChatTurn[],
  verifiedSession: VerifiedSession | null,
  cartState: CartState,
  apiKey: string,
): Promise<RequestRewriteResult> {
  const contextMessage = buildRewriteContext(history, verifiedSession, cartState);
  const rewriteInput = `${contextMessage}\n\nCurrent user request:\n${message}`;
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://meridian-support-chatbot.local",
      "X-Title": "Meridian Support Chatbot",
    },
    body: JSON.stringify({
      model: REWRITE_MODEL,
      messages: [
        { role: "system", content: REWRITE_SYSTEM_PROMPT },
        { role: "user", content: rewriteInput },
      ],
      temperature: 0,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter rewrite request failed with status ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const rewrittenMessage = payload.choices?.[0]?.message?.content?.trim();
  if (!rewrittenMessage) {
    return { rewrittenMessage: message };
  }

  return { rewrittenMessage };
}

function buildRewriteContext(
  history: ChatTurn[],
  verifiedSession: VerifiedSession | null,
  cartState: CartState,
): string {
  const conversation = history
    .slice(-HISTORY_LIMIT)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  const verificationContext = verifiedSession
    ? `Verified session: yes (${verifiedSession.email})`
    : "Verified session: no";

  return [
    "Rewrite the final user request into an explicit instruction for a tool-using assistant.",
    "",
    verificationContext,
    "",
    "Cart snapshot:",
    summarizeCart(cartState),
    "",
    "Recent conversation:",
    conversation || "None",
  ].join("\n");
}
