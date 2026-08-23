export class CloakError extends Error {
  constructor(message: string, public readonly code: string = "CLOAK_ERROR") {
    super(message);
    this.name = "CloakError";
  }
}

export class CapabilityNotEnabledError extends CloakError {
  constructor(cap: string, tool: string) {
    super(`Tool ${tool} requires capability "${cap}" — start the server with --caps ${cap} (or --caps all).`, "CAP_DISABLED");
  }
}

export class NoActivePageError extends CloakError {
  constructor() {
    super(
      'No active page. Open one with browser_tabs {"action":"new"}, or call browser_navigate with a url.',
      "NO_PAGE",
    );
  }
}

export class BrowserNotLaunchedError extends CloakError {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
    super(
      "Browser failed to launch, so there is no page to act on." +
        (detail ? ` Underlying error: ${detail}` : "") +
        " A stale CloakBrowser process may still hold the profile directory —" +
        " check with: ps aux | grep cloakbrowser" +
        " and terminate the parent Chromium processes, then retry.",
      "NO_BROWSER",
    );
  }
}

export class TabNotFoundError extends CloakError {
  constructor(id: string) {
    super(
      `Tab ${id} not found. Call browser_tabs {"action":"list"} to see open tabs.`,
      "TAB_NOT_FOUND",
    );
  }
}

export class RefNotFoundError extends CloakError {
  constructor(ref: string) {
    super(`Ref ${ref} not found. Re-run browser_snapshot to get fresh refs.`, "REF_MISSING");
  }
}

export class NavigationBlockedError extends CloakError {
  constructor(reason: string) {
    super(`Navigation blocked: ${reason}`, "NAV_BLOCKED");
  }
}

export class UnsafeEvalDisabledError extends CloakError {
  constructor() {
    super(
      "browser_run_code_unsafe is disabled. Start the server with both --caps config AND --enable-unsafe-eval to expose it.",
      "UNSAFE_DISABLED",
    );
  }
}
