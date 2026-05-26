import { useState } from "react";
import type { FormEvent } from "react";
import { useAppStore } from "../store/useAppStore";

export function ProjectSelector() {
  const projects = useAppStore((s) => s.projects);
  const loading = useAppStore((s) => s.projectLoading);
  const selectProject = useAppStore((s) => s.selectProject);
  const createProject = useAppStore((s) => s.createAndSelectProject);
  const [title, setTitle] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    void createProject(clean);
    setTitle("");
  };

  return (
    <main className="project-gate" aria-busy={loading ? "true" : undefined}>
      <section className="project-gate__panel" aria-labelledby="project-gate-title">
        <div className="project-gate__header">
          <p className="project-gate__eyebrow">ima2-gen</p>
          <h1 id="project-gate-title">프로젝트 선택</h1>
          <p>작업 공간을 선택하세요.</p>
        </div>

        <div className="project-gate__list">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="project-gate__item"
              onClick={() => void selectProject(project.id)}
            >
              <span>
                <strong>{project.title}</strong>
                <small>{project.sessionCount} sessions</small>
              </span>
              <span className="project-gate__arrow">열기</span>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="project-gate__empty">프로젝트를 새로 만들어 시작하세요.</div>
          )}
        </div>

        <form className="project-gate__create" onSubmit={submit}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="새 프로젝트 이름"
            maxLength={200}
          />
          <button type="submit" disabled={!title.trim()}>생성</button>
        </form>
      </section>
    </main>
  );
}
