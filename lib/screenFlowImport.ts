import sharp from "sharp";
import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { createSession, getSession, saveGraph } from "./sessionStore.js";
import { newNodeId, saveNode } from "./nodeStore.js";
import { requireProject } from "./projectStore.js";
import type { RuntimeContext } from "./runtimeContext.js";

type RawScreenInput = {
  url?: unknown;
  title?: unknown;
  note?: unknown;
  image?: unknown;
  dataUrl?: unknown;
  imageBase64?: unknown;
  sizeMode?: unknown;
  sizeOverride?: unknown;
};

export type ScreenFlowImportInput = {
  sessionId?: unknown;
  projectId?: unknown;
  baseUrl?: unknown;
  flowName?: unknown;
  screens?: unknown;
  layout?: unknown;
};

export type AdbScreenImportInput = {
  sessionId?: unknown;
  projectId?: unknown;
  deviceId?: unknown;
  title?: unknown;
  note?: unknown;
  flowName?: unknown;
};

type GraphNodeInput = {
  id: string;
  x: number;
  y: number;
  data: Record<string, unknown>;
};

type GraphEdgeInput = {
  id: string;
  source: string;
  target: string;
  data: Record<string, unknown>;
};

const NODE_X_GAP = 360;
const NODE_Y_GAP = 320;
const ADB_TIMEOUT_MS = 10_000;
const ADB_MAX_BUFFER = 30 * 1024 * 1024;
const IPHONE_NODE_SIZE = "1184x2560";

function badRequest(message: string, code = "SCREEN_FLOW_BAD_REQUEST") {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = code;
  err.status = 400;
  return err;
}

function serverError(message: string, code = "SCREEN_FLOW_CAPTURE_FAILED") {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = code;
  err.status = 500;
  return err;
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function normalizeLayout(value: unknown): "horizontal" | "vertical" {
  return value === "vertical" ? "vertical" : "horizontal";
}

function normalizeBaseUrl(raw: unknown): string {
  const value = cleanText(raw);
  if (!value) throw badRequest("baseUrl is required", "SCREEN_FLOW_BASE_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("baseUrl must be a valid URL", "SCREEN_FLOW_BAD_BASE_URL");
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) throw badRequest("Only localhost screen flow URLs are supported.", "SCREEN_FLOW_NON_LOCAL_URL");
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function resolveScreenUrl(baseUrl: string, rawUrl: unknown): string {
  const value = cleanText(rawUrl);
  if (!value) throw badRequest("screen.url is required", "SCREEN_FLOW_BAD_SCREEN");
  let parsed: URL;
  try {
    parsed = new URL(value, `${baseUrl}/`);
  } catch {
    throw badRequest("screen.url must be a valid URL or route", "SCREEN_FLOW_BAD_SCREEN");
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) throw badRequest("Only localhost screen URLs are supported.", "SCREEN_FLOW_NON_LOCAL_URL");
  parsed.hash = "";
  return parsed.toString();
}

function decodeImage(screen: RawScreenInput): Buffer {
  const raw = screen.image ?? screen.dataUrl ?? screen.imageBase64;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw badRequest("screen.image is required. Capture the page with MCP/browser tooling first.", "SCREEN_IMAGE_REQUIRED");
  }
  const trimmed = raw.trim();
  const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/i.exec(trimmed);
  const b64 = match ? match[1] : trimmed;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    throw badRequest("screen.image must be base64 image data.", "SCREEN_IMAGE_BAD_DATA");
  }
}

async function normalizeImageToPng(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { failOn: "none" }).png().toBuffer();
  } catch {
    throw badRequest("screen.image must be a valid PNG, JPEG, or WebP image.", "SCREEN_IMAGE_BAD_DATA");
  }
}

function newClientNodeId(): string {
  return `nc_${randomBytes(4).toString("hex")}`;
}

function graphStartPosition(nodes: Array<{ x: number; y: number }>, layout: "horizontal" | "vertical") {
  if (nodes.length === 0) return { x: 0, y: 0 };
  if (layout === "vertical") {
    return { x: 0, y: Math.max(...nodes.map((node) => node.y)) + NODE_Y_GAP };
  }
  return { x: Math.max(...nodes.map((node) => node.x)) + NODE_X_GAP, y: 0 };
}

function adbPath(): string {
  return process.env.IMA2_ADB_PATH || "adb";
}

function runAdb(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      adbPath(),
      args,
      { encoding: "buffer", maxBuffer: ADB_MAX_BUFFER, timeout: ADB_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          const message = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : "";
          reject(serverError(message || error.message));
          return;
        }
        resolve(stdout as Buffer);
      },
    );
  });
}

async function resolveAdbDevice(deviceIdRaw: unknown): Promise<string> {
  const requested = cleanText(deviceIdRaw, "");
  const output = (await runAdb(["devices"])).toString("utf8");
  const devices = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .map((line) => {
      const [id, status] = line.split(/\s+/);
      return { id, status };
    });
  if (requested) {
    const found = devices.find((device) => device.id === requested);
    if (!found) throw badRequest(`ADB device not found: ${requested}`, "ADB_DEVICE_NOT_FOUND");
    if (found.status !== "device") throw badRequest(`ADB device is not ready: ${requested} (${found.status})`, "ADB_DEVICE_NOT_READY");
    return found.id;
  }
  const ready = devices.find((device) => device.status === "device");
  if (!ready) throw badRequest("No authorized ADB device found.", "ADB_DEVICE_NOT_READY");
  return ready.id;
}

async function captureAdbPng(deviceId: string): Promise<Buffer> {
  const png = await runAdb(["-s", deviceId, "exec-out", "screencap", "-p"]);
  if (png.length === 0) throw serverError("ADB screenshot returned no data.");
  return png;
}

export async function importScreenFlow(ctx: RuntimeContext, input: ScreenFlowImportInput) {
  const screens = Array.isArray(input.screens) ? input.screens as RawScreenInput[] : [];
  if (screens.length === 0) throw badRequest("screens must contain at least one item");
  if (screens.length > 50) throw badRequest("screen flow import supports at most 50 screens", "SCREEN_FLOW_TOO_LARGE");

  const projectId = requireProject(input.projectId);
  const layout = normalizeLayout(input.layout);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const flowName = cleanText(input.flowName, "Screen Flow");
  const existingSessionId = cleanText(input.sessionId);
  const created = existingSessionId ? null : createSession({ title: flowName, projectId });
  const session = getSession(existingSessionId || created?.id || "");
  if (!session) {
    const err = new Error(`Session not found: ${existingSessionId}`) as Error & { code?: string; status?: number };
    err.code = "SESSION_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  if ((session.projectId ?? projectId) !== projectId) {
    throw badRequest("sessionId does not belong to the requested project.", "SCREEN_FLOW_PROJECT_MISMATCH");
  }

  const graphNodes: GraphNodeInput[] = session.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    data: node.data,
  }));
  const graphEdges: GraphEdgeInput[] = session.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge.data,
  }));
  const start = graphStartPosition(graphNodes, layout);
  const imported: Array<{ nodeId: string; clientNodeId: string; filename: string; url: string; screenUrl: string; title: string | null }> = [];
  let previousClientId: string | null = null;

  for (let index = 0; index < screens.length; index += 1) {
    const screen = screens[index];
    const screenUrl = resolveScreenUrl(baseUrl, screen.url);
    const title = cleanText(screen.title) || new URL(screenUrl).pathname || screenUrl;
    const note = cleanText(screen.note);
    const sizeMode = cleanText(screen.sizeMode) === "fixed" ? "fixed" : cleanText(screen.sizeMode) === "auto" ? "auto" : undefined;
    const sizeOverride = cleanText(screen.sizeOverride);
    const nodeSize = sizeMode === "fixed" && sizeOverride ? sizeOverride : null;
    const pngBuffer = await normalizeImageToPng(decodeImage(screen));
    const nodeId = newNodeId();
    const clientNodeId = newClientNodeId();
    const prompt = [title, note, screenUrl].filter(Boolean).join("\n");
    const meta = {
      schema: "ima2.generation.v1",
      app: "ima2-gen",
      version: ctx.packageVersion,
      kind: "screen-flow",
      nodeId,
      projectId,
      sessionId: session.id,
      clientNodeId,
      parentNodeId: null,
      prompt,
      userPrompt: prompt,
      screenUrl,
      screenTitle: title,
      screenNote: note || null,
      flowName,
      flowIndex: index,
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      format: "png",
      quality: null,
      size: nodeSize,
      model: null,
      provider: "screen-flow",
      refsCount: 0,
    };
    const { filename } = await saveNode(ctx.rootDir, {
      nodeId,
      b64: pngBuffer.toString("base64"),
      meta,
      ext: "png",
      generatedDir: ctx.config.storage.generatedDir,
    });
    const url = `/generated/${filename}`;
    const position = layout === "vertical"
      ? { x: start.x, y: start.y + index * NODE_Y_GAP }
      : { x: start.x + index * NODE_X_GAP, y: start.y };
    graphNodes.push({
      id: clientNodeId,
      x: position.x,
      y: position.y,
      data: {
        clientId: clientNodeId,
        serverNodeId: nodeId,
        parentServerNodeId: null,
        prompt,
        imageUrl: url,
        status: "ready",
        pendingRequestId: null,
        pendingPhase: null,
        model: null,
        size: nodeSize,
        sizeMode,
        sizeOverride: nodeSize,
        screenFlow: {
          flowName,
          index,
          screenUrl,
          title,
          note: note || null,
        },
      },
    });
    if (previousClientId) {
      graphEdges.push({
        id: `${previousClientId}:source-right->${clientNodeId}:target-left`,
        source: previousClientId,
        target: clientNodeId,
        data: {
          sourceHandle: "source-right",
          targetHandle: "target-left",
          kind: "screen-flow",
          flowName,
        },
      });
    }
    previousClientId = clientNodeId;
    imported.push({ nodeId, clientNodeId, filename, url, screenUrl, title });
  }

  const saved = saveGraph(session.id, {
    expectedVersion: session.graphVersion,
    nodes: graphNodes,
    edges: graphEdges,
  });
  const nextSession = getSession(session.id);
  return {
    session: nextSession,
    imported,
    graphVersion: saved.graphVersion,
  };
}

export async function importAdbScreen(ctx: RuntimeContext, input: AdbScreenImportInput) {
  const deviceId = await resolveAdbDevice(input.deviceId);
  const png = await captureAdbPng(deviceId);
  const title = cleanText(input.title, `ADB ${deviceId}`);
  const note = cleanText(input.note);
  return importScreenFlow(ctx, {
    sessionId: input.sessionId,
    projectId: input.projectId,
    baseUrl: "http://127.0.0.1",
    flowName: cleanText(input.flowName, "ADB Captures"),
    layout: "horizontal",
    screens: [{
      url: `/adb/${encodeURIComponent(deviceId)}/${Date.now()}`,
      title,
      note,
      sizeMode: "fixed",
      sizeOverride: IPHONE_NODE_SIZE,
      image: `data:image/png;base64,${png.toString("base64")}`,
    }],
  });
}
