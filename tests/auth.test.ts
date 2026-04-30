import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCustomerPin } from "@/lib/auth";

const callToolMock = vi.fn();

vi.mock("@/lib/mcp-client", () => ({
  callTool: (...args: unknown[]) => callToolMock(...args),
}));

describe("auth", () => {
  beforeEach(() => {
    callToolMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
  });

  it("verifies a customer and extracts session fields", async () => {
    callToolMock.mockResolvedValue(`✓ Customer verified: Laura Henderson
Customer ID: 1da9f01a-b8ea-461c-b6d4-27ae5b43cd9f
Email: laurahenderson@example.org
Role: buyer`);

    const result = await verifyCustomerPin({
      email: "laurahenderson@example.org",
      pin: "1488",
    });

    expect(callToolMock).toHaveBeenCalledWith("verify_customer_pin", {
      email: "laurahenderson@example.org",
      pin: "1488",
    });
    expect(result.verifiedSession).toEqual({
      customerId: "1da9f01a-b8ea-461c-b6d4-27ae5b43cd9f",
      email: "laurahenderson@example.org",
      customerName: "Laura Henderson",
      verifiedAt: "2026-04-30T12:00:00.000Z",
    });
  });

  it("falls back to the provided email when email is missing in the response", async () => {
    callToolMock.mockResolvedValue(`Customer verified
Customer ID: 1da9f01a-b8ea-461c-b6d4-27ae5b43cd9f`);

    const result = await verifyCustomerPin({
      email: "fallback@example.org",
      pin: "1488",
    });

    expect(result.verifiedSession.email).toBe("fallback@example.org");
    expect(result.verifiedSession.customerName).toBeNull();
  });

  it("throws when the verification response does not contain a customer id", async () => {
    callToolMock.mockResolvedValue("Customer verified but no id present");

    await expect(
      verifyCustomerPin({
        email: "laurahenderson@example.org",
        pin: "1488",
      }),
    ).rejects.toThrow("Could not extract the verified customer ID");
  });
});
