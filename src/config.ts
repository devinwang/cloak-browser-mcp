import { z } from "zod";

const ALL_CAPS = ["vision", "pdf", "devtools", "network", "storage", "config", "testing", "humanize"] as const;
export type Capability = (typeof ALL_CAPS)[number];

export interface ServerConfig {
  caps: Set<Capability>;
  profileDir?: string;
  headless: boolean;
  proxy?: string;
  timezone?: string;
  locale?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  geoip: boolean;
  humanize: boolean;
  fingerprintSeed?: number;
  allowedDomains: string[];
  blockedDomains: string[];
  enableUnsafeEval: boolean;
  uploadAllowDir?: string;
  downloadDir?: string;
  maxPages: number;
  selfTest: boolean;
}

const viewportSchema = z.string().regex(/^\d+x\d+$/, "viewport must be WIDTHxHEIGHT");

function takeValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return v;
}

function parseCaps(raw: string): Set<Capability> {
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.includes("all")) return new Set(ALL_CAPS);
  const set = new Set<Capability>();
  for (const item of items) {
    if ((ALL_CAPS as readonly string[]).includes(item)) {
      set.add(item as Capability);
    } else {
      throw new Error(`Unknown capability: ${item}. Valid: ${ALL_CAPS.join(", ")}, all`);
    }
  }
  return set;
}

export function parseArgs(argv: string[]): ServerConfig {
  const cfg: ServerConfig = {
    caps: new Set(),
    headless: true,
    geoip: false,
    humanize: false,
    allowedDomains: [],
    blockedDomains: [],
    enableUnsafeEval: false,
    maxPages: 20,
    selfTest: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--caps":
        cfg.caps = parseCaps(takeValue(argv, i, a));
        i++;
        break;
      case "--profile-dir":
        cfg.profileDir = takeValue(argv, i, a);
        i++;
        break;
      case "--headless":
        cfg.headless = true;
        break;
      case "--headed":
        cfg.headless = false;
        break;
      case "--proxy":
        cfg.proxy = takeValue(argv, i, a);
        i++;
        break;
      case "--timezone":
        cfg.timezone = takeValue(argv, i, a);
        i++;
        break;
      case "--locale":
        cfg.locale = takeValue(argv, i, a);
        i++;
        break;
      case "--user-agent":
        cfg.userAgent = takeValue(argv, i, a);
        i++;
        break;
      case "--viewport": {
        const v = takeValue(argv, i, a);
        viewportSchema.parse(v);
        const [w, h] = v.split("x").map(Number);
        cfg.viewport = { width: w, height: h };
        i++;
        break;
      }
      case "--geoip":
        cfg.geoip = true;
        break;
      case "--humanize":
        cfg.humanize = true;
        cfg.caps.add("humanize");
        break;
      case "--fingerprint-seed":
        cfg.fingerprintSeed = Number.parseInt(takeValue(argv, i, a), 10);
        i++;
        break;
      case "--allowed-domains":
        cfg.allowedDomains = takeValue(argv, i, a).split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--blocked-domains":
        cfg.blockedDomains = takeValue(argv, i, a).split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--enable-unsafe-eval":
        cfg.enableUnsafeEval = true;
        break;
      case "--upload-allow-dir":
        cfg.uploadAllowDir = takeValue(argv, i, a);
        i++;
        break;
      case "--download-dir":
        cfg.downloadDir = takeValue(argv, i, a);
        i++;
        break;
      case "--max-pages":
        cfg.maxPages = Number.parseInt(takeValue(argv, i, a), 10);
        i++;
        break;
      case "--self-test":
        cfg.selfTest = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        // Version printed by callers; just signal.
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        break;
    }
  }
  return cfg;
}

function printHelp(): void {
  const help = `cloak-browser-mcp — MCP server backed by CloakBrowser stealth Chromium

Usage: cloak-browser-mcp [flags]

Flags:
  --caps <list>              Capability list: all,vision,pdf,devtools,network,storage,config,testing,humanize
  --profile-dir <path>       Persistent user-data dir (omit for ephemeral)
  --headless | --headed      Default headless
  --proxy <url>              http(s)/socks5 URL with optional inline auth
  --timezone <tz>            IANA timezone (e.g. America/New_York)
  --locale <bcp47>           BCP-47 locale (e.g. en-US)
  --user-agent <ua>          UA override
  --viewport <WxH>           e.g. 1920x1080
  --geoip                    Auto geolocation/timezone/locale from proxy exit IP
  --humanize                 Enable humanized mouse/keyboard inputs
  --fingerprint-seed <int>   Deterministic canvas/WebGL seed
  --allowed-domains <csv>    browser_navigate allow-list
  --blocked-domains <csv>    browser_navigate block-list
  --enable-unsafe-eval       Required (in addition to --caps config) to expose browser_run_code_unsafe
  --upload-allow-dir <path>  Restrict browser_file_upload paths to this subtree
  --download-dir <path>      Constrain downloads to this directory
  --max-pages <n>            Max concurrent tabs (default 20)
  --self-test                Run an internal smoke check and exit
  -h, --help                 Print this help
`;
  process.stdout.write(help);
}

export function isAllowedNavigation(url: string, cfg: ServerConfig): { ok: true } | { ok: false; reason: string } {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  const matches = (patterns: string[]): boolean =>
    patterns.some((p) => {
      if (p === host) return true;
      if (p.startsWith("*.") && host.endsWith(p.slice(1))) return true;
      return false;
    });
  if (cfg.blockedDomains.length && matches(cfg.blockedDomains)) {
    return { ok: false, reason: `host ${host} is in --blocked-domains` };
  }
  if (cfg.allowedDomains.length && !matches(cfg.allowedDomains)) {
    return { ok: false, reason: `host ${host} not in --allowed-domains` };
  }
  return { ok: true };
}
