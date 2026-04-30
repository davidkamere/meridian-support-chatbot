type StockBadgeProps = {
  stock: number;
};

export function StockBadge({ stock }: StockBadgeProps) {
  if (stock <= 0) {
    return <span className="badge badge-out">Out of stock</span>;
  }

  if (stock <= 10) {
    return <span className="badge badge-low">Low stock · {stock}</span>;
  }

  return <span className="badge badge-in">In stock · {stock}</span>;
}
