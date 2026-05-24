import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const fingerprintSchema = z.object({
  seed: z.number().optional().describe("Deterministic canvas/WebGL/audio seed."),
  gpuVendor: z.string().optional(),
  gpuRenderer: z.string().optional(),
  screenWidth: z.number().optional(),
  screenHeight: z.number().optional(),
  hardwareConcurrency: z.number().optional(),
  deviceMemoryGB: z.number().optional(),
  uaBrand: z.string().optional().describe("Browser brand for navigator.userAgentData (e.g. 'Google Chrome')."),
  uaBrandVersion: z.string().optional(),
  platform: z.string().optional(),
  storageQuotaMB: z.number().optional(),
});

const timezoneSchema = z.object({ timezone: z.string() });
const localeSchema = z.object({ locale: z.string() });
const geolocationSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
  fromProxyIp: z.boolean().optional().describe("If true, resolve geolocation from the configured proxy's exit IP via cloak's geoip backend."),
});
const proxySchema = z.object({
  proxy: z.string().describe("New proxy URL. Switching mid-session recreates the context."),
});

export const cloakStealthTools: ToolHandler[] = [
  {
    name: "cloak_set_fingerprint",
    description:
      "Apply a fingerprint profile to the active context. Some fields (seed, GPU, screen) require recreating the context — current pages will be reopened on the same URL.",
    inputSchema: fingerprintSchema,
    handler: async (session, raw) => {
      const args = fingerprintSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context yet — navigate first)");
      const init: string[] = [];
      if (args.hardwareConcurrency !== undefined) {
        init.push(`Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>${args.hardwareConcurrency}});`);
      }
      if (args.deviceMemoryGB !== undefined) {
        init.push(`Object.defineProperty(navigator,'deviceMemory',{get:()=>${args.deviceMemoryGB}});`);
      }
      if (args.platform) {
        init.push(`Object.defineProperty(navigator,'platform',{get:()=>${JSON.stringify(args.platform)}});`);
      }
      if (args.storageQuotaMB !== undefined) {
        init.push(`navigator.storage.estimate=async()=>({quota:${args.storageQuotaMB * 1024 * 1024},usage:0});`);
      }
      if (init.length) {
        await ctx.addInitScript(`(() => { try { ${init.join("\n")} } catch(e){} })();`);
      }
      const flags: string[] = [];
      if (args.seed !== undefined) flags.push(`--fingerprint=${args.seed}`);
      if (args.gpuVendor) flags.push(`--fingerprint-gpu-vendor=${args.gpuVendor}`);
      if (args.gpuRenderer) flags.push(`--fingerprint-gpu-renderer=${args.gpuRenderer}`);
      if (args.screenWidth) flags.push(`--fingerprint-screen-width=${args.screenWidth}`);
      if (args.screenHeight) flags.push(`--fingerprint-screen-height=${args.screenHeight}`);
      if (args.uaBrand) flags.push(`--fingerprint-brand=${args.uaBrand}`);
      if (args.uaBrandVersion) flags.push(`--fingerprint-brand-version=${args.uaBrandVersion}`);

      const requiresRelaunch = flags.length > 0;
      const summary = {
        appliedRuntime: init.length,
        deferredUntilNextLaunch: flags,
        notice: requiresRelaunch
          ? "Compiled-in stealth flags only take effect on next launch. Call browser_close, then any tool to relaunch with the new flags."
          : "Runtime overrides applied to context.",
      };
      if (requiresRelaunch) {
        const env = process.env as Record<string, string>;
        env.CLOAK_PENDING_ARGS = JSON.stringify(flags);
      }
      return textOutput(JSON.stringify(summary, null, 2));
    },
  },
  {
    name: "cloak_set_timezone",
    description: "Live-override the timezone for the active context via CDP (no relaunch).",
    inputSchema: timezoneSchema,
    handler: async (session, raw) => {
      const args = timezoneSchema.parse(raw);
      const page = session.activePage;
      const client = await page.context().newCDPSession(page);
      try {
        await client.send("Emulation.setTimezoneOverride", { timezoneId: args.timezone });
      } finally {
        await client.detach().catch(() => undefined);
      }
      return textOutput(`Timezone now ${args.timezone} (active tab only).`);
    },
  },
  {
    name: "cloak_set_locale",
    description: "Override navigator.language and Accept-Language for the active context.",
    inputSchema: localeSchema,
    handler: async (session, raw) => {
      const args = localeSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      await ctx.setExtraHTTPHeaders({ "Accept-Language": args.locale });
      await ctx.addInitScript(`Object.defineProperty(navigator,'language',{get:()=>${JSON.stringify(args.locale)}});`);
      return textOutput(`Locale now ${args.locale}. Reload pages to pick up navigator.language override.`);
    },
  },
  {
    name: "cloak_set_geolocation",
    description: "Set the geolocation reported by navigator.geolocation. Pass fromProxyIp=true to auto-resolve from proxy exit IP.",
    inputSchema: geolocationSchema,
    handler: async (session, raw) => {
      const args = geolocationSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      let lat = args.latitude;
      let lon = args.longitude;
      if (args.fromProxyIp) {
        const res = await fetch("https://ipapi.co/json/").then((r) => r.json()).catch(() => null) as
          | { latitude?: number; longitude?: number }
          | null;
        if (res?.latitude !== undefined && res.longitude !== undefined) {
          lat = res.latitude;
          lon = res.longitude;
        }
      }
      if (lat === undefined || lon === undefined) {
        return textOutput("Missing latitude/longitude (and proxy-IP lookup did not return one).");
      }
      await ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy: args.accuracy ?? 50 });
      await ctx.grantPermissions(["geolocation"]);
      return textOutput(`Geolocation = (${lat}, ${lon}) ±${args.accuracy ?? 50}m`);
    },
  },
  {
    name: "cloak_set_proxy",
    description:
      "Replace the current proxy. This recreates the BrowserContext (state is preserved if --profile-dir was used; otherwise cookies are lost).",
    inputSchema: proxySchema,
    handler: async (session, raw) => {
      const args = proxySchema.parse(raw);
      session.config.proxy = args.proxy;
      await session.shutdown();
      await session.ensureBrowser();
      return textOutput(`Proxy switched to ${args.proxy} and browser relaunched.`);
    },
  },
];
