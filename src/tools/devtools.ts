import type { BrowserContext, Page } from "playwright-core";
import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { errorOutput, textOutput } from "./types.js";

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

const showActionsSchema = z.object({
  duration: z.number().optional().describe("How long each action annotation stays on screen, in milliseconds. Defaults to 500."),
  position: z
    .enum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])
    .optional()
    .describe("Where to place the action title relative to the page. Defaults to top-right."),
  cursor: z
    .enum(["none", "pointer"])
    .optional()
    .describe('Cursor decoration for pointer actions. "pointer" (default) animates a mouse pointer between action points; "none" disables it.'),
  style: z
    .object({
      point: z.string().optional().describe('CSS declarations for the marker on the action point, e.g. "width: 20px; height: 20px; border-radius: 50%; background: red". Not shown when omitted.'),
      highlight: z.string().optional().describe('CSS declarations for the box over the target element, e.g. "outline: 2px solid #333". Not shown when omitted.'),
      title: z.string().optional().describe('CSS declarations for the action title, e.g. "font-size: 16px".'),
    })
    .strict()
    .optional()
    .describe("Styles of the action decorations."),
});

// BrowserContext._startRecording / _stopRecording are not in Playwright's public typings; Playwright's own MCP
// server uses them the same way, so call them only when present.
type RecordingContext = BrowserContext & {
  _startRecording?: (
    options: { language: string },
    callbacks: {
      actionAdded: (page: Page, action: unknown, code: string) => void;
      actionUpdated: (page: Page, action: unknown, code: string) => void;
      signalAdded: (page: Page, signal: unknown, code: string) => void;
    },
  ) => Promise<void>;
  _stopRecording?: () => Promise<void>;
};
const recordingState = { actions: undefined as string[] | undefined };

function dedent(code: string): string {
  const lines = code.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join("\n").trim();
}

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
    name: "browser_video_show_actions",
    description:
      "Annotate subsequent actions performed on the page with a callout that names the action and, when styled, marks the action point and highlights the target element. Useful while video recording or screencasting.",
    capability: "devtools",
    inputSchema: showActionsSchema,
    handler: async (session, raw) => {
      const args = showActionsSchema.parse(raw);
      const options = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      await session.activePage.screencast.showActions(options);
      return textOutput("Action annotations enabled.");
    },
  },
  {
    name: "browser_video_hide_actions",
    description: "Stop annotating actions performed on the page.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async (session) => {
      await session.activePage.screencast.hideActions();
      return textOutput("Action annotations disabled.");
    },
  },
  {
    name: "browser_start_recording",
    description:
      "Start recording actions that the user performs in the browser as Playwright code. Use it when the user wants to demonstrate a flow manually. Call browser_stop_recording when the user says they are done to retrieve the recorded actions.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async (session) => {
      await session.ensureBrowser();
      const ctx = session.rawContext as RecordingContext | undefined;
      if (!ctx) return errorOutput("No browser context is available.");
      if (recordingState.actions) return errorOutput("Recording is already in progress.");
      if (typeof ctx._startRecording !== "function" || typeof ctx._stopRecording !== "function") {
        return errorOutput("Recording is not supported by the installed playwright-core; upgrade it.");
      }
      const actions: string[] = [];
      await ctx._startRecording(
        { language: "playwright-test" },
        {
          actionAdded: (_page, _action, code) => {
            actions.push(code);
          },
          actionUpdated: (_page, _action, code) => {
            if (actions.length) actions[actions.length - 1] = code;
            else actions.push(code);
          },
          signalAdded: (_page, _signal, code) => {
            if (actions.length && code) actions[actions.length - 1] = code;
          },
        },
      );
      recordingState.actions = actions;
      await session.activePage.bringToFront();
      return textOutput("Recording started. Call browser_stop_recording to retrieve the recorded actions.");
    },
  },
  {
    name: "browser_stop_recording",
    description: "Stop the recording started with browser_start_recording and return the recorded actions as Playwright code.",
    capability: "devtools",
    inputSchema: z.object({}),
    handler: async (session) => {
      const recorded = recordingState.actions;
      if (!recorded) return errorOutput("No recording in progress, use browser_start_recording to start one.");
      recordingState.actions = undefined;
      await (session.rawContext as RecordingContext | undefined)?._stopRecording?.();
      const code = recorded.filter((c) => c.trim()).map(dedent);
      if (!code.length) return textOutput("Recording stopped. No actions were recorded.");
      return textOutput(`Recording stopped. Recorded actions:\n\n\`\`\`js\n${code.join("\n")}\n\`\`\``);
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
