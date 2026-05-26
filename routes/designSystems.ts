import type { Express, Request, Response } from "express";
import { errInfo } from "../lib/errInfo.js";
import {
  deleteProjectDesignSystem,
  getActiveDesignSystemId,
  importProjectDesignSystem,
  listLibraryDesignSystems,
  listProjectDesignSystems,
  readLibraryDesignSystem,
  setActiveProjectDesignSystem,
} from "../lib/designSystemStore.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

type IdParams = { id: string };
type ProjectDesignSystemParams = { id: string; designSystemId: string };

export function registerDesignSystemRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  requireRuntimeContext(ctxRaw);

  app.get("/api/design-systems/library", async (_req: Request, res: Response) => {
    try {
      const systems = await listLibraryDesignSystems();
      res.json({ systems, available: systems.length > 0 });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: { code: "DESIGN_SYSTEM_LIBRARY_ERROR", message: err.message } });
    }
  });

  app.get("/api/design-systems/library/:id", async (req: Request<IdParams>, res: Response) => {
    try {
      const system = await readLibraryDesignSystem(req.params.id);
      if (!system) {
        return res.status(404).json({
          error: { code: "DESIGN_SYSTEM_NOT_FOUND", message: "Design system not found" },
        });
      }
      res.json({ system });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: { code: "DESIGN_SYSTEM_LIBRARY_ERROR", message: err.message } });
    }
  });

  app.get("/api/projects/:id/design-systems", (req: Request<IdParams>, res: Response) => {
    try {
      res.json({
        systems: listProjectDesignSystems(req.params.id),
        activeDesignSystemId: getActiveDesignSystemId(req.params.id),
      });
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({
        error: { code: err.code || "DESIGN_SYSTEM_ERROR", message: err.message },
      });
    }
  });

  app.post("/api/projects/:id/design-systems", async (req: Request<IdParams>, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        body?: unknown;
        slug?: unknown;
        libraryId?: unknown;
        makeActive?: unknown;
      };
      const imported = await importFromBody(req.params.id, body);
      if (body.makeActive !== false) setActiveProjectDesignSystem(req.params.id, imported.id);
      res.status(201).json({
        designSystem: imported,
        activeDesignSystemId: getActiveDesignSystemId(req.params.id),
      });
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 400).json({
        error: { code: err.code || "DESIGN_SYSTEM_IMPORT_FAILED", message: err.message },
      });
    }
  });

  app.patch("/api/projects/:id/design-systems/active", (req: Request<IdParams>, res: Response) => {
    try {
      const body = (req.body ?? {}) as { designSystemId?: unknown };
      const ok = setActiveProjectDesignSystem(req.params.id, body.designSystemId ?? null);
      if (!ok) {
        return res.status(404).json({
          error: { code: "DESIGN_SYSTEM_NOT_FOUND", message: "Design system not found" },
        });
      }
      res.json({ ok: true, activeDesignSystemId: getActiveDesignSystemId(req.params.id) });
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({
        error: { code: err.code || "DESIGN_SYSTEM_ERROR", message: err.message },
      });
    }
  });

  app.delete(
    "/api/projects/:id/design-systems/:designSystemId",
    (req: Request<ProjectDesignSystemParams>, res: Response) => {
      try {
        const ok = deleteProjectDesignSystem(req.params.id, req.params.designSystemId);
        if (!ok) {
          return res.status(404).json({
            error: { code: "DESIGN_SYSTEM_NOT_FOUND", message: "Design system not found" },
          });
        }
        res.json({ ok: true, activeDesignSystemId: getActiveDesignSystemId(req.params.id) });
      } catch (e) {
        const err = errInfo(e);
        res.status(err.status || 500).json({
          error: { code: err.code || "DESIGN_SYSTEM_ERROR", message: err.message },
        });
      }
    },
  );
}

async function importFromBody(
  projectId: string,
  body: { body?: unknown; slug?: unknown; libraryId?: unknown },
) {
  if (typeof body.libraryId === "string" && body.libraryId.trim()) {
    const librarySystem = await readLibraryDesignSystem(body.libraryId);
    if (!librarySystem) {
      const err = new Error("Design system not found") as Error & { status?: number; code?: string };
      err.status = 404;
      err.code = "DESIGN_SYSTEM_NOT_FOUND";
      throw err;
    }
    return importProjectDesignSystem({
      projectId,
      body: librarySystem.body,
      slug: librarySystem.id,
      source: "library",
    });
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    const err = new Error("DESIGN.md body required") as Error & { status?: number; code?: string };
    err.status = 400;
    err.code = "DESIGN_SYSTEM_BODY_REQUIRED";
    throw err;
  }
  return importProjectDesignSystem({
    projectId,
    body: body.body,
    slug: typeof body.slug === "string" ? body.slug : undefined,
    source: "custom",
  });
}
