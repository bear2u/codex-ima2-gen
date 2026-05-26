import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = readFileSync("ui/src/store/useAppStore.ts", "utf-8");
const api = readFileSync("ui/src/lib/nodeApi.ts", "utf-8");
const refs = readFileSync("ui/src/lib/nodeRefStorage.ts", "utf-8");

describe("node child reference payload contract", () => {
  it("sends node references even when parentNodeId is present", () => {
    assert.match(store, /parentNodeId: effectiveParentServerNodeId/);
    assert.match(store, /\.\.\(nodeRefs\.length\s*\?\s*\{ references: nodeRefs\.map\(stripDataUrlPrefix\) \}/);
    assert.doesNotMatch(store, /nodeRefs\.length && !effectiveParentServerNodeId/);
  });

  it("declares explicit node context and search policy on node requests", () => {
    assert.match(api, /contextMode\?: "parent-plus-refs" \| "parent-only" \| "ancestry"/);
    assert.match(api, /searchMode\?: "off" \| "auto" \| "on"/);
    assert.match(api, /webSearchEnabled\?: boolean/);
    assert.match(store, /contextMode: "parent-plus-refs"/);
    assert.match(store, /searchMode: s\.webSearchEnabled \? "on" : "off"/);
    assert.match(store, /webSearchEnabled: s\.webSearchEnabled/);
  });

  it("persists node-local refs outside sanitized graph payload", () => {
    assert.match(refs, /STORAGE_KEY = "ima2\.nodeRefs\.v1"/);
    assert.match(store, /loadNodeRefs\(session\.id, n\.id\)/);
    assert.match(store, /saveNodeRefs\(sessionId, clientId, refs\)/);
  });

  it("compresses generated-image references before reusing them for i2i", () => {
    assert.match(store, /async function compressReferenceSource\(src: string,\s*filename = "reference\.png"\)/);
    assert.match(store, /new File\(\[blob\], filename, \{ type: blob\.type \|\| "image\/png" \}\)/);
    assert.match(store, /compressToBase64\(file,\s*\{[\s\S]*preserveTransparency:\s*false/);
    assert.match(store, /dataUrl = await compressReferenceSource\(cur\.image,\s*cur\.filename \|\| "current-reference\.png"\)/);
    assert.match(store, /const dataUrl = await compressReferenceSource\(sourceUrl,\s*"node-reference\.png"\)/);
    assert.doesNotMatch(store, /useCurrentAsReference:[\s\S]*?readAsDataURL\(blob\);[\s\S]*?addedCurrentAsRef/);
  });

  it("uses the current root image as parent context for visual variations", () => {
    assert.match(store, /function buildNodeRequestPrompt/);
    assert.match(store, /visualRedesign\?: boolean/);
    assert.match(store, /원본 스크린샷을 거의 그대로 복사한 것처럼 보이지 않게/);
    assert.match(store, /!incoming && source\.data\.serverNodeId/);
    assert.match(store, /const targetClientId = get\(\)\.addChildNode\(clientId\)/);
    assert.match(store, /parentServerNodeIdOverride: source\.data\.serverNodeId/);
    assert.match(store, /visualRedesign: true/);
  });
});
