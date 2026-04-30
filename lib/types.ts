export type Product = {
  sku: string;
  name: string;
  category: string;
  priceText: string;
  stock: number;
  description?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: Product[];
};

export type CartItem = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  priceText: string;
  currency: string;
  stock: number;
};

export type CartState = {
  items: CartItem[];
  awaitingConfirmation: boolean;
};

export type ChatRequestBody = {
  message: string;
  history?: ChatTurn[];
  verifiedSession?: VerifiedSession | null;
  cartState?: CartState | null;
};

export type ChatApiResponse = {
  message: string;
  products: Product[];
  intent: "agent" | "error";
  verifiedSession?: VerifiedSession | null;
  cartState?: CartState;
  debug?: string;
};

export type MpcJsonRpcResponse = {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: {
      result?: string;
    };
    isError?: boolean;
  };
  error?: {
    message?: string;
  };
};

export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type VerifiedSession = {
  customerId: string;
  email: string;
  customerName: string | null;
  verifiedAt: string;
};

export type OpenRouterResponse = {
  choices?: Array<{
    message: OpenRouterMessage;
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

export type RequestRewriteResult = {
  rewrittenMessage: string;
};
