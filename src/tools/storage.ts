import { writeFile, readFile } from "node:fs/promises";
import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const cookieSetSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

const cookieGetSchema = z.object({ name: z.string() });
const cookieListSchema = z.object({ domain: z.string().optional(), path: z.string().optional() });
const cookieDeleteSchema = z.object({ name: z.string(), domain: z.string().optional(), path: z.string().optional() });

const kvSchema = z.object({ key: z.string(), value: z.string() });
const keySchema = z.object({ key: z.string() });

const stateFileSchema = z.object({ filename: z.string().describe("Absolute path to read/write the storage_state JSON.") });
const stateExportSchema = z.object({ filename: z.string().optional() });

async function storageKvOp(
  session: Parameters<ToolHandler["handler"]>[0],
  storage: "localStorage" | "sessionStorage",
  op: "set" | "get" | "list" | "delete" | "clear",
  args: { key?: string; value?: string },
): Promise<string> {
  const page = session.activePage;
  return page.evaluate(
    ({ storage, op, args }) => {
      const s = (window as unknown as Record<string, Storage>)[storage];
      switch (op) {
        case "set":
          s.setItem(args.key!, args.value!);
          return `set ${args.key}`;
        case "get":
          return s.getItem(args.key!) ?? "(null)";
        case "list": {
          const out: string[] = [];
          for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k) out.push(`${k}=${JSON.stringify(s.getItem(k))}`);
          }
          return out.join("\n") || "(empty)";
        }
        case "delete":
          s.removeItem(args.key!);
          return `deleted ${args.key}`;
        case "clear":
          s.clear();
          return "cleared";
      }
    },
    { storage, op, args },
  );
}

export const storageTools: ToolHandler[] = [
  {
    name: "browser_cookie_set",
    description: "Create or update a cookie at the context level.",
    capability: "storage",
    inputSchema: cookieSetSchema,
    handler: async (session, raw) => {
      const args = cookieSetSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context yet — navigate first)");
      const url = session.activePage.url();
      await ctx.addCookies([
        {
          name: args.name,
          value: args.value,
          domain: args.domain,
          path: args.path,
          expires: args.expires,
          httpOnly: args.httpOnly,
          secure: args.secure,
          sameSite: args.sameSite,
          ...(args.domain ? {} : { url }),
        } as Parameters<NonNullable<typeof ctx>["addCookies"]>[0][number],
      ]);
      return textOutput(`Cookie ${args.name} set.`);
    },
  },
  {
    name: "browser_cookie_get",
    description: "Read a single cookie value.",
    capability: "storage",
    inputSchema: cookieGetSchema,
    handler: async (session, raw) => {
      const args = cookieGetSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      const cookies = await ctx.cookies();
      const match = cookies.find((c) => c.name === args.name);
      return textOutput(match ? JSON.stringify(match, null, 2) : "(not found)");
    },
  },
  {
    name: "browser_cookie_list",
    description: "List all cookies (optionally filtered by domain/path).",
    capability: "storage",
    inputSchema: cookieListSchema,
    handler: async (session, raw) => {
      const args = cookieListSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      let cookies = await ctx.cookies();
      if (args.domain) cookies = cookies.filter((c) => c.domain?.includes(args.domain!));
      if (args.path) cookies = cookies.filter((c) => c.path === args.path);
      return textOutput(JSON.stringify(cookies, null, 2));
    },
  },
  {
    name: "browser_cookie_delete",
    description: "Delete a single cookie.",
    capability: "storage",
    inputSchema: cookieDeleteSchema,
    handler: async (session, raw) => {
      const args = cookieDeleteSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      const all = await ctx.cookies();
      const keep = all.filter(
        (c) =>
          !(
            c.name === args.name &&
            (!args.domain || c.domain === args.domain) &&
            (!args.path || c.path === args.path)
          ),
      );
      await ctx.clearCookies();
      await ctx.addCookies(keep);
      return textOutput(`Deleted ${args.name}`);
    },
  },
  {
    name: "browser_cookie_clear",
    description: "Erase ALL cookies in the active context.",
    capability: "storage",
    inputSchema: z.object({}),
    handler: async (session) => {
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      await ctx.clearCookies();
      return textOutput("All cookies cleared.");
    },
  },
  {
    name: "browser_localstorage_set",
    description: "Set a localStorage key on the active page.",
    capability: "storage",
    inputSchema: kvSchema,
    handler: async (session, raw) => {
      const args = kvSchema.parse(raw);
      return textOutput(await storageKvOp(session, "localStorage", "set", args));
    },
  },
  {
    name: "browser_localstorage_get",
    description: "Read a localStorage value.",
    capability: "storage",
    inputSchema: keySchema,
    handler: async (session, raw) => {
      const args = keySchema.parse(raw);
      return textOutput(await storageKvOp(session, "localStorage", "get", args));
    },
  },
  {
    name: "browser_localstorage_list",
    description: "List all localStorage entries.",
    capability: "storage",
    inputSchema: z.object({}),
    handler: async (session) => textOutput(await storageKvOp(session, "localStorage", "list", {})),
  },
  {
    name: "browser_localstorage_delete",
    description: "Remove a localStorage key.",
    capability: "storage",
    inputSchema: keySchema,
    handler: async (session, raw) => {
      const args = keySchema.parse(raw);
      return textOutput(await storageKvOp(session, "localStorage", "delete", args));
    },
  },
  {
    name: "browser_localstorage_clear",
    description: "Clear localStorage on the active page.",
    capability: "storage",
    inputSchema: z.object({}),
    handler: async (session) => textOutput(await storageKvOp(session, "localStorage", "clear", {})),
  },
  {
    name: "browser_sessionstorage_set",
    description: "Set a sessionStorage key on the active page.",
    capability: "storage",
    inputSchema: kvSchema,
    handler: async (session, raw) => {
      const args = kvSchema.parse(raw);
      return textOutput(await storageKvOp(session, "sessionStorage", "set", args));
    },
  },
  {
    name: "browser_sessionstorage_get",
    description: "Read a sessionStorage value.",
    capability: "storage",
    inputSchema: keySchema,
    handler: async (session, raw) => {
      const args = keySchema.parse(raw);
      return textOutput(await storageKvOp(session, "sessionStorage", "get", args));
    },
  },
  {
    name: "browser_sessionstorage_list",
    description: "List all sessionStorage entries.",
    capability: "storage",
    inputSchema: z.object({}),
    handler: async (session) => textOutput(await storageKvOp(session, "sessionStorage", "list", {})),
  },
  {
    name: "browser_sessionstorage_delete",
    description: "Remove a sessionStorage key.",
    capability: "storage",
    inputSchema: keySchema,
    handler: async (session, raw) => {
      const args = keySchema.parse(raw);
      return textOutput(await storageKvOp(session, "sessionStorage", "delete", args));
    },
  },
  {
    name: "browser_sessionstorage_clear",
    description: "Clear sessionStorage on the active page.",
    capability: "storage",
    inputSchema: z.object({}),
    handler: async (session) => textOutput(await storageKvOp(session, "sessionStorage", "clear", {})),
  },
  {
    name: "browser_storage_state",
    description: "Export cookies + origin storage to a JSON file.",
    capability: "storage",
    inputSchema: stateExportSchema,
    handler: async (session, raw) => {
      const args = stateExportSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      const state = await ctx.storageState({ path: args.filename });
      if (!args.filename) {
        return textOutput(JSON.stringify(state, null, 2));
      }
      return textOutput(`Exported storage state to ${args.filename}`);
    },
  },
  {
    name: "browser_set_storage_state",
    description: "Import cookies + origin storage from a JSON file. Applied at context boot, so requires --profile-dir to persist beyond this session.",
    capability: "storage",
    inputSchema: stateFileSchema,
    handler: async (session, raw) => {
      const args = stateFileSchema.parse(raw);
      const ctx = session.rawContext;
      if (!ctx) return textOutput("(no context)");
      const json = JSON.parse(await readFile(args.filename, "utf8"));
      if (Array.isArray(json.cookies)) await ctx.addCookies(json.cookies);
      if (Array.isArray(json.origins)) {
        for (const o of json.origins) {
          const page = await ctx.newPage();
          await page.goto(o.origin);
          for (const item of o.localStorage ?? []) {
            await page.evaluate(({ name, value }) => localStorage.setItem(name, value), item);
          }
          await page.close();
        }
      }
      await writeFile(args.filename + ".applied", new Date().toISOString());
      return textOutput(`Applied storage state from ${args.filename}`);
    },
  },
];
