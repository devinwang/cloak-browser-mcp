#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "./config.js";
import { createServer } from "./server.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`cloak-browser-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }

  if (cfg.selfTest) {
    const { collectTools } = await import("./tools/index.js");
    const tools = collectTools(cfg);
    process.stdout.write(`cloak-browser-mcp self-test: ${tools.length} tools registered\n`);
    for (const t of tools) process.stdout.write(`  ${t.name}${t.capability ? ` [${t.capability}]` : ""}\n`);
    process.exit(0);
  }

  const { server, session } = createServer(cfg);
  // McpServer exposes the underlying Server for transport.connect.
  const underlying = (server as unknown as { server: Server }).server;
  const transport = new StdioServerTransport();

  const shutdown = async (code: number): Promise<never> => {
    await session.shutdown().catch(() => undefined);
    await transport.close().catch(() => undefined);
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(130));
  process.on("SIGTERM", () => void shutdown(143));
  process.on("uncaughtException", (err) => {
    process.stderr.write(`cloak-browser-mcp uncaught: ${err.stack ?? err.message}\n`);
    void shutdown(1);
  });

  await underlying.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`cloak-browser-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
