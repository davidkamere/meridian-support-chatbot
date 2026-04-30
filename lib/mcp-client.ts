import type { MpcJsonRpcResponse } from "@/lib/types";

const DEFAULT_MCP_URL = "https://order-mcp-74afyau24q-uc.a.run.app/mcp";

function getMcpUrl() {
  return process.env.MERIDIAN_MCP_URL ?? DEFAULT_MCP_URL;
}

async function postMcp(payload: Record<string, unknown>) {
  const response = await fetch(getMcpUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MCP request failed with status ${response.status}`);
  }

  const body = await response.text();
  if (!body.trim()) {
    return null;
  }

  return JSON.parse(body) as MpcJsonRpcResponse;
}

export async function initializeMcpSession() {
  await postMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "meridian-nextjs-chatbot",
        version: "0.1.0",
      },
    },
  });

  await postMcp({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
}

export async function callTool(name: string, args: Record<string, unknown>) {
  await initializeMcpSession();

  const payload = await postMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });

  if (!payload) {
    throw new Error("MCP tool call returned an empty response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  if (payload.result?.isError) {
    const message = payload.result.content?.[0]?.text ?? "Tool call failed.";
    throw new Error(message);
  }

  const text =
    payload.result?.structuredContent?.result ??
    payload.result?.content?.find((item) => item.type === "text")?.text ??
    "";

  return text;
}
