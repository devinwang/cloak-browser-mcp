import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { imageOutput, textOutput } from "./types.js";

const snapshotSchema = z.object({});

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
      const wrapped = `(${fnSrc})`;
      let result: unknown;
      if (args.target) {
        const loc = session.refs.locator(page, args.target);
        result = await loc.evaluate(new Function("__el", `return (${fnSrc})(__el)`) as Parameters<typeof loc.evaluate>[0]);
      } else {
        result = await page.evaluate(wrapped);
      }
      return textOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    },
  },
];
