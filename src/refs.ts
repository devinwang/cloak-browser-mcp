import type { Locator, Page } from "playwright-core";
import { RefNotFoundError } from "./errors.js";

export interface RefEntry {
  ref: string;
  role: string;
  name: string;
  value?: string;
  /** Among siblings sharing role+name, this is the 0-indexed position. */
  nthSameRoleName: number;
}

interface RawNode {
  role: string;
  name: string;
  value: string;
  disabled: boolean;
  visible: boolean;
  children: RawNode[];
}

const INTERESTING_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "treeitem",
  "row",
  "listitem",
  "heading",
  "img",
  "dialog",
  "form",
  "table",
  "alert",
  "tooltip",
  "navigation",
  "main",
  "region",
  "article",
  "list",
  "listbox",
  "menu",
  "menubar",
  "tablist",
  "tabpanel",
  "toolbar",
  "tree",
]);

export class RefRegistry {
  private byRef = new Map<string, RefEntry>();
  private lastSnapshotText = "";

  reset(): void {
    this.byRef.clear();
    this.lastSnapshotText = "";
  }

  get text(): string {
    return this.lastSnapshotText;
  }

  resolve(ref: string): RefEntry {
    const entry = this.byRef.get(ref);
    if (!entry) throw new RefNotFoundError(ref);
    return entry;
  }

  async snapshot(page: Page): Promise<string> {
    this.byRef.clear();
    const tree = (await page.evaluate(AX_WALKER_SRC)) as RawNode | null;
    const lines: string[] = [];
    let nextId = 0;
    const counters = new Map<string, number>();
    const walk = (node: RawNode | null, depth: number): void => {
      if (!node) return;
      const role = node.role || "generic";
      const name = (node.name || "").slice(0, 200);
      const interesting = INTERESTING_ROLES.has(role) && node.visible;
      let ref = "";
      if (interesting) {
        const key = `${role}::${name}`;
        const seen = counters.get(key) ?? 0;
        counters.set(key, seen + 1);
        ref = `e${++nextId}`;
        this.byRef.set(ref, { ref, role, name, value: node.value || undefined, nthSameRoleName: seen });
      }
      const indent = "  ".repeat(depth);
      const refTag = ref ? ` [${ref}]` : "";
      const valuePart = node.value ? ` value=${JSON.stringify(node.value.slice(0, 80))}` : "";
      const statePart = node.disabled ? " [disabled]" : "";
      lines.push(`${indent}- ${role}${refTag} ${JSON.stringify(name)}${valuePart}${statePart}`);
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(tree, 0);
    this.lastSnapshotText = lines.join("\n");
    return this.lastSnapshotText;
  }

  locator(page: Page, target: string): Locator {
    if (/^e\d+$/.test(target)) {
      const entry = this.resolve(target);
      const loc = page.getByRole(entry.role as Parameters<Page["getByRole"]>[0], {
        name: entry.name || undefined,
        exact: true,
      });
      return entry.nthSameRoleName > 0 ? loc.nth(entry.nthSameRoleName) : loc.first();
    }
    if (target.startsWith("xpath=")) return page.locator(target);
    if (target.startsWith("text=")) return page.getByText(target.slice(5));
    if (target.startsWith("role=")) {
      const rest = target.slice(5);
      const m = rest.match(/^([^[]+)(?:\[name="(.*)"\])?$/);
      if (m) {
        const [, role, name] = m;
        return page.getByRole(role as Parameters<Page["getByRole"]>[0], { name });
      }
    }
    return page.locator(target);
  }
}

/**
 * Self-contained DOM walker, executed in the page context via `page.evaluate(string)`.
 * Cannot reference any Node-side identifier. Returns a serialisable role/name/visibility tree.
 */
const AX_WALKER_SRC = `(() => {
  function inferRole(el) {
    var aria = el.getAttribute('role');
    if (aria) return aria;
    var tag = el.tagName.toLowerCase();
    var type = (el.type || '').toLowerCase();
    switch (tag) {
      case 'a': return el.href ? 'link' : 'generic';
      case 'button': return 'button';
      case 'input':
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
        if (type === 'search') return 'searchbox';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        return 'textbox';
      case 'textarea': return 'textbox';
      case 'select': return 'combobox';
      case 'option': return 'option';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'img': return 'img';
      case 'form': return 'form';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'table': return 'table';
      case 'li': return 'listitem';
      case 'ul': case 'ol': return 'list';
      case 'dialog': return 'dialog';
      case 'article': return 'article';
      case 'section': return 'region';
      default: return 'generic';
    }
  }
  function accessibleName(el) {
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var ids = lb.split(/\\s+/);
      var texts = ids.map(function(id){ var n=document.getElementById(id); return n && n.textContent ? n.textContent.trim() : ''; }).filter(Boolean);
      if (texts.length) return texts.join(' ');
    }
    var al = el.getAttribute('aria-label');
    if (al) return al;
    if (el.labels && el.labels.length) {
      var lt = el.labels[0].textContent;
      if (lt) return lt.trim();
    }
    if (el.placeholder) return el.placeholder;
    if (el.alt) return el.alt;
    var title = el.getAttribute('title');
    if (title) return title;
    var t = el.textContent || '';
    return t.trim().slice(0, 200);
  }
  function isVisible(el) {
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if (r.width === 0 && r.height === 0) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return true;
  }
  function elementValue(el) {
    if ('value' in el && typeof el.value === 'string') return el.value;
    return '';
  }
  function walk(el) {
    var role = inferRole(el);
    var children = [];
    var cs = el.children || [];
    for (var i = 0; i < cs.length; i++) {
      var sub = walk(cs[i]);
      if (sub.role !== 'generic' || sub.children.length > 0) children.push(sub);
    }
    return {
      role: role,
      name: accessibleName(el),
      value: elementValue(el),
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      visible: isVisible(el),
      children: children,
    };
  }
  return document.body ? walk(document.body) : null;
})()`;
