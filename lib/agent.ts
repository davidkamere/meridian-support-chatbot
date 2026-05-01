import { normalizeCartState, summarizeCart } from "@/lib/cart";
import { rewriteSupportRequest } from "@/lib/rewrite";
import { executeSupportToolCall } from "@/lib/tool-executor";
import { buildAvailableTools } from "@/lib/tools";
import type {
  CartState,
  ChatApiResponse,
  ChatTurn,
  OpenRouterMessage,
  OpenRouterResponse,
  Product,
  VerifiedSession,
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 8;

const SYSTEM_PROMPT = `
You are Meridian Electronics' customer support assistant.

You help customers browse products, search the catalog, check stock availability, manage a cart, and support verified customers with their own order history.

Rules:
- Never mention internal systems, MCP, or tool names unless the user asks.
- For verification, ask for the account email and 4-digit PIN when needed.
- Only help with order history after verification succeeds.
- Never ask for any customer ID.
- After verification, only discuss the verified customer's own orders.
- For cart work, prefer the local cart tools instead of improvising your own state.
- Before placing an order, first review the cart and only submit after explicit user confirmation.
- Prefer calling a tool when the user asks about products, stock, price, categories, or a SKU.
- Prefer calling verification or order tools when the user asks about orders, past purchases, or account-specific order details.
- Prefer calling cart tools when the user wants to add, remove, change quantity, review, clear, or place an order.
- When the user names a product but not its SKU, resolve the product by name and then add that exact item to the cart.
- After using tools, answer clearly and concisely in a customer-friendly tone.
`.trim();

export async function runCatalogAgent(
  message: string,
  history: ChatTurn[] = [],
  verifiedSession: VerifiedSession | null = null,
  cartState: CartState | null = null,
): Promise<ChatApiResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable.");
  }

  const normalizedCartState = normalizeCartState(cartState);
  const rewrittenRequest = await rewriteSupportRequest(
    message,
    history,
    verifiedSession,
    normalizedCartState,
    apiKey,
  );

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(verifiedSession, normalizedCartState),
    },
    ...normalizeHistory(history),
    { role: "user", content: rewrittenRequest.rewrittenMessage },
  ];

  const collectedProducts = new Map<string, Product>();
  let nextVerifiedSession = verifiedSession;
  let nextCartState = normalizedCartState;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const llmResponse = await requestOpenRouter(messages, apiKey, nextVerifiedSession);
    const assistantMessage = llmResponse.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("OpenRouter returned no assistant message.");
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: assistantMessage.tool_calls,
    });

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        intent: "agent",
        message:
          assistantMessage.content?.trim() ||
          "I’m ready to help you browse Meridian’s catalog.",
        products: Array.from(collectedProducts.values()).slice(0, 8),
        verifiedSession: nextVerifiedSession,
        cartState: nextCartState,
      };
    }

    for (const toolCall of toolCalls) {
      const executionResult = await executeSupportToolCall(
        toolCall,
        nextVerifiedSession,
        nextCartState,
      );
      for (const product of executionResult.products) {
        collectedProducts.set(product.sku, product);
      }
      if (executionResult.verifiedSession) {
        nextVerifiedSession = executionResult.verifiedSession;
      }
      if (executionResult.cartState) {
        nextCartState = executionResult.cartState;
      }
      messages[0] = {
        role: "system",
        content: buildSystemPrompt(nextVerifiedSession, nextCartState),
      };

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify(
          {
            raw_text: executionResult.rawText,
            products: executionResult.products,
          },
          null,
          2,
        ),
      });
    }
  }

  return {
    intent: "agent",
    message:
      "I gathered Meridian catalog data, but I reached the tool-use limit for this turn. Please try asking in a slightly simpler way.",
    products: Array.from(collectedProducts.values()).slice(0, 8),
    verifiedSession: nextVerifiedSession,
    cartState: nextCartState,
  };
}

async function requestOpenRouter(
  messages: OpenRouterMessage[],
  apiKey: string,
  verifiedSession: VerifiedSession | null,
) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://meridian-support-chatbot.local",
      "X-Title": "Meridian Support Chatbot",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      tools: buildAvailableTools(Boolean(verifiedSession)),
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.2,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed with status ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  return payload;
}

function buildSystemPrompt(
  verifiedSession: VerifiedSession | null,
  cartState: CartState,
) {
  const sessionText = verifiedSession
    ? `Verified session: yes\nVerified email: ${verifiedSession.email}\nVerified customer ID: ${verifiedSession.customerId}`
    : "Verified session: no";

  return `${SYSTEM_PROMPT}\n\n${sessionText}\n\nCart snapshot:\n${summarizeCart(cartState)}`;
}

function normalizeHistory(history: ChatTurn[]): OpenRouterMessage[] {
  return history
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && turn.content.trim())
    .slice(-HISTORY_LIMIT)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim(),
    }));
}
