import { memo, useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore, type ImageNodeData, type GraphNode } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { getImageModelShortLabel } from "../lib/imageModels";
import { postPromptBuilderChat } from "../lib/api";
import { extractPromptBuilderFinalPrompts } from "../lib/promptBuilder/structuredOutput";
import { SavePromptPopover } from "./SavePromptPopover";

const MAX_NODE_REFS = 5;
const NODE_PREVIEW_HEIGHT = 240;
const NODE_PREVIEW_MIN_WIDTH = 180;
const NODE_PREVIEW_MAX_WIDTH = 420;
const PROMPT_ENHANCE_TIMEOUT_MS = 20_000;
const NODE_HANDLE_POSITIONS = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function getPreviewWidth(size?: string | null): number {
  const match = /^(\d+)x(\d+)$/.exec(size ?? "");
  if (!match) return NODE_PREVIEW_HEIGHT;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return NODE_PREVIEW_HEIGHT;
  }
  const scaledWidth = NODE_PREVIEW_HEIGHT * (width / height);
  return Math.round(
    Math.min(NODE_PREVIEW_MAX_WIDTH, Math.max(NODE_PREVIEW_MIN_WIDTH, scaledWidth)),
  );
}

function buildEnhancedNodePrompt(prompt: string, data: ImageNodeData): string {
  const request = prompt.trim() || "이 화면을 가독성 좋게 개선해줘.";
  const isScreenEdit = Boolean(data.screenFlow || data.parentServerNodeId || data.imageUrl);
  const screenTitle = data.screenFlow?.title?.trim() || "";
  const targetText = `${screenTitle}\n${request}`.toLowerCase();
  const isDappScreen = /\bdapp\b|dapp|디앱|댑|브라우저/.test(targetText);
  if (!isScreenEdit) {
    return [
      request,
      "",
      "위 요청의 핵심 의도만 유지해서 조금 더 구체적인 이미지 생성 프롬프트로 다듬어줘.",
      "사용자가 말하지 않은 새 주제, 장면, 기능, 텍스트, 구성 요소는 추가하지 마.",
    ].join("\n");
  }
  return [
    request,
    screenTitle ? `현재 화면: ${screenTitle}` : "",
    isDappScreen ? "현재 화면 목적: DAPP 브라우저/탐색 화면 유지" : "",
    "",
    "첨부된 현재 화면을 기준으로, 위 요청에서 말한 부분만 더 명확하게 수정해줘.",
    "화면 종류, 핵심 기능, 기존 정보 구조는 유지하고, 사용자가 말하지 않은 새 섹션이나 기능은 추가하지 마.",
    "표현은 짧고 직접적인 이미지 수정 프롬프트로 정리해줘.",
  ].filter(Boolean).join("\n");
}

function getPreferredPromptBuilderText(content: string): string {
  const structured = extractPromptBuilderFinalPrompts(content);
  const korean = structured?.prompts.find((prompt) => prompt.language === "ko");
  const first = structured?.prompts[0];
  return (korean?.text || first?.text || content).trim();
}

function buildPromptEnhanceRequest(prompt: string, data: ImageNodeData): string {
  const draft = buildEnhancedNodePrompt(prompt, data);
  const screenTitle = data.screenFlow?.title?.trim() || "";
  const screenUrl = data.screenFlow?.screenUrl?.trim() || "";
  return [
    "아래 노드 프롬프트를 사용자가 쓴 의도 안에서만 조금 더 구체화해줘.",
    "반드시 Structured final prompt format으로 답하고, 질문하지 말고 바로 결과를 줘.",
    "한국어 최종 프롬프트는 2~4문장 정도의 짧은 이미지 수정 요청이어야 해.",
    "중요: 새 화면 기획을 만들지 말고, 사용자가 입력한 내용의 모호한 표현만 구체화해.",
    "사용자가 직접 쓰지 않은 새 섹션, 새 기능, 새 콘텐츠, 새 CTA, 새 브랜드 요소를 추가하지 마.",
    "현재 화면 제목과 URL은 화면 목적을 유지하기 위한 참고 정보로만 사용해.",
    "DAPP 화면이면 DAPP 화면 목적을 유지하되, 사용자가 요청하지 않은 홈/월렛/잔액/뉴스/최근 활동 구성을 추가하지 마.",
    screenTitle ? `현재 화면 제목: ${screenTitle}` : "",
    screenUrl ? `현재 화면 URL: ${screenUrl}` : "",
    "",
    "노드 프롬프트:",
    draft,
  ].filter(Boolean).join("\n");
}

function ImageNodeImpl({ id, data, selected }: NodeProps<GraphNode>) {
  const { t } = useI18n();
  const d = data as ImageNodeData;
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const updateScreenFlowTitle = useAppStore((s) => s.updateScreenFlowTitle);
  const addNodeReferences = useAppStore((s) => s.addNodeReferences);
  const readDroppedImageMetadata = useAppStore((s) => s.readDroppedImageMetadata);
  const removeNodeReference = useAppStore((s) => s.removeNodeReference);
  const generateNode = useAppStore((s) => s.generateNode);
  const generateNodeInPlace = useAppStore((s) => s.generateNodeInPlace);
  const generateNodeVariation = useAppStore((s) => s.generateNodeVariation);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const refs = d.referenceImages ?? [];
  const isBusy = d.status === "pending" || d.status === "reconciling";
  const canAttachRefs = !isBusy && refs.length < MAX_NODE_REFS;
  const nodeStyle = {
    "--node-preview-w": `${getPreviewWidth(d.size)}px`,
    "--node-preview-h": `${NODE_PREVIEW_HEIGHT}px`,
  } as CSSProperties;

  const onPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => updateNodePrompt(id, e.target.value),
    [id, updateNodePrompt],
  );
  const onEnhancePrompt = useCallback(async () => {
    if (enhancingPrompt) return;
    setEnhancingPrompt(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PROMPT_ENHANCE_TIMEOUT_MS);
    try {
      const result = await postPromptBuilderChat({
        model: "gpt-5.5",
        messages: [{
          role: "user",
          content: buildPromptEnhanceRequest(d.prompt, d),
        }],
        context: {
          currentPrompt: d.prompt,
          settings: {
            mode: "node",
            size: d.sizeOverride || d.size || "1184x2560",
            screenTitle: d.screenFlow?.title,
            screenUrl: d.screenFlow?.screenUrl,
            nodeStatus: d.status,
          },
        },
      }, {
        signal: controller.signal,
      });
      updateNodePrompt(id, getPreferredPromptBuilderText(result.message.content));
    } catch (error) {
      console.warn("[node prompt enhance] failed", error);
      updateNodePrompt(id, buildEnhancedNodePrompt(d.prompt, d));
    } finally {
      window.clearTimeout(timer);
      setEnhancingPrompt(false);
    }
  }, [id, d, enhancingPrompt, updateNodePrompt]);
  const onScreenFlowTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateScreenFlowTitle(id, e.target.value),
    [id, updateScreenFlowTitle],
  );

  const onGenerate = useCallback(() => {
    void generateNode(id);
  }, [id, generateNode]);

  const onRegenerateInPlace = useCallback(() => {
    void generateNodeInPlace(id);
  }, [id, generateNodeInPlace]);

  const onNewVariation = useCallback(() => {
    void generateNodeVariation(id);
  }, [id, generateNodeVariation]);

  const onBranch = useCallback(() => {
    if (d.status !== "ready") return;
    addChildNode(id);
  }, [id, d.status, addChildNode]);

  const onDuplicateBranch = useCallback(() => {
    duplicateBranchRoot(id);
  }, [id, duplicateBranchRoot]);

  const onDelete = useCallback(() => deleteNode(id), [id, deleteNode]);
  const onOpenZoom = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setZoomOpen(true);
  }, []);
  const onCloseZoom = useCallback(() => setZoomOpen(false), []);

  useEffect(() => {
    if (!zoomOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomOpen]);

  const extractClipboardImages = (items: DataTransferItemList | null): File[] => {
    if (!items) return [];
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind !== "file") continue;
      if (!it.type.startsWith("image/")) continue;
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    return files;
  };

  const handleNodeImageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      const handled = await readDroppedImageMetadata(files[0], id);
      if (handled) return;
    }
    await addNodeReferences(id, files);
  };

  const onDropRefs = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 1) {
      const handled = await readDroppedImageMetadata(files[0], id);
      if (handled) return;
    }
    if (!canAttachRefs) return;
    if (files.length > 0) void addNodeReferences(id, files);
  };

  const onDragOverRefs = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (canAttachRefs && !isDraggingRef) setIsDraggingRef(true);
  };

  const onDragLeaveRefs = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingRef(false);
  };

  const onPasteRefs = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = extractClipboardImages(e.clipboardData?.items ?? null);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!canAttachRefs) return;
    const room = MAX_NODE_REFS - refs.length;
    void addNodeReferences(id, files.slice(0, room));
  };

  const computeStatusLabel = (): string => {
    switch (d.status) {
      case "empty":
        return t("node.empty");
      case "pending":
        return t("node.pending");
      case "reconciling":
        return d.pendingPhase
          ? t("node.reconcilingPhase", { phase: d.pendingPhase })
          : t("node.reconciling");
      case "ready":
        return [
          d.webSearchCalls
            ? t("node.readyWithSearch", {
              elapsed: d.elapsed ?? "?",
              searches: d.webSearchCalls,
            })
            : t("node.ready", { elapsed: d.elapsed ?? "?" }),
          getImageModelShortLabel(d.model),
        ].filter(Boolean).join(" · ");
      case "stale":
        return d.error
          ? t("node.staleWithError", { error: d.error })
          : t("node.stale");
      case "asset-missing":
        return d.error
          ? t("node.assetMissingWithError", { error: d.error })
          : t("node.assetMissing");
      case "error":
        return t("node.error", { error: d.error ?? t("node.errorUnknown") });
      default:
        return "";
    }
  };
  const statusLabel = computeStatusLabel();

  return (
    <div
      className={`image-node image-node--${d.status}${selected ? " image-node--selected" : ""}`}
      style={nodeStyle}
    >
      {NODE_HANDLE_POSITIONS.map(({ id: handleId, position }) => (
        <Handle
          key={`target-${handleId}`}
          type="target"
          id={`target-${handleId}`}
          position={position}
          className={`image-node__handle image-node__handle--target image-node__handle--${handleId}`}
        />
      ))}
      <div className="image-node__preview">
        {d.imageUrl && d.status !== "asset-missing" ? (
          <button
            type="button"
            className="image-node__preview-button nodrag"
            onClick={onOpenZoom}
            title={t("node.zoomImageTitle")}
            aria-label={t("node.zoomImageTitle")}
          >
            <img src={d.imageUrl} alt={t("node.nodeImageAlt")} />
          </button>
        ) : isBusy && d.partialImageUrl ? (
          <img
            className="image-node__partial"
            src={d.partialImageUrl}
            alt={t("node.partialImageAlt")}
          />
        ) : isBusy ? (
          <div className="image-node__skeleton" role="status" aria-label={t("node.pending")}>
            <span className="image-node__loader" />
            <span>{d.pendingPhase || t("node.pending")}</span>
          </div>
        ) : d.status === "asset-missing" ? (
          <div className="image-node__placeholder">{t("node.noAsset")}</div>
        ) : d.status === "stale" ? (
          <div className="image-node__placeholder">{t("node.stateStale")}</div>
        ) : (
          <div className="image-node__placeholder">{t("node.noImage")}</div>
        )}
      </div>
      {d.screenFlow ? (
        <div className="image-node__screen-meta">
          <span>{d.screenFlow.index != null ? `#${d.screenFlow.index + 1}` : t("node.screenFlow")}</span>
          <input
            className="image-node__screen-title nodrag"
            value={d.screenFlow.title || ""}
            onChange={onScreenFlowTitleChange}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t("node.screenTitlePlaceholder")}
          />
          {d.screenFlow.screenUrl ? <small>{d.screenFlow.screenUrl}</small> : null}
        </div>
      ) : null}
      <div
        className={`image-node__composer nodrag${isDraggingRef ? " is-dragging" : ""}`}
        onDrop={onDropRefs}
        onDragOver={onDragOverRefs}
        onDragLeave={onDragLeaveRefs}
        onPaste={onPasteRefs}
      >
        {refs.length > 0 ? (
          <div className="image-node__refs">
            {refs.map((src, i) => (
              <div
                key={i}
                className="image-node__ref-chip"
                title={t("node.refAlt", { n: i + 1 })}
              >
                <img src={src} alt={t("node.refAlt", { n: i + 1 })} />
                <button
                  type="button"
                  className="image-node__ref-remove"
                  onClick={() => removeNodeReference(id, i)}
                  disabled={isBusy}
                  aria-label={t("node.removeRef", { n: i + 1 })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="image-node__prompt"
          value={d.prompt}
          onChange={onPromptChange}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={d.parentServerNodeId ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
          rows={2}
          disabled={isBusy}
        />
        <div className="image-node__composer-bar">
          <div className="image-node__composer-tools">
            <button
              type="button"
              className="image-node__tool-btn"
              onClick={onEnhancePrompt}
              disabled={isBusy || enhancingPrompt}
              title={t("node.enhancePromptTitle")}
              aria-label={t("node.enhancePromptTitle")}
            >
              {enhancingPrompt ? "…" : "✎"}
            </button>
            <button
              type="button"
              className="image-node__attach"
              onClick={() => canAttachRefs && fileInput.current?.click()}
              disabled={!canAttachRefs}
              title={d.parentServerNodeId ? t("node.nodeRefsUsedWithParent") : t("node.attachRefTitle")}
            >
              {t("node.attachRef")}
            </button>
          </div>
          {isDraggingRef ? (
            <span className="image-node__drop-hint">{t("node.dropRefs")}</span>
          ) : refs.length > 0 ? (
            <span className="image-node__ref-count">{refs.length}/{MAX_NODE_REFS}</span>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void handleNodeImageFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="image-node__footer nodrag">
        <span className="image-node__status" title={statusLabel}>{statusLabel}</span>
        <div className="image-node__actions">
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              disabled={!d.prompt?.trim()}
              title={t("promptLibrary.saveTitle")}
              aria-label={t("promptLibrary.saveTitle")}
            >
              ☆
            </button>
            {saveOpen && (
              <SavePromptPopover
                text={d.prompt || ""}
                onClose={() => setSaveOpen(false)}
              />
            )}
          </div>
          {d.status === "ready" ? (
            <>
              <button type="button" onClick={onRegenerateInPlace} disabled={isBusy} title={t("node.regenerateTitle")} aria-label={t("node.regenerateTitle")}>
                ↻
              </button>
              <button type="button" onClick={onNewVariation} disabled={isBusy} title={t("node.newVariationTitle")} aria-label={t("node.newVariationTitle")}>
                {t("node.newVariation")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="image-node__generate"
              onClick={onGenerate}
              disabled={isBusy}
              title={t("node.generateTitle")}
              aria-label={t("node.generateTitle")}
            >
              {t("node.generate")}
            </button>
          )}
          {d.status === "ready" ? (
            <>
              <button
                type="button"
                onClick={onBranch}
                title={t("node.addChildTitle")}
                aria-label={t("node.addChildTitle")}
              >
                {t("node.addChild")}
              </button>
              <button
                type="button"
                onClick={onDuplicateBranch}
                title={t("node.duplicateBranchTitle")}
                aria-label={t("node.duplicateBranchTitle")}
              >
                {t("node.duplicateBranch")}
              </button>
            </>
          ) : null}
          <button type="button" onClick={onDelete} className="image-node__del" title={t("node.deleteTitle")} aria-label={t("node.deleteTitle")}>×</button>
        </div>
      </div>
      {NODE_HANDLE_POSITIONS.map(({ id: handleId, position }) => (
        <Handle
          key={`source-${handleId}`}
          type="source"
          id={`source-${handleId}`}
          position={position}
          className={`image-node__handle image-node__handle--source image-node__handle--${handleId}`}
        />
      ))}
      {zoomOpen && d.imageUrl ? createPortal(
        <div
          className="node-image-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={t("node.zoomImageTitle")}
          onClick={onCloseZoom}
        >
          <button
            type="button"
            className="node-image-zoom__close"
            onClick={onCloseZoom}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            ×
          </button>
          <img
            src={d.imageUrl}
            alt={t("node.nodeImageAlt")}
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export const ImageNode = memo(ImageNodeImpl);
