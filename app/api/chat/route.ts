import { NextResponse } from "next/server";
import { runCatalogAgent } from "@/lib/catalog";
import type { ChatRequestBody } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        { error: "Please send a product question." },
        { status: 400 },
      );
    }

    const response = await runCatalogAgent(message);
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json(
      {
        message:
          "I hit a problem while talking to Meridian's catalog service. Please try again in a moment.",
        products: [],
        intent: "error",
        debug: message,
      },
      { status: 500 },
    );
  }
}
