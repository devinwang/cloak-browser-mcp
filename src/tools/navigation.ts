import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const navigateSchema = z.object({
  url: z.string().describe("Absolute URL to load. Subject to --allowed-domains / --blocked-domains."),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
  timeoutMs: z.number().optional(),
});

const tabsSchema = z.object({
  action: z.enum(["list", "new", "switch", "close"]),
  index: z.number().optional().describe("Tab index (0-based) for switch/close. Defaults to active when omitted."),
  id: z.string().optional().describe("Tab id (e.g., t2) for switch/close. Takes precedence over index."),
  url: z.string().optional().describe("Initial URL when action=new."),
});

export const navigationTools: ToolHandler[] = [
  {
    name: "browser_navigate",
    description: "Load a URL in the active tab. Returns a fresh snapshot after navigation.",
    inputSchema: navigateSchema,
    handler: async (session, raw) => {
      const args = navigateSchema.parse(raw);
      await session.ensureBrowser();
      session.checkNavigation(args.url);
      const page = session.activePage;
      session.clearConsole();
      session.clearNetwork();
      await page.goto(args.url, {
        waitUntil: args.waitUntil ?? "domcontentloaded",
        timeout: args.timeoutMs ?? 30_000,
      });
      const snap = await session.refs.snapshot(page);
      return textOutput(`Navigated to ${page.url()}\nTitle: ${await page.title()}\n\nSnapshot:\n${snap}`);
    },
  },
  {
    name: "browser_navigate_back",
    description: "Go back one entry in the active tab's history.",
    inputSchema: z.object({}),
    handler: async (session) => {
      const page = session.activePage;
      await page.goBack({ waitUntil: "domcontentloaded" });
      const snap = await session.refs.snapshot(page);
      return textOutput(`Back to ${page.url()}\n\nSnapshot:\n${snap}`);
    },
  },
  {
    name: "browser_tabs",
    description: "List, create, switch between, or close tabs.",
    inputSchema: tabsSchema,
    handler: async (session, raw) => {
      const args = tabsSchema.parse(raw);
      await session.ensureBrowser();
      switch (args.action) {
        case "list": {
          const tabs = await session.listTabs();
          return textOutput(
            tabs.length === 0
              ? "(no tabs)"
              : tabs.map((t) => `${t.active ? "*" : " "} ${t.id}  ${JSON.stringify(t.title)}  ${t.url}`).join("\n"),
          );
        }
        case "new": {
          const info = await session.newTab(args.url);
          return textOutput(`Opened ${info.id} → ${info.url}`);
        }
        case "switch": {
          const tabs = await session.listTabs();
          const target = resolveTab(tabs, args);
          session.setActive(target.id);
          return textOutput(`Active tab is now ${target.id} (${target.url})`);
        }
        case "close": {
          const tabs = await session.listTabs();
          const target = resolveTab(tabs, args, true);
          await session.closeTab(target?.id);
          return textOutput(`Closed ${target?.id ?? "(none)"}`);
        }
      }
    },
  },
];

function resolveTab(
  tabs: Array<{ id: string; url: string; title: string; active: boolean }>,
  args: { index?: number; id?: string },
  allowActiveFallback = false,
): { id: string; url: string } {
  if (args.id) {
    const t = tabs.find((x) => x.id === args.id);
    if (!t) throw new Error(`No tab with id ${args.id}`);
    return t;
  }
  if (args.index !== undefined) {
    const t = tabs[args.index];
    if (!t) throw new Error(`No tab at index ${args.index}`);
    return t;
  }
  if (allowActiveFallback) {
    const t = tabs.find((x) => x.active);
    if (t) return t;
  }
  throw new Error("Provide tab id or index.");
}
