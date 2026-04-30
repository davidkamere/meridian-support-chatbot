import { verifyCustomerPin } from "@/lib/auth";
import {
  addToCart,
  buildCreateOrderItems,
  cartHasItems,
  createEmptyCartState,
  getCartItem,
  markCartAwaitingConfirmation,
  normalizeCartState,
  removeFromCart,
  setCartQuantity,
  summarizeCart,
} from "@/lib/cart";
import { callTool } from "@/lib/mcp-client";
import { getVerifiedCustomerOrder, listVerifiedCustomerOrders } from "@/lib/orders";
import { parseProductDetail, parseProductList } from "@/lib/parser";
import type {
  CartState,
  ChatApiResponse,
  ChatTurn,
  OpenRouterMessage,
  OpenRouterResponse,
  OpenRouterToolCall,
  Product,
  RequestRewriteResult,
  VerifiedSession,
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 8;
const REWRITE_MODEL = process.env.OPENROUTER_REWRITE_MODEL ?? OPENROUTER_MODEL;

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
  cartState?: CartState;
};

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

async function rewriteSupportRequest(
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

async function executeSupportToolCall(
  toolCall: OpenRouterToolCall,
  verifiedSession: VerifiedSession | null,
  cartState: CartState,
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

  if (toolName === "add_to_cart") {
    const product = await resolveProductForCart(parsedArguments);
    if (!product) {
      throw new Error("Could not load the product for cart addition.");
    }

    const quantity = Number(parsedArguments.quantity ?? 1);
    const nextState = addToCart(cartState, product, quantity);

    return {
      rawText: `Added ${Math.max(1, Math.floor(quantity))} of ${product.name} to the cart.\n\n${summarizeCart(nextState)}`,
      products: [product],
      cartState: nextState,
    };
  }

  if (toolName === "remove_from_cart") {
    const sku = String(parsedArguments.sku ?? "");
    const existing = getCartItem(cartState, sku);
    const nextState = removeFromCart(cartState, sku);

    return {
      rawText: existing
        ? `Removed ${existing.name} from the cart.\n\n${summarizeCart(nextState)}`
        : `There was no cart item with SKU ${sku}.`,
      products: [],
      cartState: nextState,
    };
  }

  if (toolName === "set_cart_quantity") {
    const sku = String(parsedArguments.sku ?? "");
    const quantity = Number(parsedArguments.quantity ?? 1);
    const nextState = setCartQuantity(cartState, sku, quantity);

    return {
      rawText: `Updated ${sku} quantity to ${Math.max(0, Math.floor(quantity))}.\n\n${summarizeCart(nextState)}`,
      products: [],
      cartState: nextState,
    };
  }

  if (toolName === "view_cart") {
    return {
      rawText: summarizeCart(cartState),
      products: [],
      cartState,
    };
  }

  if (toolName === "clear_cart") {
    const nextState = createEmptyCartState();
    return {
      rawText: "Cleared the cart.",
      products: [],
      cartState: nextState,
    };
  }

  if (toolName === "submit_order") {
    if (!cartHasItems(cartState)) {
      return {
        rawText: "The cart is empty, so there is nothing to order yet.",
        products: [],
        cartState,
      };
    }

    if (!verifiedSession) {
      return {
        rawText:
          "A verified account is required before placing an order. Please verify with your email and 4-digit PIN first.",
        products: [],
        cartState,
      };
    }

    const confirm = Boolean(parsedArguments.confirm);
    if (!confirm) {
      const nextState = markCartAwaitingConfirmation(cartState);
      return {
        rawText: `Here is your order review.\n\n${summarizeCart(nextState)}\n\nIf you want to proceed, explicitly confirm that you want to place the order.`,
        products: [],
        cartState: nextState,
      };
    }

    if (!cartState.awaitingConfirmation) {
      return {
        rawText:
          "Before submitting the order, I need to review the cart with you first. Ask me to review or place the order again and I will prepare the final confirmation step.",
        products: [],
        cartState,
      };
    }

    const rawText = await callTool("create_order", {
      customer_id: verifiedSession.customerId,
      items: buildCreateOrderItems(cartState),
    });

    return {
      rawText,
      products: [],
      cartState: createEmptyCartState(),
    };
  }

  if (toolName === "list_my_orders") {
    if (!verifiedSession) {
      return {
        rawText:
          "I need a verified account before I can list order history. Please verify with your email and 4-digit PIN.",
        products: [],
        cartState,
      };
    }

    const rawText = await listVerifiedCustomerOrders(
      verifiedSession,
      typeof parsedArguments.status === "string" ? parsedArguments.status : null,
    );

    return {
      rawText,
      products: [],
      cartState,
    };
  }

  if (toolName === "get_my_order") {
    if (!verifiedSession) {
      return {
        rawText:
          "I need a verified account before I can look up order details. Please verify with your email and 4-digit PIN.",
        products: [],
        cartState,
      };
    }

    const rawText = await getVerifiedCustomerOrder(
      verifiedSession,
      String(parsedArguments.order_id ?? ""),
    );

    return {
      rawText,
      products: [],
      cartState,
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
    cartState,
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
  const tools = [
    ...PUBLIC_TOOLS,
    {
      type: "function",
      function: {
        name: "add_to_cart",
        description:
          "Add a specific quantity of a product to the session cart. Use sku when known. If the user only gave a product name, pass product_name instead.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: {
              type: ["string", "null"],
              description: "The Meridian SKU to add to the cart when known.",
            },
            product_name: {
              type: ["string", "null"],
              description:
                "The exact or near-exact product name from the conversation when SKU is not known.",
            },
            quantity: {
              type: "integer",
              description: "How many units to add.",
            },
          },
          required: ["quantity"],
        },
      },
    },
  ] as const;

  if (!isVerified) {
    return tools;
  }

  return [
    ...tools,
    {
      type: "function",
      function: {
        name: "remove_from_cart",
        description: "Remove a product SKU from the session cart.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: {
              type: "string",
              description: "The Meridian SKU to remove from the cart.",
            },
          },
          required: ["sku"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_cart_quantity",
        description: "Set the quantity for a cart item. Use 0 to remove it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: {
              type: "string",
              description: "The Meridian SKU already in the cart.",
            },
            quantity: {
              type: "integer",
              description: "The exact quantity to keep in the cart.",
            },
          },
          required: ["sku", "quantity"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "view_cart",
        description: "Review the current cart contents and subtotal.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clear_cart",
        description: "Remove all items from the current cart.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_order",
        description:
          "Review or place the current cart as an order for the verified customer. First call with confirm=false to prepare the final review. Only call with confirm=true after the user explicitly confirms they want to place the order.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            confirm: {
              type: "boolean",
              description: "Use false for review, true only after explicit final confirmation.",
            },
          },
          required: ["confirm"],
        },
      },
    },
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

function buildSystemPrompt(
  verifiedSession: VerifiedSession | null,
  cartState: CartState,
) {
  const sessionText = verifiedSession
    ? `Verified session: yes\nVerified email: ${verifiedSession.email}\nVerified customer ID: ${verifiedSession.customerId}`
    : "Verified session: no";

  return `${SYSTEM_PROMPT}\n\n${sessionText}\n\nCart snapshot:\n${summarizeCart(cartState)}`;
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

async function resolveProductForCart(
  parsedArguments: Record<string, unknown>,
): Promise<Product | null> {
  const sku =
    typeof parsedArguments.sku === "string" && parsedArguments.sku.trim()
      ? parsedArguments.sku.trim()
      : null;

  if (sku) {
    const rawText = await callTool("get_product", { sku });
    return parseProductDetail(rawText);
  }

  const productName =
    typeof parsedArguments.product_name === "string" && parsedArguments.product_name.trim()
      ? parsedArguments.product_name.trim()
      : null;

  if (!productName) {
    return null;
  }

  const searchText = await callTool("search_products", {
    query: productName,
  });
  const products = parseProductList(searchText);
  if (!products.length) {
    return null;
  }

  const lowered = productName.toLowerCase();
  const bestMatch =
    products.find((product) => product.name.toLowerCase() === lowered) ??
    products.find((product) => product.name.toLowerCase().includes(lowered)) ??
    products[0];

  const detailText = await callTool("get_product", {
    sku: bestMatch.sku,
  });
  return parseProductDetail(detailText);
}
