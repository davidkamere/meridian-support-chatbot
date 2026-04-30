import { verifyCustomerPin } from "@/lib/auth";
import { callTool } from "@/lib/mcp-client";
import { getVerifiedCustomerOrder, listVerifiedCustomerOrders } from "@/lib/orders";
import { parseProductDetail, parseProductList } from "@/lib/parser";
import type {
  ChatApiResponse,
  ChatTurn,
  OpenRouterMessage,
  OpenRouterResponse,
  OpenRouterToolCall,
  Product,
  VerifiedSession,
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 8;

const SYSTEM_PROMPT = `
You are Meridian Electronics' customer support assistant.

You help customers browse products, search the catalog, check stock availability, and support verified customers with their own order history.

Rules:
- Never mention internal systems, MCP, or tool names unless the user asks.
- For verification, ask for the account email and 4-digit PIN when needed.
- Only help with order history after verification succeeds.
- Never ask for any customer ID.
- After verification, only discuss the verified customer's own orders.
- Do not claim to support checkout in this phase.
- Prefer calling a tool when the user asks about products, stock, price, categories, or a SKU.
- Prefer calling verification or order tools when the user asks about orders, past purchases, or account-specific order details.
- After using tools, answer clearly and concisely in a customer-friendly tone.
`.trim();

const PUBLIC_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_products",
      description: "List Meridian products, optionally filtered by category and active status.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: ["string", "null"],
            description:
              "Category such as Computers, Monitors, Printers, Networking, or Accessories.",
          },
          is_active: {
            type: ["boolean", "null"],
            description: "Filter by active catalog status. Use true for public browsing.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search Meridian products by keyword, partial product name, or descriptive phrase.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Customer search phrase such as 27-inch monitor or wireless keyboard.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description: "Get details and stock for one specific Meridian product SKU.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: {
            type: "string",
            description: "A Meridian SKU such as MON-0054.",
          },
        },
        required: ["sku"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_customer_pin",
      description:
        "Verify a returning Meridian customer using the email on the account and a 4-digit PIN.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: {
            type: "string",
            description: "The email address on the customer account.",
          },
          pin: {
            type: "string",
            description: "The customer's 4-digit PIN.",
          },
        },
        required: ["email", "pin"],
      },
    },
  },
] as const;

type ToolExecutionResult = {
  rawText: string;
  products: Product[];
  verifiedSession?: VerifiedSession | null;
};

export async function runCatalogAgent(
  message: string,
  history: ChatTurn[] = [],
  verifiedSession: VerifiedSession | null = null,
): Promise<ChatApiResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable.");
  }

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(verifiedSession),
    },
    ...normalizeHistory(history),
    { role: "user", content: message },
  ];

  const collectedProducts = new Map<string, Product>();
  let nextVerifiedSession = verifiedSession;

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
      };
    }

    for (const toolCall of toolCalls) {
      const executionResult = await executeSupportToolCall(toolCall, nextVerifiedSession);
      for (const product of executionResult.products) {
        collectedProducts.set(product.sku, product);
      }
      if (executionResult.verifiedSession) {
        nextVerifiedSession = executionResult.verifiedSession;
        messages[0] = {
          role: "system",
          content: buildSystemPrompt(nextVerifiedSession),
        };
      }

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

async function executeSupportToolCall(
  toolCall: OpenRouterToolCall,
  verifiedSession: VerifiedSession | null,
): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  const parsedArguments = parseToolArguments(toolCall.function.arguments);

  if (toolName === "list_products") {
    const rawText = await callTool("list_products", {
      category: typeof parsedArguments.category === "string" ? parsedArguments.category : null,
      is_active:
        typeof parsedArguments.is_active === "boolean" ? parsedArguments.is_active : true,
    });

    return {
      rawText,
      products: parseProductList(rawText).slice(0, 8),
    };
  }

  if (toolName === "search_products") {
    const rawText = await callTool("search_products", {
      query: String(parsedArguments.query ?? ""),
    });

    return {
      rawText,
      products: parseProductList(rawText).slice(0, 8),
    };
  }

  if (toolName === "verify_customer_pin") {
    const result = await verifyCustomerPin({
      email: String(parsedArguments.email ?? ""),
      pin: String(parsedArguments.pin ?? ""),
    });

    return {
      rawText: result.rawText,
      products: [],
      verifiedSession: result.verifiedSession,
    };
  }

  if (toolName === "list_my_orders") {
    if (!verifiedSession) {
      throw new Error("A verified session is required before listing orders.");
    }

    const rawText = await listVerifiedCustomerOrders(
      verifiedSession,
      typeof parsedArguments.status === "string" ? parsedArguments.status : null,
    );

    return {
      rawText,
      products: [],
    };
  }

  if (toolName === "get_my_order") {
    if (!verifiedSession) {
      throw new Error("A verified session is required before looking up an order.");
    }

    const rawText = await getVerifiedCustomerOrder(
      verifiedSession,
      String(parsedArguments.order_id ?? ""),
    );

    return {
      rawText,
      products: [],
    };
  }

  assertPublicCatalogTool(toolName);

  const rawText = await callTool("get_product", {
    sku: String(parsedArguments.sku ?? ""),
  });
  const product = parseProductDetail(rawText);

  return {
    rawText,
    products: product ? [product] : [],
  };
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    return parsed;
  } catch {
    throw new Error(`Invalid tool arguments: ${argumentsText}`);
  }
}

function buildAvailableTools(isVerified: boolean) {
  if (!isVerified) {
    return PUBLIC_TOOLS;
  }

  return [
    ...PUBLIC_TOOLS,
    {
      type: "function",
      function: {
        name: "list_my_orders",
        description: "List the verified customer's orders, optionally filtered by order status.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: ["string", "null"],
              description:
                "Optional order status filter such as draft, submitted, approved, fulfilled, or cancelled.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_my_order",
        description: "Get details for one specific order that belongs to the verified customer.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            order_id: {
              type: "string",
              description: "The order ID the verified customer wants to inspect.",
            },
          },
          required: ["order_id"],
        },
      },
    },
  ] as const;
}

function buildSystemPrompt(verifiedSession: VerifiedSession | null) {
  const sessionText = verifiedSession
    ? `Verified session: yes\nVerified email: ${verifiedSession.email}\nVerified customer ID: ${verifiedSession.customerId}`
    : "Verified session: no";

  return `${SYSTEM_PROMPT}\n\n${sessionText}`;
}

function assertPublicCatalogTool(toolName: string) {
  const publicToolNames = ["list_products", "search_products", "get_product"] as const;

  if (!publicToolNames.includes(toolName as (typeof publicToolNames)[number])) {
    throw new Error(`Tool ${toolName} is not allowed in this flow.`);
  }
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
