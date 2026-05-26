import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import { config } from "../config.js";
import { getDb } from "./db.js";
import { requireProject } from "./projectStore.js";

export type DesignSystemSource = "custom" | "library";

export type ParsedDesignSystem = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
  body: string;
};

export type ProjectDesignSystem = ParsedDesignSystem & {
  id: string;
  projectId: string;
  source: DesignSystemSource;
  createdAt: number;
  updatedAt: number;
};

type DesignSystemRow = {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  swatches: string;
  body: string;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export function slugifyDesignSystemId(raw: unknown): string {
  const slug = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "design-system";
}

export function parseDesignSystemMarkdown(body: string, preferredSlug?: string): ParsedDesignSystem {
  const cleanBody = normalizeBody(body);
  const title = cleanTitle(/^#\s+(.+?)\s*$/m.exec(cleanBody)?.[1] ?? "Design System");
  return {
    slug: slugifyDesignSystemId(preferredSlug || title),
    title,
    category: extractCategory(cleanBody) || "Uncategorized",
    summary: summarizeDesignSystem(cleanBody),
    swatches: extractSwatches(cleanBody),
    body: cleanBody,
  };
}

export async function listLibraryDesignSystems(root = config.designSystems.openDesignRoot) {
  const dir = root ? path.join(root, "design-systems") : "";
  if (!dir) return [];
  const rows: Array<ParsedDesignSystem & { id: string; source: "library" }> = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return rows;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const designPath = path.join(dir, entry.name, "DESIGN.md");
    try {
      const s = await stat(designPath);
      if (!s.isFile()) continue;
      const parsed = parseDesignSystemMarkdown(await readFile(designPath, "utf8"), entry.name);
      rows.push({ ...parsed, id: entry.name, source: "library" });
    } catch {
      // Skip malformed or unreadable presets.
    }
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readLibraryDesignSystem(id: string, root = config.designSystems.openDesignRoot) {
  const safeId = slugifyDesignSystemId(id);
  if (!root || !safeId) return null;
  const designPath = path.join(root, "design-systems", safeId, "DESIGN.md");
  try {
    const s = await stat(designPath);
    if (!s.isFile()) return null;
    return { ...parseDesignSystemMarkdown(await readFile(designPath, "utf8"), safeId), id: safeId };
  } catch {
    return null;
  }
}

export function listProjectDesignSystems(projectIdRaw: unknown) {
  const projectId = requireProject(projectIdRaw);
  const rows = getDb()
    .prepare(
      `SELECT id, project_id AS projectId, slug, title, category, summary, swatches,
        body, source, created_at AS createdAt, updated_at AS updatedAt
       FROM project_design_systems
       WHERE project_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(projectId) as DesignSystemRow[];
  return rows.map(mapRow);
}

export function getActiveProjectDesignSystem(projectIdRaw: unknown) {
  const projectId = requireProject(projectIdRaw);
  const row = getDb()
    .prepare(
      `SELECT ds.id, ds.project_id AS projectId, ds.slug, ds.title, ds.category,
        ds.summary, ds.swatches, ds.body, ds.source, ds.created_at AS createdAt,
        ds.updated_at AS updatedAt
       FROM projects p
       JOIN project_design_systems ds ON ds.id = p.active_design_system_id
       WHERE p.id = ?`,
    )
    .get(projectId) as DesignSystemRow | undefined;
  return row ? mapRow(row) : null;
}

export function getActiveDesignSystemId(projectIdRaw: unknown) {
  const projectId = requireProject(projectIdRaw);
  const row = getDb()
    .prepare("SELECT active_design_system_id AS id FROM projects WHERE id = ?")
    .get(projectId) as { id: string | null } | undefined;
  return row?.id ?? null;
}

export function importProjectDesignSystem(input: {
  projectId: unknown;
  body: string;
  slug?: string;
  source?: DesignSystemSource;
}) {
  const projectId = requireProject(input.projectId);
  const parsed = parseDesignSystemMarkdown(input.body, input.slug);
  const now = Date.now();
  const id = "ds_" + ulid();
  getDb()
    .prepare(
      `INSERT INTO project_design_systems
        (id, project_id, slug, title, category, summary, swatches, body, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      allocateSlug(projectId, parsed.slug),
      parsed.title,
      parsed.category,
      parsed.summary,
      JSON.stringify(parsed.swatches),
      parsed.body,
      input.source || "custom",
      now,
      now,
    );
  const created = getProjectDesignSystem(projectId, id);
  if (!created) throw new Error("Failed to load imported design system");
  return created;
}

export function setActiveProjectDesignSystem(projectIdRaw: unknown, designSystemId: unknown) {
  const projectId = requireProject(projectIdRaw);
  if (designSystemId === null || designSystemId === "") {
    getDb().prepare("UPDATE projects SET active_design_system_id = ?, updated_at = ? WHERE id = ?")
      .run(null, Date.now(), projectId);
    return true;
  }
  if (typeof designSystemId !== "string") return false;
  const existing = getProjectDesignSystem(projectId, designSystemId);
  if (!existing) return false;
  getDb().prepare("UPDATE projects SET active_design_system_id = ?, updated_at = ? WHERE id = ?")
    .run(designSystemId, Date.now(), projectId);
  return true;
}

export function deleteProjectDesignSystem(projectIdRaw: unknown, designSystemId: string) {
  const projectId = requireProject(projectIdRaw);
  const db = getDb();
  const activeId = getActiveDesignSystemId(projectId);
  const res = db
    .prepare("DELETE FROM project_design_systems WHERE project_id = ? AND id = ?")
    .run(projectId, designSystemId);
  if (res.changes > 0 && activeId === designSystemId) {
    setActiveProjectDesignSystem(projectId, null);
  }
  return res.changes > 0;
}

function getProjectDesignSystem(projectId: string, id: string) {
  const row = getDb()
    .prepare(
      `SELECT id, project_id AS projectId, slug, title, category, summary, swatches,
        body, source, created_at AS createdAt, updated_at AS updatedAt
       FROM project_design_systems
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, id) as DesignSystemRow | undefined;
  return row ? mapRow(row) : null;
}

function allocateSlug(projectId: string, rawSlug: string) {
  const base = slugifyDesignSystemId(rawSlug);
  let slug = base;
  let n = 2;
  const stmt = getDb().prepare(
    "SELECT 1 FROM project_design_systems WHERE project_id = ? AND slug = ?",
  );
  while (stmt.get(projectId, slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function mapRow(row: DesignSystemRow): ProjectDesignSystem {
  let swatches: string[] = [];
  try {
    const parsed = JSON.parse(row.swatches);
    if (Array.isArray(parsed)) swatches = parsed.filter((x) => typeof x === "string");
  } catch {
    swatches = [];
  }
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    swatches,
    body: row.body,
    source: row.source === "library" ? "library" : "custom",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeBody(body: string) {
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("DESIGN.md body required");
  }
  return body.trimEnd().slice(0, config.designSystems.maxBodyChars) + "\n";
}

function cleanTitle(raw: string) {
  return raw.replace(/^Design System (Inspired by|for)\s+/i, "").trim() || "Design System";
}

function extractCategory(raw: string) {
  return /^>\s*Category:\s*(.+?)\s*$/im.exec(raw)?.[1]?.trim() ?? "";
}

function summarizeDesignSystem(raw: string) {
  const lines = raw.split(/\r?\n/);
  const firstH1 = lines.findIndex((line) => /^#\s+/.test(line));
  if (firstH1 === -1) return "";
  const afterH1 = lines.slice(firstH1 + 1);
  const nextHeading = afterH1.findIndex((line) => /^#{1,6}\s+/.test(line));
  return (nextHeading === -1 ? afterH1 : afterH1.slice(0, nextHeading))
    .join("\n")
    .replace(/^>\s*Category:.*$/gim, "")
    .replace(/^>\s*/gm, "")
    .trim()
    .split(/\n\n/)[0]
    ?.slice(0, 240) ?? "";
}

function extractSwatches(raw: string) {
  const colors: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  const push = (name: string, value: string) => {
    const cleanName = name.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const hex = normalizeHex(value);
    if (!hex || cleanName.length > 60) return;
    const key = `${cleanName}|${hex}`;
    if (seen.has(key)) return;
    seen.add(key);
    colors.push({ name: cleanName, value: hex });
  };
  let match: RegExpExecArray | null;
  const reA = /^[\s>*-]*\**\s*([A-Za-z][A-Za-z0-9 /&()+_-]{1,40}?)\s*[:：]\**\s*`?(#[0-9a-fA-F]{3,8})/gm;
  while ((match = reA.exec(raw)) !== null) push(match[1] ?? "", match[2] ?? "");
  const reB = /\*\*([A-Za-z][A-Za-z0-9 /&()+_-]{1,40}?)\*\*\s*\(?\s*`?(#[0-9a-fA-F]{3,8})/g;
  while ((match = reB.exec(raw)) !== null) push(match[1] ?? "", match[2] ?? "");
  if (colors.length === 0) return [];
  const pick = (hints: string[]) => {
    for (const hint of hints) {
      const found = colors.find((color) => color.name.includes(hint));
      if (found) return found.value;
    }
    return null;
  };
  const bg = pick(["page background", "background", "canvas", "paper", "surface"]) ?? "#ffffff";
  const fg = pick(["heading", "foreground", "ink", "fg", "text", "navy", "graphite"]) ?? "#111111";
  const accent = pick(["primary brand", "brand primary", "accent", "brand", "primary"])
    ?? colors.find((color) => !isNeutral(color.value))?.value
    ?? colors[0]?.value
    ?? "#888888";
  const support = pick(["border", "divider", "rule", "muted", "secondary", "subtle"])
    ?? colors.find((color) => isNeutral(color.value) && color.value !== bg && color.value !== fg)?.value
    ?? "#cccccc";
  return [bg, support, fg, accent];
}

function isNeutral(hex: string) {
  if (!/^#[0-9a-f]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 10;
}

function normalizeHex(raw: string) {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(raw.trim());
  if (!match) return null;
  let hex = match[1] ?? "";
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 4) hex = hex.split("").map((c) => c + c).join("").slice(0, 8);
  return "#" + hex.toLowerCase();
}
