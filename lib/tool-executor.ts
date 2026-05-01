import { verifyCustomerPin } from "@/lib/auth";
import {
  addToCart,
  buildCreateOrderItems,
  cartHasItems,
  createEmptyCartState,
  getCartItem,
  markCartAwaitingConfirmation,
  removeFromCart,
  setCartQuantity,
  summarizeCart,
} from "@/lib/cart";
import { callTool } from "@/lib/mcp-client";
import { getVerifiedCustomerOrder, listVerifiedCustomerOrders } from "@/lib/orders";
import { parseProductDetail, parseProductList } from "@/lib/parser";
import { assertPublicCatalogTool } from "@/lib/tools";
import type {
  CartState,
  OpenRouterToolCall,
  Product,
  ToolExecutionResult,
  VerifiedSession,
} from "@/lib/types";

export async function executeSupportToolCall(
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
    return JSON.parse(argumentsText) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid tool arguments: ${argumentsText}`);
  }
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
