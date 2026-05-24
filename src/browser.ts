import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Page,
  Request,
  Response,
  Route,
} from "playwright-core";
import { isAllowedNavigation, type ServerConfig } from "./config.js";
import { NavigationBlockedError, NoActivePageError } from "./errors.js";
import { RefRegistry } from "./refs.js";

// Late-bound to avoid loading cloakbrowser until first real call.
type LaunchFn = (opts: Record<string, unknown>) => Promise<Browser>;
type LaunchPersistentFn = (opts: Record<string, unknown>) => Promise<BrowserContext>;

export interface ConsoleEvent {
  type: string;
  text: string;
  timestamp: number;
  level: "log" | "info" | "warn" | "error" | "debug" | "trace";
}

export interface NetworkEvent {
  index: number;
  url: string;
  method: string;
  status?: number;
  resourceType: string;
  startedAt: number;
  endedAt?: number;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  failed?: string;
}

export interface RouteRule {
  pattern: string;
  status?: number;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  removeHeaders?: string[];
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private pages = new Map<string, Page>();
  private activeId?: string;
  private nextTabId = 1;
  private consoleByPage = new Map<string, ConsoleEvent[]>();
  private networkByPage = new Map<string, NetworkEvent[]>();
  private pendingDialog?: { dialog: Dialog; page: Page };
  private activeRoutes = new Map<string, RouteRule>();
  readonly refs = new RefRegistry();
  private launching?: Promise<void>;
  private offline = false;

  constructor(private cfg: ServerConfig) {}

  get config(): ServerConfig {
    return this.cfg;
  }

  async ensureBrowser(): Promise<void> {
    if (this.context) return;
    if (!this.launching) this.launching = this.launchInternal();
    await this.launching;
  }

  private async launchInternal(): Promise<void> {
    const cb = await import("cloakbrowser");
    const launchOpts: Record<string, unknown> = {
      headless: this.cfg.headless,
      stealthArgs: true,
      humanize: this.cfg.humanize,
      geoip: this.cfg.geoip,
    };
    if (this.cfg.proxy) launchOpts.proxy = this.cfg.proxy;
    if (this.cfg.timezone) launchOpts.timezone = this.cfg.timezone;
    if (this.cfg.locale) launchOpts.locale = this.cfg.locale;
    const args: string[] = [];
    if (this.cfg.fingerprintSeed !== undefined) args.push(`--fingerprint=${this.cfg.fingerprintSeed}`);
    if (args.length) launchOpts.args = args;

    if (this.cfg.profileDir) {
      const ctxOpts: Record<string, unknown> = { ...launchOpts, userDataDir: this.cfg.profileDir };
      if (this.cfg.userAgent) ctxOpts.userAgent = this.cfg.userAgent;
      if (this.cfg.viewport) ctxOpts.viewport = this.cfg.viewport;
      const launchPersistent = (cb as unknown as { launchPersistentContext: LaunchPersistentFn })
        .launchPersistentContext;
      this.context = await launchPersistent(ctxOpts);
    } else {
      const launch = (cb as unknown as { launch: LaunchFn }).launch;
      this.browser = await launch(launchOpts);
      const ctxOpts: Record<string, unknown> = {};
      if (this.cfg.userAgent) ctxOpts.userAgent = this.cfg.userAgent;
      if (this.cfg.viewport) ctxOpts.viewport = this.cfg.viewport;
      if (this.cfg.locale) ctxOpts.locale = this.cfg.locale;
      if (this.cfg.timezone) ctxOpts.timezoneId = this.cfg.timezone;
      this.context = await this.browser.newContext(ctxOpts);
    }

    this.context.on("page", (p) => this.attachPage(p));
    if (this.context.pages().length > 0) {
      for (const p of this.context.pages()) this.attachPage(p);
    } else {
      const first = await this.context.newPage();
      this.attachPage(first);
    }
  }

  private attachPage(page: Page): string {
    const existing = [...this.pages.entries()].find(([, p]) => p === page);
    if (existing) return existing[0];
    const id = `t${this.nextTabId++}`;
    this.pages.set(id, page);
    if (!this.activeId) this.activeId = id;
    this.consoleByPage.set(id, []);
    this.networkByPage.set(id, []);

    page.on("console", (msg: ConsoleMessage) => {
      const buf = this.consoleByPage.get(id);
      if (!buf) return;
      buf.push({
        type: msg.type(),
        text: msg.text().slice(0, 4000),
        timestamp: Date.now(),
        level: normalizeLevel(msg.type()),
      });
      if (buf.length > 500) buf.splice(0, buf.length - 500);
    });
    page.on("pageerror", (err: Error) => {
      const buf = this.consoleByPage.get(id);
      if (!buf) return;
      buf.push({
        type: "pageerror",
        text: `${err.name}: ${err.message}`,
        timestamp: Date.now(),
        level: "error",
      });
    });
    page.on("dialog", (dialog: Dialog) => {
      this.pendingDialog = { dialog, page };
    });

    if (this.cfg.caps.has("network")) {
      const reqIndex = new Map<Request, number>();
      page.on("request", (req: Request) => {
        const buf = this.networkByPage.get(id);
        if (!buf) return;
        const headers = req.headers();
        const event: NetworkEvent = {
          index: buf.length,
          url: req.url(),
          method: req.method(),
          resourceType: req.resourceType(),
          startedAt: Date.now(),
          requestHeaders: headers,
        };
        reqIndex.set(req, event.index);
        buf.push(event);
        if (buf.length > 1000) {
          buf.splice(0, buf.length - 1000);
        }
      });
      page.on("response", async (resp: Response) => {
        const buf = this.networkByPage.get(id);
        if (!buf) return;
        const idx = reqIndex.get(resp.request());
        if (idx === undefined) return;
        const event = buf[idx];
        if (!event) return;
        event.status = resp.status();
        event.endedAt = Date.now();
        try {
          event.responseHeaders = await resp.allHeaders();
        } catch {
          /* page may have closed */
        }
      });
      page.on("requestfailed", (req: Request) => {
        const buf = this.networkByPage.get(id);
        if (!buf) return;
        const idx = reqIndex.get(req);
        if (idx === undefined) return;
        const event = buf[idx];
        if (!event) return;
        event.failed = req.failure()?.errorText ?? "unknown";
        event.endedAt = Date.now();
      });
    }

    page.on("close", () => {
      this.pages.delete(id);
      this.consoleByPage.delete(id);
      this.networkByPage.delete(id);
      if (this.activeId === id) this.activeId = this.pages.keys().next().value ?? undefined;
    });

    return id;
  }

  get activePage(): Page {
    if (!this.activeId) throw new NoActivePageError();
    const page = this.pages.get(this.activeId);
    if (!page) throw new NoActivePageError();
    return page;
  }

  get activeTabId(): string {
    if (!this.activeId) throw new NoActivePageError();
    return this.activeId;
  }

  async listTabs(): Promise<TabInfo[]> {
    const out: TabInfo[] = [];
    for (const [id, p] of this.pages) {
      out.push({
        id,
        url: p.url(),
        title: await p.title().catch(() => ""),
        active: id === this.activeId,
      });
    }
    return out;
  }

  setActive(id: string): Page {
    const p = this.pages.get(id);
    if (!p) throw new NoActivePageError();
    this.activeId = id;
    return p;
  }

  async newTab(url?: string): Promise<TabInfo> {
    await this.ensureBrowser();
    if (!this.context) throw new NoActivePageError();
    if (this.pages.size >= this.cfg.maxPages) {
      throw new Error(`Max pages (${this.cfg.maxPages}) reached. Close a tab first.`);
    }
    const page = await this.context.newPage();
    const id = this.attachPage(page);
    this.activeId = id;
    if (url) {
      this.checkNavigation(url);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    return { id, url: page.url(), title: await page.title().catch(() => ""), active: true };
  }

  async closeTab(id?: string): Promise<void> {
    const tid = id ?? this.activeId;
    if (!tid) return;
    const p = this.pages.get(tid);
    if (!p) return;
    await p.close().catch(() => undefined);
  }

  checkNavigation(url: string): void {
    const verdict = isAllowedNavigation(url, this.cfg);
    if (!verdict.ok) throw new NavigationBlockedError(verdict.reason);
  }

  consoleEvents(id?: string): ConsoleEvent[] {
    return [...(this.consoleByPage.get(id ?? this.activeTabId) ?? [])];
  }
  clearConsole(id?: string): void {
    this.consoleByPage.set(id ?? this.activeTabId, []);
  }
  networkEvents(id?: string): NetworkEvent[] {
    return [...(this.networkByPage.get(id ?? this.activeTabId) ?? [])];
  }
  clearNetwork(id?: string): void {
    this.networkByPage.set(id ?? this.activeTabId, []);
  }

  consumeDialog(): { dialog: Dialog; page: Page } | undefined {
    const d = this.pendingDialog;
    this.pendingDialog = undefined;
    return d;
  }

  addRoute(rule: RouteRule): void {
    this.activeRoutes.set(rule.pattern, rule);
    if (!this.context) return;
    void this.context.route(rule.pattern, async (route: Route) => {
      const r = this.activeRoutes.get(rule.pattern);
      if (!r) return route.continue();
      const overrides: Parameters<Route["fulfill"]>[0] = {};
      if (r.status !== undefined) overrides.status = r.status;
      if (r.body !== undefined) overrides.body = r.body;
      if (r.contentType !== undefined) overrides.contentType = r.contentType;
      if (r.headers !== undefined || r.removeHeaders !== undefined) {
        const merged: Record<string, string> = { ...(r.headers ?? {}) };
        for (const h of r.removeHeaders ?? []) delete merged[h.toLowerCase()];
        overrides.headers = merged;
      }
      if (r.status === undefined && r.body === undefined && r.contentType === undefined) {
        return route.continue();
      }
      await route.fulfill(overrides);
    });
  }

  async removeRoute(pattern?: string): Promise<void> {
    if (!this.context) return;
    if (pattern) {
      this.activeRoutes.delete(pattern);
      await this.context.unroute(pattern).catch(() => undefined);
    } else {
      for (const p of [...this.activeRoutes.keys()]) {
        this.activeRoutes.delete(p);
        await this.context.unroute(p).catch(() => undefined);
      }
    }
  }

  listRoutes(): RouteRule[] {
    return [...this.activeRoutes.values()];
  }

  async setOffline(state: "online" | "offline"): Promise<void> {
    if (!this.context) return;
    this.offline = state === "offline";
    await this.context.setOffline(this.offline);
  }

  get isOffline(): boolean {
    return this.offline;
  }

  async shutdown(): Promise<void> {
    for (const p of this.pages.values()) {
      await p.close().catch(() => undefined);
    }
    this.pages.clear();
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = undefined;
    }
  }

  /** Internal: get the BrowserContext for cloak-exclusive context-level operations. */
  get rawContext(): BrowserContext | undefined {
    return this.context;
  }
  get rawBrowser(): Browser | undefined {
    return this.browser;
  }
}

function normalizeLevel(t: string): ConsoleEvent["level"] {
  switch (t) {
    case "warning":
      return "warn";
    case "info":
    case "debug":
    case "trace":
    case "error":
    case "log":
      return t;
    case "pageerror":
      return "error";
    default:
      return "log";
  }
}
