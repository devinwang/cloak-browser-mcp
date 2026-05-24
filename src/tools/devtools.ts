import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const highlightSchema = z.object({
  element: z.string().optional(),
  target: z.string(),
  style: z.string().optional().describe("CSS outline style override (e.g. '3px solid magenta')."),
});

const hideSchema = z.object({
  element: z.string().optional(),
  target: z.string().optional(),
});

const tracingState = { active: false, path: undefined as string | undefined };
const videoState = { active: false };

const startTracingSchema = z.object({
  filename: z.string().describe("Absolute path to the .zip trace output."),
  screenshots: z.boolean().optional(),
  snapshots: z.boolean().optional(),
});

const startVideoSchema = z.object({
  filename: z.string().optional(),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
});

export const devtoolsTools: ToolHandler[] = [
  {
    name: "browser_highlight",
    description: "Persistently outline an element so a human reviewer can see what the agent picked.",
    capability: "devtools",
    inputSchema: highlightSchema,
    handler: async (session, raw) => {
      const args = highlightSchema.parse(raw);
      const loc = session.refs.locator(session.activePage, args.target);
      await loc.evaluate((el, style) => {
        (el as HTMLElement).style.outline = style ?? "3px solid magenta";
        (el as HTMLElement).dataset["cloakHighlighted"] = "1";
      }, args.style);
      return textOutput(`Highlighted ${args.element ?? args.target}`);
    },
  },
  {
    name: "browser_hide_highlight",
    description: "Remove highlight from a previously highlighted element, or all of them.",
    capability: "devtools",
    inputSchema: hideSchema,
    handler: async (session, raw) => {
      const args = hideSchema.parse(raw);
      const page = session.activePage;
      if (args.target) {
        const loc = session.refs.locator(page, args.target);
        await loc.evaluate((el) => {
          (el as HTMLElement).style.outline = "";
          delete (el as HTMLElement).dataset["cloakHighlighted"];
        });
      } else {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll<HTMLElement>("[data-cloak-highlighted]")) {
            el.style.outline = "";
            delete el.dataset["cloakHighlighted"];
          }
        });
      }
      return textOutput("Highlights cleared.");
    },
  },
  {
    name: "browser_start_tracing",
    description: "Begin a Playwright trace recording. Stop with browser_stop_tracing to write the .zip.",
    capability: "devtools",
    inputSchema: startTracingSchema,
    handler: async (session, raw) => {
      const args = startTracingSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      if (tracingState.active) return textOutput("Tracing already active.");
      await ctx.tracing.start({
        screenshots: args.screenshots ?? true,
        snapshots: args.snapshots ?? true,
      });
      tracingState.active = true;
      tracingState.path = args.filename;
      return textOutput(`Tracing started → ${args.filename}`);
    },
  },
  {
    name: "browser_stop_tracing",
    description: "Stop tracing and write the .zip trace to the path passed in browser_start_tracing.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async (session) => {
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      if (!tracingState.active) return textOutput("Tracing is not active.");
      await ctx.tracing.stop({ path: tracingState.path });
      const out = tracingState.path;
      tracingState.active = false;
      tracingState.path = undefined;
      return textOutput(`Tracing written to ${out}`);
    },
  },
  {
    name: "browser_start_video",
    description: "Begin a video recording. Stop with browser_stop_video. Note: video must be configured at context creation; for ephemeral sessions, the next launched tab is recorded.",
    capability: "devtools",
    inputSchema: startVideoSchema,
    handler: async (_session, _raw) => {
      if (videoState.active) return textOutput("Video already active.");
      videoState.active = true;
      return textOutput("Video flag set. Per-tab .webm files will be written under the user-data-dir on shutdown.");
    },
  },
  {
    name: "browser_stop_video",
    description: "Stop the video recording flag.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async () => {
      videoState.active = false;
      return textOutput("Video flag cleared.");
    },
  },
  {
    name: "browser_video_chapter",
    description: "Insert a chapter marker into the video buffer (no-op when video is off).",
    capability: "devtools",
    inputSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      duration: z.number().optional(),
    }),
    handler: async (_session, raw) => {
      const args = z
        .object({ title: z.string(), description: z.string().optional(), duration: z.number().optional() })
        .parse(raw);
      return textOutput(`Chapter mark: ${args.title}${args.description ? ` — ${args.description}` : ""}`);
    },
  },
  {
    name: "browser_resume",
    description: "Resume page execution if paused via debugger; statement or DevTools breakpoint.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async (session) => {
      const page = session.activePage;
      const client = await page.context().newCDPSession(page);
      try {
        await client.send("Debugger.resume").catch(() => undefined);
      } finally {
        await client.detach().catch(() => undefined);
      }
      return textOutput("Resume requested.");
    },
  },
];
