import { describe, expect, it } from "vitest";
import {
  addToCart,
  buildCreateOrderItems,
  cartHasItems,
  cartItemCount,
  cartSubtotal,
  clearCart,
  createEmptyCartState,
  getCartItem,
  markCartAwaitingConfirmation,
  setCartQuantity,
} from "@/lib/cart";
import type { Product } from "@/lib/types";

const sampleProduct: Product = {
  sku: "ACC-0132",
  name: "Wireless Keyboard - Model B",
  category: "Accessories",
  priceText: "$30.20",
  stock: 70,
};

describe("cart", () => {
  it("adds an item to an empty cart", () => {
    const next = addToCart(createEmptyCartState(), sampleProduct, 2);

    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      sku: "ACC-0132",
      quantity: 2,
      unitPrice: 30.2,
    });
    expect(next.awaitingConfirmation).toBe(false);
  });

  it("increments quantity when the same sku is added twice", () => {
    const once = addToCart(createEmptyCartState(), sampleProduct, 1);
    const twice = addToCart(once, sampleProduct, 3);

    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]?.quantity).toBe(4);
  });

  it("removes an item when quantity is set to zero", () => {
    const cart = addToCart(createEmptyCartState(), sampleProduct, 2);
    const next = setCartQuantity(cart, sampleProduct.sku, 0);

    expect(next.items).toHaveLength(0);
    expect(cartHasItems(next)).toBe(false);
  });

  it("clears the cart and resets confirmation state", () => {
    const cart = markCartAwaitingConfirmation(
      addToCart(createEmptyCartState(), sampleProduct, 2),
    );
    const next = clearCart(cart);

    expect(next.items).toHaveLength(0);
    expect(next.awaitingConfirmation).toBe(false);
  });

  it("calculates item count and subtotal correctly", () => {
    const cart = addToCart(createEmptyCartState(), sampleProduct, 2);

    expect(cartItemCount(cart)).toBe(2);
    expect(cartSubtotal(cart)).toBe(60.4);
  });

  it("marks the cart as awaiting confirmation", () => {
    const cart = addToCart(createEmptyCartState(), sampleProduct, 1);
    const next = markCartAwaitingConfirmation(cart);

    expect(next.awaitingConfirmation).toBe(true);
  });

  it("builds the create_order payload with decimal strings", () => {
    const cart = addToCart(createEmptyCartState(), sampleProduct, 2);

    expect(buildCreateOrderItems(cart)).toEqual([
      {
        sku: "ACC-0132",
        quantity: 2,
        unit_price: "30.20",
        currency: "USD",
      },
    ]);
  });

  it("gets a cart item by sku", () => {
    const cart = addToCart(createEmptyCartState(), sampleProduct, 1);

    expect(getCartItem(cart, "ACC-0132")?.name).toBe("Wireless Keyboard - Model B");
    expect(getCartItem(cart, "MISSING")).toBeNull();
  });
});
