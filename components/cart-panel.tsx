import { cartItemCount, cartSubtotal, formatMoney } from "@/lib/cart";
import type { CartState } from "@/lib/types";

type CartPanelProps = {
  cartState: CartState;
};

export function CartPanel({ cartState }: CartPanelProps) {
  const items = cartState.items;

  return (
    <aside className="cart-panel">
      <div className="cart-header">
        <h2 className="cart-title">Order Cart</h2>
        <p className="cart-meta">{cartItemCount(cartState)} item(s)</p>
      </div>

      {items.length === 0 ? (
        <p className="cart-empty">Your cart is empty.</p>
      ) : (
        <div className="cart-list">
          {items.map((item) => (
            <section key={item.sku} className="cart-item">
              <div className="cart-item-head">
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.sku} · {item.category}
                  </p>
                </div>
                <span className="cart-qty">×{item.quantity}</span>
              </div>
              <p className="cart-price">
                {formatMoney(item.unitPrice)} each · {formatMoney(item.unitPrice * item.quantity)}
              </p>
            </section>
          ))}
        </div>
      )}

      <div className="cart-footer">
        <div className="cart-total-row">
          <span>Subtotal</span>
          <strong>{formatMoney(cartSubtotal(cartState))}</strong>
        </div>
        {cartState.awaitingConfirmation ? (
          <p className="cart-note">
            Review is ready. Ask the assistant to confirm the order when you are ready.
          </p>
        ) : (
          <p className="cart-note">Ask the assistant to add, remove, or update cart items.</p>
        )}
      </div>
    </aside>
  );
}
