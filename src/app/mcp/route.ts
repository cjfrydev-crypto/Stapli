import { NextResponse } from "next/server";
import { authenticateMcpToken, callStapliTool, TOOL_DEFINITIONS } from "@/lib/mcp/stapli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "stapli", title: "Stapli", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2026-07-28", "2025-11-25", "2025-06-18"];

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function metadataUrl(request: Request) {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp`;
}

function unauthorized(request: Request, description = "A valid Stapli OAuth access token is required.") {
  return NextResponse.json(
    { error: "unauthorized", error_description: description },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl(request)}"`,
      },
    },
  );
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

async function handleRpc(request: RpcRequest, auth: NonNullable<Awaited<ReturnType<typeof authenticateMcpToken>>>) {
  if (request.jsonrpc !== "2.0" || !request.method) return rpcError(request.id, -32600, "Invalid Request");

  if (request.method === "initialize") {
    const requested = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : "";
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
    return rpcResult(request.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: "Stapli is the household's durable shopping data layer. Read lists, known items, purchases and standing shopping rules before making assumptions. Use write tools only when the user asks to change Stapli. Flexible planning and reasoning should be done by the AI, then persisted through these tools when appropriate.",
    });
  }

  if (request.method === "ping") return rpcResult(request.id, {});
  if (request.method === "notifications/initialized" || request.method.startsWith("notifications/")) return null;

  if (request.method === "tools/list") {
    return rpcResult(request.id, { tools: TOOL_DEFINITIONS });
  }

  if (request.method === "tools/call") {
    const name = typeof request.params?.name === "string" ? request.params.name : "";
    if (!name) return rpcError(request.id, -32602, "Tool name is required");
    const result = await callStapliTool(auth, name, request.params?.arguments);
    return rpcResult(request.id, result);
  }

  return rpcError(request.id, -32601, `Method not found: ${request.method}`);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return unauthorized(request);
  const token = authHeader.slice(7).trim();
  if (!token) return unauthorized(request);

  const auth = await authenticateMcpToken(token);
  if (!auth) return unauthorized(request, "The Stapli access token is invalid or expired.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const requests = Array.isArray(body) ? body as RpcRequest[] : [body as RpcRequest];
  const responses = (await Promise.all(requests.map((message) => handleRpc(message, auth)))).filter((response) => response !== null);

  if (!responses.length) return new Response(null, { status: 202 });
  const payload = Array.isArray(body) ? responses : responses[0];
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": request.headers.get("mcp-protocol-version") ?? SUPPORTED_PROTOCOLS[0],
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed", message: "Stapli MCP uses stateless Streamable HTTP POST requests." }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}

export async function DELETE() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
