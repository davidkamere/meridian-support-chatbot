import { callTool } from "@/lib/mcp-client";
import { parseProductDetail, parseProductList } from "@/lib/parser";
import type {
  ChatApiResponse,
  OpenRouterMessage,
  OpenRouterResponse,
  OpenRouterToolCall,
  Product,
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const PUBLIC_TOOL_NAMES = ["list_products", "search_products", "get_product"] as const;
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `
You are Meridian Electronics' public catalog assistant.

You help customers browse products, search the catalog, and check stock availability.
You may only use these catalog tools:
- list_products
- search_products
- get_product

Rules:
- Never mention internal systems, MCP, or tool names unless the user asks.
- Stay within public catalog browsing only.
- Do not claim to support order history, authentication, or checkout in this phase.
- Prefer calling a tool when the user asks about products, stock, price, categories, or a SKU.
- After using tools, answer clearly and concisely in a customer-friendly tone.
`.trim();

const TOOLS = [
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
            description: "Category such as Computers, Monitors, Printers, Networking, or Accessories.",
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
      description: "Search Meridian products by keyword, partial product name, or descriptive phrase.",
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
] as const;

type ToolExecutionResult = {
  rawText: string;
  products: Product[];
};

export async function runCatalogAgent(message: string): Promise<ChatApiResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable.");
  }

  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];

  const collectedProducts = new Map<string, Product>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const llmResponse = await requestOpenRouter(messages, apiKey);
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
      };
    }

    for (const toolCall of toolCalls) {
      const executionResult = await executePublicToolCall(toolCall);
      for (const product of executionResult.products) {
        collectedProducts.set(product.sku, product);
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
  };
}

async function requestOpenRouter(messages: OpenRouterMessage[], apiKey: string) {
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
      tools: TOOLS,
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

async function executePublicToolCall(toolCall: OpenRouterToolCall): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  if (!PUBLIC_TOOL_NAMES.includes(toolName as (typeof PUBLIC_TOOL_NAMES)[number])) {
    throw new Error(`Tool ${toolName} is not allowed in the public catalog flow.`);
  }

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
