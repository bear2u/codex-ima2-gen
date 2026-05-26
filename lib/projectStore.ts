import { ulid } from "ulid";
import { getDb } from "./db.js";

const DEFAULT_PROJECT_ID = "p_default";
const MAX_TITLE = 200;

function now() {
  return Date.now();
}

function cleanTitle(title: unknown, fallback = "Untitled Project") {
  return (typeof title === "string" && title.trim() ? title.trim() : fallback).slice(0, MAX_TITLE);
}

export type ProjectSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sessionCount: number;
  imageCount: number;
};

type ProjectRow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export function getDefaultProjectId() {
  ensureDefaultProject();
  return DEFAULT_PROJECT_ID;
}

export function ensureDefaultProject() {
  const db = getDb();
  const existing = db
    .prepare("SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?")
    .get(DEFAULT_PROJECT_ID) as ProjectRow | undefined;
  if (existing) return existing;
  const t = now();
  db.prepare("INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(DEFAULT_PROJECT_ID, "Default Project", t, t);
  return { id: DEFAULT_PROJECT_ID, title: "Default Project", createdAt: t, updatedAt: t };
}

export function normalizeProjectId(projectId: unknown) {
  if (typeof projectId === "string" && projectId.trim()) return projectId.trim();
  return getDefaultProjectId();
}

export function projectExists(projectId: string) {
  const row = getDb().prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
  return Boolean(row);
}

export function requireProject(projectId: unknown) {
  const id = normalizeProjectId(projectId);
  if (!projectExists(id)) {
    const err = new Error(`Project not found: ${id}`) as Error & { code?: string; status?: number };
    err.code = "PROJECT_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  return id;
}

export function listProjects() {
  ensureDefaultProject();
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC",
    )
    .all() as ProjectRow[];
  return rows.map((project) => ({
    ...project,
    sessionCount: (db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE project_id = ?").get(project.id) as { c: number } | undefined)?.c ?? 0,
    imageCount: 0,
  })) satisfies ProjectSummary[];
}

export function createProject({ title }: { title?: unknown } = {}) {
  const db = getDb();
  const id = "p_" + ulid();
  const t = now();
  const safeTitle = cleanTitle(title);
  db.prepare("INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, safeTitle, t, t);
  return { id, title: safeTitle, createdAt: t, updatedAt: t, sessionCount: 0, imageCount: 0 };
}

export function renameProject(id: string, title: unknown) {
  const safeTitle = cleanTitle(title);
  const res = getDb()
    .prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
    .run(safeTitle, now(), id);
  return res.changes > 0;
}

export function deleteProject(id: string) {
  if (id === DEFAULT_PROJECT_ID) {
    const err = new Error("Default project cannot be deleted") as Error & { code?: string; status?: number };
    err.code = "DEFAULT_PROJECT_DELETE_FORBIDDEN";
    err.status = 400;
    throw err;
  }
  const res = getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return res.changes > 0;
}
