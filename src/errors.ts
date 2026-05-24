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
    super("No active page. Call browser_navigate first.", "NO_PAGE");
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
