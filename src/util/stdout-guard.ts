import { format } from "node:util";

/**
 * MCP over stdio owns stdout, so anything else written there corrupts the
 * JSON-RPC stream. Third-party code logs through console.log/info/debug (for
 * example cloakbrowser's proxy-credential notice), which Node sends to
 * stdout. Route those to stderr instead.
 */
export function routeConsoleToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}
