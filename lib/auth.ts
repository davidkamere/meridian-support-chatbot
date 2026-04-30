import { callTool } from "@/lib/mcp-client";
import type { VerifiedSession } from "@/lib/types";

type VerifyCustomerPinArgs = {
  email: string;
  pin: string;
};

type VerificationResult = {
  rawText: string;
  verifiedSession: VerifiedSession;
};

const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export async function verifyCustomerPin(
  args: VerifyCustomerPinArgs,
): Promise<VerificationResult> {
  const rawText = await callTool("verify_customer_pin", {
    email: args.email,
    pin: args.pin,
  });

  const verifiedSession = parseVerifiedSession(rawText, args.email);

  return {
    rawText,
    verifiedSession,
  };
}

function parseVerifiedSession(rawText: string, fallbackEmail: string): VerifiedSession {
  const customerId = rawText.match(UUID_REGEX)?.[0];
  if (!customerId) {
    throw new Error("Could not extract the verified customer ID from the verification response.");
  }

  const email = rawText.match(EMAIL_REGEX)?.[0] ?? fallbackEmail;
  const customerName =
    rawText.match(/^✓?\s*Customer verified:\s+(.+)$/m)?.[1]?.trim() ??
    rawText.match(/^Name:\s+(.+)$/m)?.[1]?.trim() ??
    rawText.match(/^Customer:\s+(.+)$/m)?.[1]?.trim() ??
    null;

  return {
    customerId,
    email,
    customerName,
    verifiedAt: new Date().toISOString(),
  };
}
