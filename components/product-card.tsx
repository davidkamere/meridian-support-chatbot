import { StockBadge } from "@/components/stock-badge";
import type { Product } from "@/lib/types";

type ProductCardProps = {
  product: Product;
};

export function ProductCard({ product }: ProductCardProps) {
  return (
    <section className="product-card">
      <div className="product-header">
        <div>
          <h4>{product.name}</h4>
          <p className="product-meta">
            {product.sku} · {product.category}
          </p>
        </div>
        <StockBadge stock={product.stock} />
      </div>
      <div className="product-price">{product.priceText}</div>
      {product.description ? <p className="product-description">{product.description}</p> : null}
    </section>
  );
}
