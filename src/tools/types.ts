import type { ZodTypeAny } from "zod";
import type { BrowserSession } from "../browser.js";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  capability?: "vision" | "pdf" | "devtools" | "network" | "storage" | "config" | "testing" | "humanize";
  /** Extra runtime check (e.g. unsafe-eval). Throws CloakError if not satisfied. */
  precondition?: (session: BrowserSession) => void;
  handler: (session: BrowserSession, args: Record<string, unknown>) => Promise<ToolOutput>;
}

export interface ToolOutput {
  content: Array<TextContent | ImageContent>;
  isError?: boolean;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export function textOutput(text: string): ToolOutput {
  return { content: [{ type: "text", text }] };
}

export function imageOutput(base64: string, mimeType = "image/png", caption?: string): ToolOutput {
  const out: ToolOutput = { content: [{ type: "image", data: base64, mimeType }] };
  if (caption) out.content.unshift({ type: "text", text: caption });
  return out;
}

export function errorOutput(text: string): ToolOutput {
  return { content: [{ type: "text", text }], isError: true };
}
