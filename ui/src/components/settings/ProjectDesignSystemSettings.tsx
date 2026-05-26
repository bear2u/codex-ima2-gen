import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";

export function ProjectDesignSystemSettings() {
  const { t } = useI18n();
  const systems = useAppStore((s) => s.projectDesignSystems);
  const library = useAppStore((s) => s.designSystemLibrary);
  const activeId = useAppStore((s) => s.activeDesignSystemId);
  const loading = useAppStore((s) => s.designSystemLoading);
  const importMarkdown = useAppStore((s) => s.importDesignSystemMarkdown);
  const importFromLibrary = useAppStore((s) => s.importDesignSystemFromLibrary);
  const setActive = useAppStore((s) => s.setActiveDesignSystem);
  const deleteSystem = useAppStore((s) => s.deleteDesignSystem);
  const previewLibrary = useAppStore((s) => s.previewLibraryDesignSystem);
  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const active = useMemo(
    () => systems.find((system) => system.id === activeId) ?? null,
    [activeId, systems],
  );
  const selectedLibrary = libraryId || library[0]?.id || "";

  const onImportMarkdown = () => {
    if (!body.trim()) return;
    void importMarkdown(body, slug.trim() || undefined);
    setSlug("");
    setBody("");
  };

  const onPreviewLibrary = async () => {
    if (!selectedLibrary) return;
    setPreview(await previewLibrary(selectedLibrary));
  };

  return (
    <div className="design-system-settings" aria-busy={loading ? "true" : undefined}>
      <div className="design-system-settings__active">
        <strong>{active ? active.title : t("designSystem.noneActive")}</strong>
        {active?.swatches?.length ? (
          <span className="design-system-settings__swatches" aria-hidden="true">
            {active.swatches.map((color, index) => (
              <span key={`${color}-${index}`} style={{ background: color }} />
            ))}
          </span>
        ) : null}
        {active ? (
          <button type="button" className="settings-action-btn" onClick={() => void setActive(null)}>
            {t("designSystem.clearActive")}
          </button>
        ) : null}
      </div>

      <div className="design-system-settings__list">
        {systems.map((system) => (
          <div key={system.id} className="design-system-settings__item">
            <button
              type="button"
              className={system.id === activeId ? "is-active" : ""}
              onClick={() => void setActive(system.id)}
            >
              <span>{system.title}</span>
              <small>{system.summary || system.category}</small>
            </button>
            <button type="button" onClick={() => setPreview(system.body ?? null)}>
              {t("designSystem.preview")}
            </button>
            <button type="button" onClick={() => void deleteSystem(system.id)}>
              {t("common.delete")}
            </button>
          </div>
        ))}
      </div>

      <div className="design-system-settings__import">
        <input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder={t("designSystem.slugPlaceholder")}
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("designSystem.bodyPlaceholder")}
          spellCheck={false}
        />
        <button type="button" className="settings-action-btn" disabled={!body.trim()} onClick={onImportMarkdown}>
          {t("designSystem.importMarkdown")}
        </button>
      </div>

      <div className="design-system-settings__library">
        <select value={selectedLibrary} onChange={(event) => setLibraryId(event.target.value)}>
          {library.length === 0 ? (
            <option value="">{t("designSystem.libraryUnavailable")}</option>
          ) : library.map((system) => (
            <option key={system.id} value={system.id}>
              {system.title}
            </option>
          ))}
        </select>
        <button type="button" disabled={!selectedLibrary} onClick={onPreviewLibrary}>
          {t("designSystem.preview")}
        </button>
        <button
          type="button"
          className="settings-action-btn"
          disabled={!selectedLibrary}
          onClick={() => void importFromLibrary(selectedLibrary)}
        >
          {t("designSystem.importLibrary")}
        </button>
      </div>

      {preview ? (
        <pre className="design-system-settings__preview">{preview}</pre>
      ) : null}
    </div>
  );
}
