import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const elementSchema = z.object({
  role: z.string(),
  accessibleName: z.string(),
});

const textVisibleSchema = z.object({ text: z.string() });

const listSchema = z.object({
  element: z.string(),
  target: z.string(),
  items: z.array(z.string()),
});

const valueSchema = z.object({
  type: z.enum(["text", "value", "checked", "selected"]),
  element: z.string().optional(),
  target: z.string(),
  value: z.string(),
});

const locatorSchema = z.object({
  element: z.string().optional(),
  target: z.string(),
});

export const testingTools: ToolHandler[] = [
  {
    name: "browser_verify_element_visible",
    description: "Assert that an element matching role+accessible name is visible.",
    capability: "testing",
    inputSchema: elementSchema,
    handler: async (session, raw) => {
      const args = elementSchema.parse(raw);
      const page = session.activePage;
      const loc = page.getByRole(args.role as Parameters<typeof page.getByRole>[0], { name: args.accessibleName });
      const ok = (await loc.count()) > 0 && (await loc.first().isVisible());
      return textOutput(ok ? "OK" : `FAIL: ${args.role} ${JSON.stringify(args.accessibleName)} not visible`);
    },
  },
  {
    name: "browser_verify_text_visible",
    description: "Assert that text is visible on the page.",
    capability: "testing",
    inputSchema: textVisibleSchema,
    handler: async (session, raw) => {
      const args = textVisibleSchema.parse(raw);
      const ok = await session.activePage.getByText(args.text).first().isVisible().catch(() => false);
      return textOutput(ok ? "OK" : `FAIL: text ${JSON.stringify(args.text)} not visible`);
    },
  },
  {
    name: "browser_verify_list_visible",
    description: "Assert that a list element exists and contains each item.",
    capability: "testing",
    inputSchema: listSchema,
    handler: async (session, raw) => {
      const args = listSchema.parse(raw);
      const page = session.activePage;
      const list = session.refs.locator(page, args.target);
      if ((await list.count()) === 0) return textOutput(`FAIL: list ${args.element} not found`);
      const text = (await list.innerText()) ?? "";
      const missing = args.items.filter((it) => !text.includes(it));
      return textOutput(missing.length === 0 ? "OK" : `FAIL: missing items: ${missing.join(", ")}`);
    },
  },
  {
    name: "browser_verify_value",
    description: "Assert an input value or computed state.",
    capability: "testing",
    inputSchema: valueSchema,
    handler: async (session, raw) => {
      const args = valueSchema.parse(raw);
      const loc = session.refs.locator(session.activePage, args.target);
      let actual: string;
      switch (args.type) {
        case "text":
          actual = (await loc.textContent()) ?? "";
          break;
        case "value":
          actual = await loc.inputValue();
          break;
        case "checked":
          actual = String(await loc.isChecked());
          break;
        case "selected": {
          const selected = await loc.evaluate((el) => (el as HTMLOptionElement).selected ?? false);
          actual = String(selected);
          break;
        }
      }
      return textOutput(actual === args.value ? "OK" : `FAIL: expected ${JSON.stringify(args.value)}, got ${JSON.stringify(actual)}`);
    },
  },
  {
    name: "browser_generate_locator",
    description: "Generate Playwright-style locator code for an element by ref. Useful for codegen.",
    capability: "testing",
    inputSchema: locatorSchema,
    handler: async (session, raw) => {
      const args = locatorSchema.parse(raw);
      if (!/^e\d+$/.test(args.target)) return textOutput(args.target);
      const entry = session.refs.resolve(args.target);
      const code = `page.getByRole(${JSON.stringify(entry.role)}, { name: ${JSON.stringify(entry.name)} })${entry.nthSameRoleName > 0 ? `.nth(${entry.nthSameRoleName})` : ""}`;
      return textOutput(code);
    },
  },
];
