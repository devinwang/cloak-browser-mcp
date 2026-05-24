import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { textOutput } from "./types.js";

const xy = z.object({ x: z.number(), y: z.number() });
const clickSchema = xy.extend({
  button: z.enum(["left", "right", "middle"]).optional(),
  clickCount: z.number().optional(),
  delay: z.number().optional(),
});
const dragSchema = z.object({
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  steps: z.number().optional(),
});
const buttonSchema = z.object({ button: z.enum(["left", "right", "middle"]).optional() });
const wheelSchema = z.object({ deltaX: z.number(), deltaY: z.number() });

export const visionTools: ToolHandler[] = [
  {
    name: "browser_mouse_click_xy",
    description: "Click at pixel coordinates (bypasses accessibility tree).",
    capability: "vision",
    inputSchema: clickSchema,
    handler: async (session, raw) => {
      const args = clickSchema.parse(raw);
      const page = session.activePage;
      await page.mouse.click(args.x, args.y, {
        button: args.button ?? "left",
        clickCount: args.clickCount ?? 1,
        delay: args.delay ?? 0,
      });
      return textOutput(`Clicked at (${args.x}, ${args.y})`);
    },
  },
  {
    name: "browser_mouse_move_xy",
    description: "Move the cursor to pixel coordinates.",
    capability: "vision",
    inputSchema: xy,
    handler: async (session, raw) => {
      const args = xy.parse(raw);
      await session.activePage.mouse.move(args.x, args.y);
      return textOutput(`Moved to (${args.x}, ${args.y})`);
    },
  },
  {
    name: "browser_mouse_drag_xy",
    description: "Drag from one coordinate pair to another.",
    capability: "vision",
    inputSchema: dragSchema,
    handler: async (session, raw) => {
      const args = dragSchema.parse(raw);
      const page = session.activePage;
      await page.mouse.move(args.startX, args.startY);
      await page.mouse.down();
      await page.mouse.move(args.endX, args.endY, { steps: args.steps ?? 10 });
      await page.mouse.up();
      return textOutput(`Dragged (${args.startX},${args.startY}) → (${args.endX},${args.endY})`);
    },
  },
  {
    name: "browser_mouse_down",
    description: "Press a mouse button at the current cursor position.",
    capability: "vision",
    inputSchema: buttonSchema,
    handler: async (session, raw) => {
      const args = buttonSchema.parse(raw);
      await session.activePage.mouse.down({ button: args.button ?? "left" });
      return textOutput(`Mouse down (${args.button ?? "left"})`);
    },
  },
  {
    name: "browser_mouse_up",
    description: "Release a mouse button at the current cursor position.",
    capability: "vision",
    inputSchema: buttonSchema,
    handler: async (session, raw) => {
      const args = buttonSchema.parse(raw);
      await session.activePage.mouse.up({ button: args.button ?? "left" });
      return textOutput(`Mouse up (${args.button ?? "left"})`);
    },
  },
  {
    name: "browser_mouse_wheel",
    description: "Scroll via mouse wheel by delta pixels.",
    capability: "vision",
    inputSchema: wheelSchema,
    handler: async (session, raw) => {
      const args = wheelSchema.parse(raw);
      await session.activePage.mouse.wheel(args.deltaX, args.deltaY);
      return textOutput(`Wheel (${args.deltaX}, ${args.deltaY})`);
    },
  },
];
