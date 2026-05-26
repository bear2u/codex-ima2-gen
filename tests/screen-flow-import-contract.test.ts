import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { once } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-screen-flow-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const db = await import("../lib/db.ts");
const sessionStore = await import("../lib/sessionStore.ts");
const { registerScreenFlowRoutes } = await import("../routes/screenFlows.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

async function pngDataUrl(color: string) {
  const buffer = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function pngFile(path: string, color: string) {
  const buffer = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
  writeFileSync(path, buffer);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function writeFakeAdb(path: string, pngPath: string) {
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nemulator-5554\\tdevice\\n'
  exit 0
fi
if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "exec-out" ]; then
  cat ${shellQuote(pngPath)}
  exit 0
fi
echo "unexpected adb args: $*" >&2
exit 1
`);
  chmodSync(path, 0o755);
}

async function startApp(generatedDir: string) {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerScreenFlowRoutes(app, {
    config: { storage: { generatedDir } },
    packageVersion: "test",
    rootDir: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  return { server, port };
}

async function closeServer(server: Server) {
  await new Promise((resolve) => server.close(resolve));
}

test("POST /api/screen-flows/import stores captured screens as ordered flow nodes", async () => {
  const generatedDir = join(TEST_DIR, "generated");
  const { server, port } = await startApp(generatedDir);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://127.0.0.1:5173",
        flowName: "Checkout flow",
        layout: "horizontal",
        screens: [
          { url: "/cart", title: "Cart", image: await pngDataUrl("#ff0000") },
          { url: "/checkout", title: "Checkout", note: "payment step", image: await pngDataUrl("#00ff00") },
        ],
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.imported.length, 2);
    assert.equal(body.session.nodes.length, 2);
    assert.equal(body.session.edges.length, 1);
    assert.equal(body.session.edges[0].source, body.imported[0].clientNodeId);
    assert.equal(body.session.edges[0].target, body.imported[1].clientNodeId);
    assert.equal(body.session.nodes[0].data.kind, undefined);
    assert.equal(body.session.nodes[0].data.screenFlow.screenUrl, "http://127.0.0.1:5173/cart");
    assert.equal(body.session.nodes[1].data.screenFlow.index, 1);
    assert.equal(body.session.graphVersion, body.graphVersion);
    const files = await readdir(generatedDir);
    assert.equal(files.filter((file) => file.endsWith(".png")).length, 2);
    assert.equal(files.filter((file) => file.endsWith(".png.json")).length, 2);
  } finally {
    await closeServer(server);
  }
});

test("screen flow import appends to an existing session using the current graph version", async () => {
  const generatedDir = join(TEST_DIR, "generated-existing");
  const session = sessionStore.createSession({ title: "Existing flow" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [{ id: "existing", x: 0, y: 0, data: { clientId: "existing", serverNodeId: null, status: "empty" } }],
    edges: [],
  });
  const { server, port } = await startApp(generatedDir);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        baseUrl: "http://localhost:3000",
        screens: [{ url: "/dashboard", image: await pngDataUrl("#0000ff") }],
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.session.nodes.length, 2);
    assert.equal(body.session.graphVersion, 2);
    assert.ok(body.session.nodes.some((node: { id: string }) => node.id === "existing"));
  } finally {
    await closeServer(server);
  }
});

test("POST /api/screen-flows/import-adb captures the current ADB device screen", async () => {
  const generatedDir = join(TEST_DIR, "generated-adb");
  const fakePng = join(TEST_DIR, "adb-screen.png");
  const fakeAdb = join(TEST_DIR, "fake-adb");
  await pngFile(fakePng, "#ffaa00");
  writeFakeAdb(fakeAdb, fakePng);
  const originalAdbPath = process.env.IMA2_ADB_PATH;
  process.env.IMA2_ADB_PATH = fakeAdb;
  const { server, port } = await startApp(generatedDir);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import-adb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Wallet home",
        flowName: "Mobile smoke",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.imported.length, 1);
    assert.equal(body.session.nodes.length, 1);
    assert.equal(body.session.nodes[0].data.screenFlow.title, "Wallet home");
    assert.match(body.session.nodes[0].data.screenFlow.screenUrl, /\/adb\/emulator-5554\//);
    assert.equal(body.session.nodes[0].data.size, "1184x2560");
    assert.equal(body.session.nodes[0].data.sizeMode, "fixed");
    assert.equal(body.session.nodes[0].data.sizeOverride, "1184x2560");
    const files = await readdir(generatedDir);
    assert.equal(files.filter((file) => file.endsWith(".png")).length, 1);
  } finally {
    if (originalAdbPath) process.env.IMA2_ADB_PATH = originalAdbPath;
    else delete process.env.IMA2_ADB_PATH;
    await closeServer(server);
  }
});

test("screen flow import rejects remote URLs and missing captures", async () => {
  const generatedDir = join(TEST_DIR, "generated-reject");
  const { server, port } = await startApp(generatedDir);
  try {
    const remote = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://example.com",
        screens: [{ url: "/", image: await pngDataUrl("#000000") }],
      }),
    });
    assert.equal(remote.status, 400);
    const missing = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:3000",
        screens: [{ url: "/" }],
      }),
    });
    const body = await missing.json();
    assert.equal(missing.status, 400);
    assert.equal(body.error.code, "SCREEN_IMAGE_REQUIRED");
    const malformed = await fetch(`http://127.0.0.1:${port}/api/screen-flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "not-a-url",
        screens: [{ url: "/", image: await pngDataUrl("#000000") }],
      }),
    });
    const malformedBody = await malformed.json();
    assert.equal(malformed.status, 400);
    assert.equal(malformedBody.error.code, "SCREEN_FLOW_BAD_BASE_URL");
  } finally {
    await closeServer(server);
  }
});
