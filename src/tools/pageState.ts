import { z } from "zod";
import type { ToolHandler } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import { errorOutput, imageOutput, textOutput } from "./types.js";

const snapshotSchema = z.object({});

const emulateMediaSchema = z.object({
  colorScheme: z.enum(["light", "dark"]).nullable().optional().describe("Emulates the prefers-color-scheme media feature."),
  reducedMotion: z
    .enum(["reduce", "no-preference"])
    .nullable()
    .optional()
    .describe("Emulates the prefers-reduced-motion media feature."),
  forcedColors: z.enum(["active", "none"]).nullable().optional().describe("Emulates the forced-colors media feature."),
  contrast: z.enum(["more", "no-preference"]).nullable().optional().describe("Emulates the prefers-contrast media feature."),
  media: z.enum(["screen", "print"]).nullable().optional().describe("Changes the CSS media type of the page."),
});

const findSchema = z.object({
  text: z
    .string()
    .optional()
    .describe("Plain text to search for in the page snapshot (case-insensitive substring match). Provide either text or regex, not both."),
  regex: z
    .string()
    .optional()
    .describe(
      'Regular expression to search for in the page snapshot. Case-sensitive by default; wrap the pattern in slashes to add flags, e.g. "/error/i". Provide either text or regex, not both.',
    ),
  filename: z.string().optional().describe("Save results to this file instead of returning them in the response."),
});

const MAX_FIND_MATCHES = 20;
const FIND_CONTEXT_LINES = 2;

function buildLineMatcher(text: string | undefined, regex: string | undefined): (line: string) => boolean {
  if ((text === undefined) === (regex === undefined)) throw new Error("Provide either text or regex, not both.");
  if (text !== undefined) {
    const needle = text.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
  }
  const slashed = /^\/([\s\S]*)\/([a-z]*)$/.exec(regex as string);
  // g and y make RegExp.test stateful across lines.
  const re = slashed ? new RegExp(slashed[1] as string, (slashed[2] as string).replace(/[gy]/g, "")) : new RegExp(regex as string);
  return (line) => re.test(line);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Ancestor lines of lines[index], from the root down, found by indentation. */
function ancestorsOf(lines: string[], index: number): string[] {
  const path: string[] = [];
  let indent = indentOf(lines[index] as string);
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const candidate = lines[i] as string;
    if (indentOf(candidate) < indent) {
      path.unshift(candidate.trim());
      indent = indentOf(candidate);
    }
  }
  return path;
}

const screenshotSchema = z.object({
  element: z.string().optional(),
  target: z.string().optional().describe("If set, screenshot just this element (ref or selector)."),
  type: z.enum(["png", "jpeg"]).optional(),
  fullPage: z.boolean().optional(),
  quality: z.number().min(1).max(100).optional(),
  saveAs: z.string().optional().describe("If set, also write the image to this absolute path."),
});

const consoleSchema = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug", "trace", "all"]).optional(),
  limit: z.number().optional(),
});

const waitForSchema = z.object({
  timeMs: z.number().optional(),
  text: z.string().optional(),
  textGone: z.string().optional(),
  selector: z.string().optional(),
  state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
  timeoutMs: z.number().optional(),
});

const resizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

const evaluateSchema = z.object({
  function: z.string().describe("JS function source: must be an arrow or function expression. Receives the page (or element) and returns a JSON-serializable value."),
  element: z.string().optional(),
  target: z.string().optional().describe("If set, runs the function with this element as argument."),
});

export const pageStateTools: ToolHandler[] = [
  {
    name: "browser_snapshot",
    description: "Capture an accessibility-tree snapshot of the active page. Returns a structured outline with [eN] refs you can pass to interaction tools.",
    inputSchema: snapshotSchema,
    handler: async (session) => {
      const page = session.activePage;
      const snap = await session.refs.snapshot(page);
      return textOutput(`URL: ${page.url()}\nTitle: ${await page.title()}\n\n${snap || "(empty tree)"}`);
    },
  },
  {
    name: "browser_find",
    description:
      "Search the accessibility snapshot of the current page for text or a regular expression. Returns matching snapshot nodes with a few lines of context, each under its path from the root, which is cheaper than a full snapshot when you only need to locate an element and its ref.",
    inputSchema: findSchema,
    handler: async (session, raw) => {
      const args = findSchema.parse(raw);
      let matches: (line: string) => boolean;
      try {
        matches = buildLineMatcher(args.text, args.regex);
      } catch (e) {
        return errorOutput(e instanceof Error ? e.message : String(e));
      }
      const page = session.activePage;
      const lines = (await session.refs.snapshot(page)).split("\n");
      const hits: number[] = [];
      for (let i = 0; i < lines.length; i++) if (matches(lines[i] as string)) hits.push(i);

      const query = args.text !== undefined ? `text ${JSON.stringify(args.text)}` : `regex ${args.regex}`;
      if (!hits.length) return textOutput(`No matches for ${query} in the snapshot of ${page.url()}.`);

      const shown = hits.slice(0, MAX_FIND_MATCHES);
      const blocks = shown.map((hit, n) => {
        const from = Math.max(0, hit - FIND_CONTEXT_LINES);
        const to = Math.min(lines.length - 1, hit + FIND_CONTEXT_LINES);
        const context = lines.slice(from, to + 1).map((l, k) => `${from + k === hit ? "> " : "  "}${l}`);
        const where = ancestorsOf(lines, hit).join(" > ");
        return [`${n + 1}. ${where || "(root)"}`, ...context].join("\n");
      });
      const more = hits.length > shown.length ? `\n\n(${hits.length - shown.length} more matches not shown; narrow the search.)` : "";
      const report = `Found ${hits.length} match${hits.length === 1 ? "" : "es"} for ${query} on ${page.url()}:\n\n${blocks.join("\n\n")}${more}`;
      if (args.filename) {
        const target = path.resolve(args.filename);
        fs.writeFileSync(target, report);
        return textOutput(`Saved ${hits.length} match${hits.length === 1 ? "" : "es"} to ${target}`);
      }
      return textOutput(report);
    },
  },
  {
    name: "browser_emulate_media",
    description:
      "Emulate CSS media features for the page, for example switch between the light and dark color scheme. Omitted parameters are left unchanged; null clears an override.",
    inputSchema: emulateMediaSchema,
    handler: async (session, raw) => {
      const args = emulateMediaSchema.parse(raw);
      const options = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      if (!Object.keys(options).length) return textOutput("No media features given; nothing changed.");
      await session.activePage.emulateMedia(options);
      return textOutput(`Emulated media: ${JSON.stringify(options)}`);
    },
  },
  {
    name: "browser_take_screenshot",
    description: "Capture a screenshot of the page or a specific element.",
    inputSchema: screenshotSchema,
    handler: async (session, raw) => {
      const args = screenshotSchema.parse(raw);
      const page = session.activePage;
      const buf = args.target
        ? await session.refs.locator(page, args.target).screenshot({
            type: args.type ?? "png",
            ...(args.quality ? { quality: args.quality } : {}),
            ...(args.saveAs ? { path: args.saveAs } : {}),
          })
        : await page.screenshot({
            type: args.type ?? "png",
            fullPage: args.fullPage ?? false,
            ...(args.quality ? { quality: args.quality } : {}),
            ...(args.saveAs ? { path: args.saveAs } : {}),
          });
      const mimeType = args.type === "jpeg" ? "image/jpeg" : "image/png";
      const caption = args.saveAs ? `Saved to ${args.saveAs}` : undefined;
      return imageOutput(buf.toString("base64"), mimeType, caption);
    },
  },
  {
    name: "browser_console_messages",
    description: "Retrieve buffered console/pageerror output for the active tab.",
    inputSchema: consoleSchema,
    handler: async (session, raw) => {
      const args = consoleSchema.parse(raw);
      const events = session.consoleEvents();
      const level = args.level ?? "all";
      const filtered = level === "all" ? events : events.filter((e) => e.level === level);
      const limited = args.limit ? filtered.slice(-args.limit) : filtered;
      const lines = limited.map((e) => `[${new Date(e.timestamp).toISOString()}] ${e.level.toUpperCase()} ${e.type} ${e.text}`);
      return textOutput(lines.length ? lines.join("\n") : "(no console output)");
    },
  },
  {
    name: "browser_wait_for",
    description: "Wait for time, text appearance/disappearance, or selector state.",
    inputSchema: waitForSchema,
    handler: async (session, raw) => {
      const args = waitForSchema.parse(raw);
      const page = session.activePage;
      const timeout = args.timeoutMs ?? 30_000;
      if (args.timeMs !== undefined) {
        await page.waitForTimeout(args.timeMs);
        return textOutput(`Waited ${args.timeMs}ms`);
      }
      if (args.text) {
        await page.getByText(args.text).first().waitFor({ state: "visible", timeout });
        return textOutput(`Text appeared: ${JSON.stringify(args.text)}`);
      }
      if (args.textGone) {
        await page.getByText(args.textGone).first().waitFor({ state: "hidden", timeout });
        return textOutput(`Text disappeared: ${JSON.stringify(args.textGone)}`);
      }
      if (args.selector) {
        await page.locator(args.selector).waitFor({ state: args.state ?? "visible", timeout });
        return textOutput(`Selector ${args.selector} reached ${args.state ?? "visible"}`);
      }
      throw new Error("Provide timeMs, text, textGone, or selector.");
    },
  },
  {
    name: "browser_resize",
    description: "Resize the viewport.",
    inputSchema: resizeSchema,
    handler: async (session, raw) => {
      const args = resizeSchema.parse(raw);
      await session.activePage.setViewportSize({ width: args.width, height: args.height });
      return textOutput(`Viewport set to ${args.width}x${args.height}`);
    },
  },
  {
    name: "browser_evaluate",
    description: "Run a JavaScript function inside the page. Function source must be an arrow or function expression.",
    inputSchema: evaluateSchema,
    handler: async (session, raw) => {
      const args = evaluateSchema.parse(raw);
      const page = session.activePage;
      const fnSrc = args.function;
      let result: unknown;
      if (args.target) {
        const loc = session.refs.locator(page, args.target);
        result = await loc.evaluate(new Function("__el", `return (${fnSrc})(__el)`) as Parameters<typeof loc.evaluate>[0]);
      } else {
        // Must invoke the function. page.evaluate() given a string evaluates it
        // as an expression, so `(fn)` yields the function object itself, which is
        // not serializable and comes back as undefined.
        result = await page.evaluate(`(${fnSrc})()`);
      }
      if (result === undefined) return textOutput("undefined");
      return textOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "undefined");
    },
  },
];
