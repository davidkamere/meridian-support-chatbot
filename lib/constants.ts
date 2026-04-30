import type { Message } from "@/lib/types";

export const INITIAL_MESSAGES: Message[] = [
  {
    id: "welcome-message",
    role: "assistant",
    content:
      "Welcome to Meridian Electronics. Ask me about products, categories, pricing, or stock availability and I’ll search the live catalog for you.",
  },
];
