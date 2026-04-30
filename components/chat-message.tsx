import { ProductCard } from "@/components/product-card";
import type { Message } from "@/lib/types";

type ChatMessageProps = {
  message: Message;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const messageClass =
    message.role === "user" ? "message-bubble message-user" : "message-bubble message-assistant";

  return (
    <article className={messageClass}>
      <span className="message-role">{message.role}</span>
      <p className="message-text">{message.content}</p>
      {message.products && message.products.length > 0 ? (
        <div className="product-grid">
          {message.products.map((product) => (
            <ProductCard key={product.sku} product={product} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
