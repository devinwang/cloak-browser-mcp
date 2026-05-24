import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const saveSchema = z.object({
  filename: z.string().describe("Absolute path to write the PDF to."),
  format: z.enum(["A4", "Letter", "Legal"]).optional(),
  landscape: z.boolean().optional(),
  printBackground: z.boolean().optional(),
  scale: z.number().min(0.1).max(2).optional(),
});

export const pdfTools: ToolHandler[] = [
  {
    name: "browser_pdf_save",
    description: "Save the current page as PDF (Chromium-only).",
    capability: "pdf",
    inputSchema: saveSchema,
    handler: async (session, raw) => {
      const args = saveSchema.parse(raw);
      const page = session.activePage;
      await page.pdf({
        path: args.filename,
        format: args.format ?? "A4",
        landscape: args.landscape ?? false,
        printBackground: args.printBackground ?? true,
        scale: args.scale ?? 1,
      });
      return textOutput(`Wrote PDF to ${args.filename}`);
    },
  },
];
