import { z } from "zod";
import { resolve as resolvePath } from "node:path";
import { refOrSelector } from "../util/schema.js";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const target = z.object({
  element: z.string().optional().describe("Human-readable element description for logging only."),
  target: refOrSelector,
});

const clickSchema = target.extend({
  doubleClick: z.boolean().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  modifiers: z.array(z.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"])).optional(),
});

const typeSchema = target.extend({
  text: z.string(),
  submit: z.boolean().optional().describe("Press Enter after typing."),
  slowly: z.boolean().optional().describe("Per-character delay; pairs well with --humanize."),
});

const hoverSchema = target;

const dragSchema = z.object({
  startElement: z.string().optional(),
  startTarget: refOrSelector,
  endElement: z.string().optional(),
  endTarget: refOrSelector,
});

const dropSchema = target.extend({
  paths: z.array(z.string()).optional().describe("Absolute file paths to drop."),
  data: z.record(z.string()).optional().describe("MIME → text payload for synthetic drag-drop."),
});

const selectSchema = target.extend({
  values: z.array(z.string()),
});

const pressKeySchema = z.object({
  key: z.string().describe("Playwright key string, e.g. Enter, Control+A, ArrowDown."),
});

const dialogSchema = z.object({
  accept: z.boolean(),
  promptText: z.string().optional(),
});

const fileUploadSchema = z.object({
  paths: z.array(z.string()).describe("Absolute file paths. Constrained to --upload-allow-dir if set."),
});

const fillFormSchema = z.object({
  fields: z.array(
    z.object({
      element: z.string().optional(),
      target: refOrSelector,
      value: z.string(),
      kind: z.enum(["text", "select", "checkbox", "radio"]).optional(),
    }),
  ),
});

const scrollSchema = target.extend({
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().optional().describe("Pixels (default 600)."),
});

export const interactionTools: ToolHandler[] = [
  {
    name: "browser_click",
    description: "Click an element by ref or selector.",
    inputSchema: clickSchema,
    handler: async (session, raw) => {
      const args = clickSchema.parse(raw);
      const page = session.activePage;
      const loc = session.refs.locator(page, args.target);
      const opts = {
        button: args.button ?? "left",
        modifiers: args.modifiers,
      } as const;
      if (args.doubleClick) await loc.dblclick(opts);
      else await loc.click(opts);
      return textOutput(`Clicked ${args.element ?? args.target}`);
    },
  },
  {
    name: "browser_type",
    description: "Type text into an editable field. Use --humanize for natural per-character timing.",
    inputSchema: typeSchema,
    handler: async (session, raw) => {
      const args = typeSchema.parse(raw);
      const page = session.activePage;
      const loc = session.refs.locator(page, args.target);
      if (args.slowly) {
        await loc.pressSequentially(args.text, { delay: 60 });
      } else {
        await loc.fill(args.text);
      }
      if (args.submit) await loc.press("Enter");
      return textOutput(`Typed ${JSON.stringify(args.text.slice(0, 100))} into ${args.element ?? args.target}${args.submit ? " + Enter" : ""}`);
    },
  },
  {
    name: "browser_hover",
    description: "Hover over an element.",
    inputSchema: hoverSchema,
    handler: async (session, raw) => {
      const args = hoverSchema.parse(raw);
      const loc = session.refs.locator(session.activePage, args.target);
      await loc.hover();
      return textOutput(`Hovered ${args.element ?? args.target}`);
    },
  },
  {
    name: "browser_drag",
    description: "Drag from one element to another.",
    inputSchema: dragSchema,
    handler: async (session, raw) => {
      const args = dragSchema.parse(raw);
      const page = session.activePage;
      const start = session.refs.locator(page, args.startTarget);
      const end = session.refs.locator(page, args.endTarget);
      await start.dragTo(end);
      return textOutput(`Dragged ${args.startElement ?? args.startTarget} → ${args.endElement ?? args.endTarget}`);
    },
  },
  {
    name: "browser_drop",
    description: "Drop files or data onto an element.",
    inputSchema: dropSchema,
    handler: async (session, raw) => {
      const args = dropSchema.parse(raw);
      const page = session.activePage;
      const loc = session.refs.locator(page, args.target);
      const cfg = session.config;
      if (args.paths?.length) {
        const safe = args.paths.map((p) => guardPath(p, cfg.uploadAllowDir));
        await loc.setInputFiles(safe);
      } else if (args.data) {
        const dt = await page.evaluateHandle((entries) => {
          const dataTransfer = new DataTransfer();
          for (const [type, text] of entries) {
            dataTransfer.setData(type, text);
          }
          return dataTransfer;
        }, Object.entries(args.data));
        await loc.dispatchEvent("drop", { dataTransfer: dt });
      }
      return textOutput(`Dropped onto ${args.element ?? args.target}`);
    },
  },
  {
    name: "browser_select_option",
    description: "Select one or more options in a <select> dropdown.",
    inputSchema: selectSchema,
    handler: async (session, raw) => {
      const args = selectSchema.parse(raw);
      const loc = session.refs.locator(session.activePage, args.target);
      await loc.selectOption(args.values);
      return textOutput(`Selected ${args.values.join(", ")} in ${args.element ?? args.target}`);
    },
  },
  {
    name: "browser_press_key",
    description: "Send a single key or key combination at page level.",
    inputSchema: pressKeySchema,
    handler: async (session, raw) => {
      const args = pressKeySchema.parse(raw);
      await session.activePage.keyboard.press(args.key);
      return textOutput(`Pressed ${args.key}`);
    },
  },
  {
    name: "browser_handle_dialog",
    description: "Respond to the next dialog (alert/confirm/prompt/beforeunload).",
    inputSchema: dialogSchema,
    handler: async (session, raw) => {
      const args = dialogSchema.parse(raw);
      const d = session.consumeDialog();
      if (!d) return textOutput("No pending dialog.");
      if (args.accept) await d.dialog.accept(args.promptText);
      else await d.dialog.dismiss();
      return textOutput(`${args.accept ? "Accepted" : "Dismissed"} dialog: ${d.dialog.type()} — ${d.dialog.message().slice(0, 200)}`);
    },
  },
  {
    name: "browser_file_upload",
    description: "Upload files to the active file chooser. Paths must be inside --upload-allow-dir if set.",
    inputSchema: fileUploadSchema,
    handler: async (session, raw) => {
      const args = fileUploadSchema.parse(raw);
      const cfg = session.config;
      const safe = args.paths.map((p) => guardPath(p, cfg.uploadAllowDir));
      const fileChooser = await session.activePage.waitForEvent("filechooser", { timeout: 5000 });
      await fileChooser.setFiles(safe);
      return textOutput(`Uploaded ${safe.length} file(s).`);
    },
  },
  {
    name: "browser_fill_form",
    description: "Populate multiple form fields in one call.",
    inputSchema: fillFormSchema,
    handler: async (session, raw) => {
      const args = fillFormSchema.parse(raw);
      const page = session.activePage;
      const results: string[] = [];
      for (const f of args.fields) {
        const loc = session.refs.locator(page, f.target);
        const kind = f.kind ?? "text";
        switch (kind) {
          case "text":
            await loc.fill(f.value);
            break;
          case "select":
            await loc.selectOption(f.value);
            break;
          case "checkbox":
            if (f.value === "true") await loc.check();
            else await loc.uncheck();
            break;
          case "radio":
            await loc.check();
            break;
        }
        results.push(`${f.element ?? f.target}=${kind}(${JSON.stringify(f.value)})`);
      }
      return textOutput(`Filled:\n${results.join("\n")}`);
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or an element by a pixel amount.",
    inputSchema: scrollSchema,
    handler: async (session, raw) => {
      const args = scrollSchema.parse(raw);
      const page = session.activePage;
      const amount = args.amount ?? 600;
      const [dx, dy] = (() => {
        switch (args.direction ?? "down") {
          case "up":
            return [0, -amount];
          case "down":
            return [0, amount];
          case "left":
            return [-amount, 0];
          case "right":
            return [amount, 0];
        }
      })();
      if (args.target) {
        const loc = session.refs.locator(page, args.target);
        await loc.evaluate((el, [x, y]) => el.scrollBy(x, y), [dx, dy]);
      } else {
        await page.mouse.wheel(dx, dy);
      }
      return textOutput(`Scrolled by ${dx},${dy}`);
    },
  },
];

function guardPath(p: string, allowDir?: string): string {
  const abs = resolvePath(p);
  if (allowDir) {
    const root = resolvePath(allowDir);
    if (!abs.startsWith(root + "/") && abs !== root) {
      throw new Error(`Path ${abs} is outside --upload-allow-dir (${root}).`);
    }
  }
  return abs;
}
