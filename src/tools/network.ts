import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const listSchema = z.object({
  filter: z.string().optional().describe("Substring filter on URL."),
  limit: z.number().optional(),
});

const requestSchema = z.object({
  index: z.number(),
  part: z.enum(["headers", "body", "all"]).optional(),
});

const routeSchema = z.object({
  pattern: z.string().describe("URL glob like https://api.example.com/**."),
  status: z.number().optional(),
  body: z.string().optional(),
  contentType: z.string().optional(),
  headers: z.record(z.string()).optional(),
  removeHeaders: z.array(z.string()).optional(),
});

const unrouteSchema = z.object({
  pattern: z.string().optional().describe("If omitted, removes ALL active routes."),
});

const offlineSchema = z.object({
  state: z.enum(["online", "offline"]),
});

export const networkTools: ToolHandler[] = [
  {
    name: "browser_network_requests",
    description: "List captured HTTP requests for the active tab since last navigation.",
    capability: "network",
    inputSchema: listSchema,
    handler: async (session, raw) => {
      const args = listSchema.parse(raw);
      const all = session.networkEvents();
      const filtered = args.filter ? all.filter((r) => r.url.includes(args.filter!)) : all;
      const limited = args.limit ? filtered.slice(-args.limit) : filtered;
      const lines = limited.map(
        (r) => `[${r.index}] ${r.method} ${r.status ?? "—"} ${r.resourceType} ${r.url}${r.failed ? ` FAILED:${r.failed}` : ""}`,
      );
      return textOutput(lines.length ? lines.join("\n") : "(no requests recorded — capability=network and navigate first)");
    },
  },
  {
    name: "browser_network_request",
    description: "Inspect a single captured request by index (from browser_network_requests).",
    capability: "network",
    inputSchema: requestSchema,
    handler: async (session, raw) => {
      const args = requestSchema.parse(raw);
      const all = session.networkEvents();
      const req = all[args.index];
      if (!req) return textOutput(`No request at index ${args.index}`);
      const part = args.part ?? "headers";
      const blocks: string[] = [`${req.method} ${req.url}`, `status=${req.status ?? "—"} type=${req.resourceType}`];
      if (part === "headers" || part === "all") {
        blocks.push("Request headers:");
        for (const [k, v] of Object.entries(req.requestHeaders)) blocks.push(`  ${k}: ${v}`);
        if (req.responseHeaders) {
          blocks.push("Response headers:");
          for (const [k, v] of Object.entries(req.responseHeaders)) blocks.push(`  ${k}: ${v}`);
        }
      }
      if (part === "body" || part === "all") {
        blocks.push("(body capture not retained — use browser_route to intercept future requests)");
      }
      return textOutput(blocks.join("\n"));
    },
  },
  {
    name: "browser_route",
    description: "Install a request mock. Matched requests are fulfilled with the given status/body/headers.",
    capability: "network",
    inputSchema: routeSchema,
    handler: async (session, raw) => {
      const args = routeSchema.parse(raw);
      session.addRoute(args);
      return textOutput(`Route installed: ${args.pattern}`);
    },
  },
  {
    name: "browser_route_list",
    description: "List active request mocks.",
    capability: "network",
    inputSchema: z.object({}),
    handler: async (session) => {
      const list = session.listRoutes();
      if (list.length === 0) return textOutput("(no routes)");
      return textOutput(list.map((r) => `${r.pattern} → status=${r.status ?? "passthrough"} type=${r.contentType ?? ""}`).join("\n"));
    },
  },
  {
    name: "browser_unroute",
    description: "Remove a route mock (or all mocks if pattern is omitted).",
    capability: "network",
    inputSchema: unrouteSchema,
    handler: async (session, raw) => {
      const args = unrouteSchema.parse(raw);
      await session.removeRoute(args.pattern);
      return textOutput(args.pattern ? `Removed route ${args.pattern}` : "Removed all routes");
    },
  },
  {
    name: "browser_network_state_set",
    description: "Toggle online/offline simulation for the active context.",
    capability: "network",
    inputSchema: offlineSchema,
    handler: async (session, raw) => {
      const args = offlineSchema.parse(raw);
      await session.setOffline(args.state);
      return textOutput(`Network: ${args.state}`);
    },
  },
];
