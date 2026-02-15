import { getUiCopy } from "../lib/i18n";
import type { ProjectsStatsItem } from "../lib/types";
import type { UiLanguage } from "../lib/types";

interface ProjectSidebarProps {
  projects: ProjectsStatsItem[];
  selectedProject: string;
  onSelectProject: (project: string) => void;
  language: UiLanguage;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const { projects, selectedProject, onSelectProject, language } = props;
  const copy = getUiCopy(language);
  const totalObservations = projects.reduce((acc, item) => acc + item.observations, 0);
  const totalSessions = projects.reduce((acc, item) => acc + item.sessions, 0);

  return (
    <aside className="project-sidebar">
      <h2>{copy.projects}</h2>
      <button
        type="button"
        className={`project-item ${selectedProject === "__all__" ? "active" : ""}`}
        onClick={() => onSelectProject("__all__")}
      >
        <span>{copy.allProjects}</span>
        <span className="stats">
          {totalObservations} {copy.observationsUnit} / {totalSessions} {copy.sessionsUnit}
        </span>
      </button>
      <div className="project-list">
        {projects.length === 0 ? <p className="muted">{copy.noProjects}</p> : null}
        {projects.map((project) => (
          <button
            type="button"
            key={project.project}
            className={`project-item ${selectedProject === project.project ? "active" : ""}`}
            onClick={() => onSelectProject(project.project)}
          >
            <span className="project-name">{project.project}</span>
            <span className="stats">
              {project.observations} {copy.observationsUnit} / {project.sessions} {copy.sessionsUnit}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
