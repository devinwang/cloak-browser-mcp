import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const humanizeSchema = z.object({
  enabled: z.boolean().optional(),
  preset: z.enum(["default", "careful"]).optional(),
  config: z
    .object({
      mistypeChance: z.number().min(0).max(1).optional(),
      typingDelayMs: z.number().optional(),
      idleBetweenActionsMs: z.number().optional(),
      idleBetweenDurationMs: z.number().optional(),
    })
    .optional(),
});

export const cloakHumanizeTools: ToolHandler[] = [
  {
    name: "cloak_humanize_set",
    description:
      "Toggle humanized mouse/keyboard inputs and tune behavior. Takes effect on subsequent click/type calls when --caps humanize is on.",
    capability: "humanize",
    inputSchema: humanizeSchema,
    handler: async (session, raw) => {
      const args = humanizeSchema.parse(raw);
      const cfg = session.config;
      if (args.enabled !== undefined) cfg.humanize = args.enabled;
      // Persist a minimal humanize config on the session for downstream tools.
      const store = (session as unknown as { _humanCfg?: Record<string, unknown> });
      const cur = store._humanCfg ?? {};
      const updated = { ...cur, preset: args.preset ?? cur["preset"] ?? "default", ...(args.config ?? {}) };
      store._humanCfg = updated;
      return textOutput(
        JSON.stringify(
          {
            humanize: cfg.humanize,
            preset: updated["preset"],
            mistypeChance: updated["mistypeChance"] ?? null,
            typingDelayMs: updated["typingDelayMs"] ?? null,
            idleBetweenActionsMs: updated["idleBetweenActionsMs"] ?? null,
            idleBetweenDurationMs: updated["idleBetweenDurationMs"] ?? null,
            note: "Some settings only take effect on next browser relaunch.",
          },
          null,
          2,
        ),
      );
    },
  },
];
