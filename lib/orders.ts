import { callTool } from "@/lib/mcp-client";
import type { VerifiedSession } from "@/lib/types";

const CUSTOMER_ID_REGEX = /^Customer ID:\s+(.+)$/m;

export async function listVerifiedCustomerOrders(
  verifiedSession: VerifiedSession,
  status?: string | null,
): Promise<string> {
  return callTool("list_orders", {
    customer_id: verifiedSession.customerId,
    status: typeof status === "string" && status.trim() ? status.trim() : null,
  });
}

export async function getVerifiedCustomerOrder(
  verifiedSession: VerifiedSession,
  orderId: string,
): Promise<string> {
  const rawText = await callTool("get_order", { order_id: orderId });
  const orderCustomerId = rawText.match(CUSTOMER_ID_REGEX)?.[1]?.trim();

  if (!orderCustomerId) {
    throw new Error("Could not verify who the order belongs to.");
  }

  if (orderCustomerId !== verifiedSession.customerId) {
    throw new Error("That order does not belong to the verified customer session.");
  }

  return rawText;
}
