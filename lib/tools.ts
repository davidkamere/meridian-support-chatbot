import type { OpenRouterToolDefinition } from "@/lib/types";

const PUBLIC_TOOLS: OpenRouterToolDefinition[] = [
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
];

const VERIFIED_TOOLS: OpenRouterToolDefinition[] = [
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
];

const ADD_TO_CART_TOOL: OpenRouterToolDefinition = {
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
};

const PUBLIC_CATALOG_TOOL_NAMES = ["list_products", "search_products", "get_product"] as const;

export function buildAvailableTools(isVerified: boolean): OpenRouterToolDefinition[] {
  const tools = [...PUBLIC_TOOLS, ADD_TO_CART_TOOL];

  if (!isVerified) {
    return tools;
  }

  return [...tools, ...VERIFIED_TOOLS];
}

export function assertPublicCatalogTool(toolName: string) {
  if (!PUBLIC_CATALOG_TOOL_NAMES.includes(toolName as (typeof PUBLIC_CATALOG_TOOL_NAMES)[number])) {
    throw new Error(`Tool ${toolName} is not allowed in this flow.`);
  }
}
