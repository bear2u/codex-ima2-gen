import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf8");
}

describe("screen flow UI contract", () => {
  test("Node Mode exposes ADB capture without the manual upload dialog", () => {
    const canvas = readSource("ui/src/components/NodeCanvas.tsx");
    assert.doesNotMatch(canvas, /ScreenFlowImportDialog/);
    assert.doesNotMatch(canvas, /nodeCanvas\.screenFlowOpen/);
    assert.match(canvas, /importAdbScreen/);
    assert.match(canvas, /nodeCanvas\.adbCapture/);
  });

  test("imported screen metadata renders inside image nodes", () => {
    const imageNode = readSource("ui/src/components/ImageNode.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    assert.match(imageNode, /image-node__screen-meta/);
    assert.match(imageNode, /image-node__screen-title/);
    assert.match(imageNode, /updateScreenFlowTitle/);
    assert.match(imageNode, /d\.screenFlow\.screenUrl/);
    assert.match(store, /screenFlow: d\.screenFlow/);
    assert.match(store, /updateScreenFlowTitle: \(clientId, title\)/);
  });

  test("store exposes an ADB capture action backed by the screen-flow API", () => {
    const api = readSource("ui/src/lib/api.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    assert.match(api, /\/api\/screen-flows\/import-adb/);
    assert.match(store, /apiImportAdbScreen/);
    assert.match(store, /nodeCanvas\.adbImported/);
  });

  test("pending nodes show loading inside the preview instead of an outer spinner", () => {
    const imageNode = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    assert.match(imageNode, /image-node__loader/);
    assert.match(imageNode, /role="status"/);
    assert.match(css, /image-node__skeleton[\s\S]*image-node-loading-sheen/);
    assert.doesNotMatch(css, /image-node-border-spin/);
    assert.doesNotMatch(css, /image-node--pending::before/);
  });

  test("node mode can override generation size and keep ADB captures on iPhone size", () => {
    const size = readSource("ui/src/lib/size.ts");
    const picker = readSource("ui/src/components/SizePicker.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const screenFlow = readSource("lib/screenFlowImport.ts");

    assert.match(size, /1184x2560/);
    assert.match(picker, /node-size-override/);
    assert.match(picker, /setNodeSizeOverride/);
    assert.match(store, /setNodeSizeOverride: \(clientId, mode/);
    assert.match(store, /function inheritNodeSizeData/);
    assert.match(store, /function resolveNodeGenerationSize/);
    assert.match(store, /resolveNodeGenerationSize\(node, s\)/);
    assert.match(screenFlow, /const IPHONE_NODE_SIZE = "1184x2560"/);
    assert.match(screenFlow, /sizeMode: "fixed"/);
    assert.match(screenFlow, /sizeOverride: IPHONE_NODE_SIZE/);
  });

  test("image nodes expose a prompt enhancer for screen redesign prompts", () => {
    const imageNode = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");
    const api = readSource("ui/src/lib/api.ts");

    assert.match(imageNode, /function buildEnhancedNodePrompt/);
    assert.match(imageNode, /postPromptBuilderChat/);
    assert.match(imageNode, /extractPromptBuilderFinalPrompts/);
    assert.match(imageNode, /function buildPromptEnhanceRequest/);
    assert.match(imageNode, /PROMPT_ENHANCE_TIMEOUT_MS/);
    assert.match(imageNode, /AbortController/);
    assert.match(api, /signal: init\?\.signal/);
    assert.match(imageNode, /사용자가 쓴 의도 안에서만 조금 더 구체화/);
    assert.match(imageNode, /2~4문장 정도의 짧은 이미지 수정 요청/);
    assert.match(imageNode, /새 화면 기획을 만들지 말고/);
    assert.match(imageNode, /사용자가 직접 쓰지 않은 새 섹션/);
    assert.match(imageNode, /홈\/월렛\/잔액\/뉴스\/최근 활동 구성을 추가하지 마/);
    assert.match(imageNode, /현재 화면 제목/);
    assert.match(imageNode, /onEnhancePrompt/);
    assert.match(imageNode, /node\.enhancePromptTitle/);
    assert.match(css, /image-node__tool-btn/);
    assert.match(ko, /"enhancePromptTitle"/);
    assert.match(en, /"enhancePromptTitle"/);
  });

  test("node preview images open a body-level zoom viewer on click", () => {
    const imageNode = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(imageNode, /createPortal/);
    assert.match(imageNode, /zoomOpen/);
    assert.match(imageNode, /image-node__preview-button/);
    assert.match(imageNode, /node-image-zoom/);
    assert.match(imageNode, /document\.body/);
    assert.match(imageNode, /event\.key === "Escape"/);
    assert.match(css, /node-image-zoom/);
    assert.match(css, /cursor:\s*zoom-in/);
    assert.match(ko, /"zoomImageTitle"/);
  });
});
