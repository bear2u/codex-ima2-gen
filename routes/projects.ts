import type { Express, Request, Response } from "express";
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "../lib/projectStore.js";
import { errInfo } from "../lib/errInfo.js";

type IdParams = { id: string };

export function registerProjectRoutes(app: Express) {
  app.get("/api/projects", (_req: Request, res: Response) => {
    try {
      res.json({ projects: listProjects() });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
    }
  });

  app.post("/api/projects", (req: Request, res: Response) => {
    try {
      const project = createProject({ title: (req.body ?? {}).title });
      res.status(201).json({ project });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
    }
  });

  app.patch("/api/projects/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const title = (req.body ?? {}).title;
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({
          error: { code: "INVALID_TITLE", message: "Title required" },
        });
      }
      const ok = renameProject(req.params.id, title);
      if (!ok) {
        return res.status(404).json({
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
      }
      res.json({ ok: true });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
    }
  });

  app.delete("/api/projects/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const ok = deleteProject(req.params.id);
      if (!ok) {
        return res.status(404).json({
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
      }
      res.json({ ok: true });
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({
        error: { code: err.code || "DB_ERROR", message: err.message },
      });
    }
  });
}
