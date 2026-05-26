import type { Express, Request, Response } from "express";
import {
  importAdbScreen,
  importScreenFlow,
  type AdbScreenImportInput,
  type ScreenFlowImportInput,
} from "../lib/screenFlowImport.js";
import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

export function registerScreenFlowRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  app.post("/api/screen-flows/import", async (req: Request, res: Response) => {
    try {
      const payload = await importScreenFlow(ctx, (req.body ?? {}) as ScreenFlowImportInput);
      res.status(201).json(payload);
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({
        error: {
          code: err.code || "SCREEN_FLOW_IMPORT_FAILED",
          message: err.message,
        },
      });
    }
  });

  app.post("/api/screen-flows/import-adb", async (req: Request, res: Response) => {
    try {
      const payload = await importAdbScreen(ctx, (req.body ?? {}) as AdbScreenImportInput);
      res.status(201).json(payload);
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({
        error: {
          code: err.code || "ADB_SCREEN_IMPORT_FAILED",
          message: err.message,
        },
      });
    }
  });
}
