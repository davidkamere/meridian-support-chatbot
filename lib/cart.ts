import type { CartItem, CartState, Product } from "@/lib/types";

const USD = "USD";

export function createEmptyCartState(): CartState {
  return {
    items: [],
    awaitingConfirmation: false,
  };
}

export function normalizeCartState(cartState: CartState | null | undefined): CartState {
  if (!cartState) {
    return createEmptyCartState();
  }

  return {
    items: Array.isArray(cartState.items) ? cartState.items : [],
    awaitingConfirmation: Boolean(cartState.awaitingConfirmation),
  };
}

export function addToCart(cartState: CartState, product: Product, quantity: number): CartState {
  const nextQuantity = Math.max(1, Math.floor(quantity));
  const unitPrice = parseUnitPrice(product.priceText);
  const existing = cartState.items.find((item) => item.sku === product.sku);

  const items = existing
    ? cartState.items.map((item) =>
        item.sku === product.sku
          ? { ...item, quantity: item.quantity + nextQuantity, stock: product.stock }
          : item,
      )
    : [
        ...cartState.items,
        {
          sku: product.sku,
          name: product.name,
          category: product.category,
          quantity: nextQuantity,
          unitPrice,
          priceText: formatMoney(unitPrice),
          currency: USD,
          stock: product.stock,
        },
      ];

  return {
    items,
    awaitingConfirmation: false,
  };
}

export function removeFromCart(cartState: CartState, sku: string): CartState {
  return {
    items: cartState.items.filter((item) => item.sku !== sku),
    awaitingConfirmation: false,
  };
}

export function setCartQuantity(
  cartState: CartState,
  sku: string,
  quantity: number,
): CartState {
  const nextQuantity = Math.max(0, Math.floor(quantity));
  if (nextQuantity === 0) {
    return removeFromCart(cartState, sku);
  }

  return {
    items: cartState.items.map((item) =>
      item.sku === sku ? { ...item, quantity: nextQuantity } : item,
    ),
    awaitingConfirmation: false,
  };
}

export function clearCart(cartState: CartState): CartState {
  return {
    ...cartState,
    items: [],
    awaitingConfirmation: false,
  };
}

export function markCartAwaitingConfirmation(cartState: CartState): CartState {
  return {
    ...cartState,
    awaitingConfirmation: true,
  };
}

export function cartItemCount(cartState: CartState): number {
  return cartState.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function cartSubtotal(cartState: CartState): number {
  return Number(
    cartState.items
      .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      .toFixed(2),
  );
}

export function cartHasItems(cartState: CartState): boolean {
  return cartState.items.length > 0;
}

export function getCartItem(cartState: CartState, sku: string): CartItem | null {
  return cartState.items.find((item) => item.sku === sku) ?? null;
}

export function summarizeCart(cartState: CartState): string {
  if (!cartState.items.length) {
    return "Your cart is currently empty.";
  }

  const lines = [
    `Cart has ${cartItemCount(cartState)} item(s) across ${cartState.items.length} product(s).`,
    "",
  ];

  cartState.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. [${item.sku}] ${item.name}`,
      `   Qty: ${item.quantity} × ${formatMoney(item.unitPrice)} = ${formatMoney(
        item.quantity * item.unitPrice,
      )}`,
      "",
    );
  });

  lines.push(`Subtotal: ${formatMoney(cartSubtotal(cartState))}`);

  if (cartState.awaitingConfirmation) {
    lines.push("Order review is ready. Explicit confirmation is still required before submission.");
  }

  return lines.join("\n").trim();
}

export function buildCreateOrderItems(cartState: CartState) {
  return cartState.items.map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
    unit_price: item.unitPrice.toFixed(2),
    currency: item.currency,
  }));
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: USD,
  }).format(value);
}

function parseUnitPrice(priceText: string): number {
  const match = priceText.match(/([\d,.]+)/);
  if (!match) {
    throw new Error(`Could not parse product price from "${priceText}".`);
  }

  return Number(match[1].replace(/,/g, ""));
}
