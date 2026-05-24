import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";
import { UnsafeEvalDisabledError } from "../errors.js";

const runCodeSchema = z.object({
  code: z.string().describe("Async JS source executed in this server process. Has access to a `cloak` object: { session, page, context, browser }."),
});

export const configTools: ToolHandler[] = [
  {
    name: "browser_get_config",
    description: "Print resolved server config (capabilities, profile, proxy, fingerprint, allow/block lists).",
    capability: "config",
    inputSchema: z.object({}),
    handler: async (session) => {
      const c = session.config;
      const out = {
        caps: [...c.caps],
        profileDir: c.profileDir ?? null,
        headless: c.headless,
        proxy: c.proxy ? maskProxy(c.proxy) : null,
        timezone: c.timezone ?? null,
        locale: c.locale ?? null,
        userAgent: c.userAgent ?? null,
        viewport: c.viewport ?? null,
        geoip: c.geoip,
        humanize: c.humanize,
        fingerprintSeed: c.fingerprintSeed ?? null,
        allowedDomains: c.allowedDomains,
        blockedDomains: c.blockedDomains,
        enableUnsafeEval: c.enableUnsafeEval,
        uploadAllowDir: c.uploadAllowDir ?? null,
        downloadDir: c.downloadDir ?? null,
        maxPages: c.maxPages,
      };
      return textOutput(JSON.stringify(out, null, 2));
    },
  },
  {
    name: "browser_close",
    description: "Close the browser and discard all in-memory state. The next tool call will lazy-relaunch.",
    capability: "config",
    inputSchema: z.object({}),
    handler: async (session) => {
      await session.shutdown();
      return textOutput("Browser closed.");
    },
  },
  {
    name: "browser_run_code_unsafe",
    description:
      "Execute arbitrary JS in the server process. Only available when started with BOTH --caps config AND --enable-unsafe-eval.",
    capability: "config",
    precondition: (session) => {
      if (!session.config.enableUnsafeEval) throw new UnsafeEvalDisabledError();
    },
    inputSchema: runCodeSchema,
    handler: async (session, raw) => {
      const args = runCodeSchema.parse(raw);
      const page = session.activePage;
      const cloak = { session, page, context: session.rawContext, browser: session.rawBrowser };
      const fn = new Function("cloak", `return (async () => { ${args.code} })();`) as (c: typeof cloak) => Promise<unknown>;
      const result = await fn(cloak);
      return textOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    },
  },
];

function maskProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = u.username.slice(0, 2) + "***";
    return u.toString();
  } catch {
    return "***";
  }
}
