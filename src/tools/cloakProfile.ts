import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

function profilesRoot(): string {
  return process.env.CLOAKBROWSER_PROFILES_DIR ?? join(homedir(), ".cloak-browser-mcp", "profiles");
}

const createSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Profile name must be alphanumeric / underscore / hyphen."),
});

const deleteSchema = z.object({
  name: z.string(),
  confirm: z.literal(true).describe("Required — confirms you intend to wipe this profile."),
});

const listSchema = z.object({});

export const cloakProfileTools: ToolHandler[] = [
  {
    name: "cloak_persistent_profile_create",
    description: "Create a fresh persistent profile directory under ~/.cloak-browser-mcp/profiles/<name>. Use as --profile-dir on next launch.",
    inputSchema: createSchema,
    handler: async (_session, raw) => {
      const args = createSchema.parse(raw);
      const dir = join(profilesRoot(), args.name);
      await mkdir(dir, { recursive: true });
      return textOutput(`Created profile: ${dir}\nUse: --profile-dir ${dir}`);
    },
  },
  {
    name: "cloak_persistent_profile_list",
    description: "List all profile directories under ~/.cloak-browser-mcp/profiles/.",
    inputSchema: listSchema,
    handler: async () => {
      const root = profilesRoot();
      try {
        const entries = await readdir(root, { withFileTypes: true });
        const profiles = await Promise.all(
          entries
            .filter((e) => e.isDirectory())
            .map(async (e) => {
              const p = join(root, e.name);
              const st = await stat(p).catch(() => null);
              return { name: e.name, path: p, sizeKb: st ? Math.round(st.size / 1024) : 0 };
            }),
        );
        if (profiles.length === 0) return textOutput(`(no profiles under ${root})`);
        return textOutput(profiles.map((p) => `${p.name}\t${p.path}`).join("\n"));
      } catch {
        return textOutput(`(no profiles dir yet — ${root})`);
      }
    },
  },
  {
    name: "cloak_persistent_profile_delete",
    description: "Delete a profile directory. Requires confirm=true. The active session is unaffected.",
    inputSchema: deleteSchema,
    handler: async (_session, raw) => {
      const args = deleteSchema.parse(raw);
      const dir = join(profilesRoot(), args.name);
      await rm(dir, { recursive: true, force: true });
      return textOutput(`Wiped ${dir}`);
    },
  },
];
