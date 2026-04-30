import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVerifiedCustomerOrder, listVerifiedCustomerOrders } from "@/lib/orders";
import type { VerifiedSession } from "@/lib/types";

const callToolMock = vi.fn();

vi.mock("@/lib/mcp-client", () => ({
  callTool: (...args: unknown[]) => callToolMock(...args),
}));

const verifiedSession: VerifiedSession = {
  customerId: "1da9f01a-b8ea-461c-b6d4-27ae5b43cd9f",
  email: "laurahenderson@example.org",
  customerName: "Laura Henderson",
  verifiedAt: "2026-04-30T12:00:00.000Z",
};

describe("orders", () => {
  beforeEach(() => {
    callToolMock.mockReset();
  });

  it("lists orders using the verified customer id", async () => {
    callToolMock.mockResolvedValue("Found 2 orders");

    const result = await listVerifiedCustomerOrders(verifiedSession, "submitted");

    expect(result).toBe("Found 2 orders");
    expect(callToolMock).toHaveBeenCalledWith("list_orders", {
      customer_id: verifiedSession.customerId,
      status: "submitted",
    });
  });

  it("returns order details for a matching verified customer", async () => {
    callToolMock.mockResolvedValue(`Order ID: 040d0e08-a556-42c0-be2b-ef64e9da2acb
Customer ID: 1da9f01a-b8ea-461c-b6d4-27ae5b43cd9f
Status: submitted`);

    const result = await getVerifiedCustomerOrder(
      verifiedSession,
      "040d0e08-a556-42c0-be2b-ef64e9da2acb",
    );

    expect(result).toContain("Order ID:");
    expect(callToolMock).toHaveBeenCalledWith("get_order", {
      order_id: "040d0e08-a556-42c0-be2b-ef64e9da2acb",
    });
  });

  it("rejects an order that does not belong to the verified customer", async () => {
    callToolMock.mockResolvedValue(`Order ID: 040d0e08-a556-42c0-be2b-ef64e9da2acb
Customer ID: 99999999-9999-4999-8999-999999999999
Status: submitted`);

    await expect(
      getVerifiedCustomerOrder(verifiedSession, "040d0e08-a556-42c0-be2b-ef64e9da2acb"),
    ).rejects.toThrow("does not belong to the verified customer session");
  });

  it("rejects when the order customer id cannot be verified", async () => {
    callToolMock.mockResolvedValue("Order details without customer id");

    await expect(
      getVerifiedCustomerOrder(verifiedSession, "040d0e08-a556-42c0-be2b-ef64e9da2acb"),
    ).rejects.toThrow("Could not verify who the order belongs to");
  });
});
