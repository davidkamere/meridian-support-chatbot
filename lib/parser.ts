import type { Product } from "@/lib/types";

const PRODUCT_LINE_REGEX = /^\[([A-Z]+-\d+)\]\s+(.+)$/;
const CATEGORY_REGEX = /Category:\s+([^|]+)\s+\|\s+Price:\s+(\$[\d,.]+)\s+\|\s+Stock:\s+(\d+)\s+units/;
const DETAIL_NAME_REGEX = /^Product:\s+(.+)$/m;
const DETAIL_SKU_REGEX = /^SKU:\s+(.+)$/m;
const DETAIL_CATEGORY_REGEX = /^Category:\s+(.+)$/m;
const DETAIL_PRICE_REGEX = /^Price:\s+(.+)$/m;
const DETAIL_STOCK_REGEX = /^Stock:\s+(\d+)\s+units$/m;
const DETAIL_DESCRIPTION_REGEX = /^Description:\s+([\s\S]+)$/m;

export function parseProductList(text: string): Product[] {
  const lines = text.split("\n");
  const products: Product[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    const headMatch = line.match(PRODUCT_LINE_REGEX);
    if (!headMatch) {
      continue;
    }

    const metaLine = lines[index + 1]?.trim() ?? "";
    const metaMatch = metaLine.match(CATEGORY_REGEX);
    if (!metaMatch) {
      continue;
    }

    products.push({
      sku: headMatch[1],
      name: headMatch[2],
      category: metaMatch[1].trim(),
      priceText: metaMatch[2],
      stock: Number(metaMatch[3]),
    });
  }

  return products;
}

export function parseProductDetail(text: string): Product | null {
  const name = text.match(DETAIL_NAME_REGEX)?.[1]?.trim();
  const sku = text.match(DETAIL_SKU_REGEX)?.[1]?.trim();
  const category = text.match(DETAIL_CATEGORY_REGEX)?.[1]?.trim();
  const priceText = text.match(DETAIL_PRICE_REGEX)?.[1]?.trim();
  const stock = text.match(DETAIL_STOCK_REGEX)?.[1]?.trim();
  const description = text.match(DETAIL_DESCRIPTION_REGEX)?.[1]?.trim();

  if (!name || !sku || !category || !priceText || !stock) {
    return null;
  }

  return {
    sku,
    name,
    category,
    priceText,
    stock: Number(stock),
    description,
  };
}
