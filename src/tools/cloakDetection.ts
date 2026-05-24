import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const detectionSchema = z.object({
  suite: z
    .enum(["creepjs", "fingerprintjs", "browserscan", "sannysoft", "cloudflare-turnstile"])
    .optional()
    .describe("Which probe to load. Default = sannysoft (free, no captchas)."),
  customUrl: z.string().optional().describe("Override probe URL."),
});

const stealthAuditSchema = z.object({});

const requestSignalSchema = z.object({
  url: z.string().describe("Target URL whose connection signals (TLS, headers) we capture."),
});

const SUITE_URLS: Record<string, string> = {
  creepjs: "https://abrahamjuliot.github.io/creepjs/",
  fingerprintjs: "https://fingerprintjs.github.io/fingerprintjs/",
  browserscan: "https://www.browserscan.net/bot-detection",
  sannysoft: "https://bot.sannysoft.com/",
  "cloudflare-turnstile": "https://nopecha.com/demo/cloudflare",
};

export const cloakDetectionTools: ToolHandler[] = [
  {
    name: "cloak_detection_test",
    description: "Load a well-known bot-detection probe page and dump its key result fields.",
    inputSchema: detectionSchema,
    handler: async (session, raw) => {
      const args = detectionSchema.parse(raw);
      const url = args.customUrl ?? SUITE_URLS[args.suite ?? "sannysoft"];
      await session.ensureBrowser();
      const page = session.activePage;
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      // Give probes a moment to compute.
      await page.waitForTimeout(3_000);
      const text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
      return textOutput(`PROBE: ${url}\n\n${text}`);
    },
  },
  {
    name: "cloak_stealth_audit",
    description:
      "Programmatic stealth audit. Reports navigator.webdriver, plugin count, WebGL vendor/renderer, languages, user agent, hardwareConcurrency, deviceMemory, permissions, chrome.runtime presence, and a canvas fingerprint hash.",
    inputSchema: stealthAuditSchema,
    handler: async (session) => {
      const page = session.activePage;
      const report = await page.evaluate(async () => {
        const gl = document.createElement("canvas").getContext("webgl");
        const dbg = gl ? gl.getExtension("WEBGL_debug_renderer_info") : null;
        const vendor = gl && dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
        const renderer = gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
        const canvasHash = await (async () => {
          const c = document.createElement("canvas");
          c.width = 200;
          c.height = 60;
          const ctx = c.getContext("2d");
          if (!ctx) return null;
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = "#f60";
          ctx.fillRect(0, 0, 200, 60);
          ctx.fillStyle = "#069";
          ctx.font = "20px Arial";
          ctx.fillText("CloakStealthAudit", 10, 40);
          const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c.toDataURL()));
          return Array.from(new Uint8Array(buf))
            .slice(0, 8)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        })();
        let permsNotificationState: string | null = null;
        try {
          const perm = await navigator.permissions.query({ name: "notifications" as PermissionName });
          permsNotificationState = perm.state;
        } catch {
          /* ignore */
        }
        return {
          webdriver: navigator.webdriver,
          pluginCount: navigator.plugins.length,
          languages: [...navigator.languages],
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
          platform: navigator.platform,
          webglVendor: vendor,
          webglRenderer: renderer,
          permsNotificationState,
          chromeRuntime: typeof (window as unknown as { chrome?: { runtime?: unknown } }).chrome?.runtime === "object",
          canvasHash,
          cdpSignals: {
            // common JS-layer CDP signals — these should be absent in stealth builds.
            cdcWindow: Object.keys(window).some((k) => k.startsWith("$cdc_")),
            cdcDocument: Object.keys(document).some((k) => k.startsWith("$cdc_")),
            webdriverInPrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(navigator)).includes("webdriver"),
          },
        };
      });
      const verdict: string[] = [];
      if (report.webdriver) verdict.push("⚠ navigator.webdriver === true");
      if (report.cdpSignals.cdcWindow || report.cdpSignals.cdcDocument) verdict.push("⚠ $cdc_ signals present");
      if (report.cdpSignals.webdriverInPrototype) verdict.push("⚠ webdriver in Navigator.prototype");
      if (report.pluginCount === 0) verdict.push("ℹ navigator.plugins is empty (some sites flag this)");
      if (!report.webglVendor) verdict.push("ℹ WebGL UNMASKED_VENDOR not available");
      const summary = verdict.length === 0 ? "✓ no obvious automation signals" : verdict.join("\n");
      return textOutput(`${summary}\n\nFull report:\n${JSON.stringify(report, null, 2)}`);
    },
  },
  {
    name: "cloak_request_signal_inspect",
    description:
      "Open the target URL in an ephemeral background tab and capture per-request connection signals: response status, security details (TLS protocol/issuer), response headers, and request headers (Accept-Language, User-Agent, Sec-CH-UA-*).",
    inputSchema: requestSignalSchema,
    handler: async (session, raw) => {
      const args = requestSignalSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      const page = await ctx.newPage();
      try {
        const navResp = await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!navResp) return textOutput(`No response from ${args.url}`);
        const status = navResp.status();
        const responseHeaders = await navResp.allHeaders();
        const requestHeaders = await navResp.request().allHeaders();
        let tls: unknown = null;
        try {
          tls = await navResp.securityDetails();
        } catch {
          tls = null;
        }
        return textOutput(JSON.stringify({ status, tls, responseHeaders, requestHeaders }, null, 2));
      } finally {
        await page.close().catch(() => undefined);
      }
    },
  },
];
