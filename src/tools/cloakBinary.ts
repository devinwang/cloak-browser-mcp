import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

export const cloakBinaryTools: ToolHandler[] = [
  {
    name: "cloak_binary_info",
    description: "Report installed CloakBrowser binary version, platform, and cache path.",
    inputSchema: z.object({}),
    handler: async () => {
      const cb = (await import("cloakbrowser")) as unknown as { binaryInfo?: () => Record<string, unknown> };
      if (typeof cb.binaryInfo !== "function") return textOutput("binaryInfo() not exported by installed cloakbrowser version.");
      const info = cb.binaryInfo();
      return textOutput(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "cloak_binary_update",
    description: "Force CloakBrowser to check for and download the latest Chromium build. May take several minutes (~200MB).",
    inputSchema: z.object({}),
    handler: async () => {
      const cb = (await import("cloakbrowser")) as unknown as {
        ensureBinary?: () => Promise<unknown>;
        clearCache?: () => Promise<unknown>;
      };
      if (typeof cb.clearCache === "function") await cb.clearCache();
      if (typeof cb.ensureBinary === "function") await cb.ensureBinary();
      return textOutput("CloakBrowser binary refreshed.");
    },
  },
];
