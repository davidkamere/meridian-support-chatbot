import { describe, expect, it } from "vitest";
import { parseProductDetail, parseProductList } from "@/lib/parser";

describe("parser", () => {
  it("parses multiple products from a list response", () => {
    const text = `Found 2 products matching 'keyboard':

[ACC-0132] Wireless Keyboard - Model B
  Category: Accessories | Price: $30.20 | Stock: 70 units

[ACC-0133] Wireless Keyboard - Model C
  Category: Accessories | Price: $73.71 | Stock: 13 units`;

    expect(parseProductList(text)).toEqual([
      {
        sku: "ACC-0132",
        name: "Wireless Keyboard - Model B",
        category: "Accessories",
        priceText: "$30.20",
        stock: 70,
      },
      {
        sku: "ACC-0133",
        name: "Wireless Keyboard - Model C",
        category: "Accessories",
        priceText: "$73.71",
        stock: 13,
      },
    ]);
  });

  it("returns an empty list for malformed product list text", () => {
    expect(parseProductList("No structured products here")).toEqual([]);
  });

  it("parses product detail correctly", () => {
    const text = `Product: Wireless Keyboard - Model B
SKU: ACC-0132
Category: Accessories
Price: $30.20 USD
Stock: 70 units
Description: Compact wireless keyboard.`;

    expect(parseProductDetail(text)).toEqual({
      sku: "ACC-0132",
      name: "Wireless Keyboard - Model B",
      category: "Accessories",
      priceText: "$30.20 USD",
      stock: 70,
      description: "Compact wireless keyboard.",
    });
  });

  it("returns null for malformed product detail text", () => {
    expect(parseProductDetail("Missing expected fields")).toBeNull();
  });
});
