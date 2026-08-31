import type { ReactNode } from "react";
import { RESEARCH_GROUPS, researchGroupFor, type ResearchPage } from "../lib/navigation";

export type NavigateResearch = (page: ResearchPage) => void;

export function ResearchLink({ page, onNavigate, children, className, current, label }: {
  page: ResearchPage; onNavigate: NavigateResearch; children: ReactNode;
  className?: string; current?: boolean; label?: string;
}) {
  return <a href={`#${page}`} className={className} aria-current={current ? "page" : undefined} aria-label={label} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(page);
  }}>{children}</a>;
}

export function ResearchHeader({ page, onNavigate }: { page: ResearchPage; onNavigate: NavigateResearch }) {
  const group = researchGroupFor(page);
  return <header className="site-header public-header">
    <ResearchLink page="overview" onNavigate={onNavigate} className="brand" label="ForecastBench research home">
      <span className="brand-orbit" aria-hidden="true"><i /></span>
      <span><strong>ForecastBench</strong><small>RESEARCH ATLAS</small></span>
    </ResearchLink>
    <nav aria-label="Primary navigation">
      <ResearchLink page="overview" onNavigate={onNavigate} current={page === "overview"}>Overview</ResearchLink>
      {RESEARCH_GROUPS.map((item) => <ResearchLink key={item.id} page={item.sections[0].id} onNavigate={onNavigate} current={item.id === group?.id}>{item.label}</ResearchLink>)}
    </nav>
    <a className="source-link" href="https://github.com/ChengPeng9660/forecastbench-event-type-correlation" target="_blank" rel="noreferrer" aria-label="View source on GitHub">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.57.1.78-.25.78-.55v-2.13c-3.18.69-3.85-1.35-3.85-1.35-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.67 1.25 3.32.95.1-.74.4-1.25.73-1.54-2.54-.29-5.21-1.27-5.21-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.13 1.17a10.9 10.9 0 0 1 5.7 0c2.17-1.48 3.13-1.17 3.13-1.17.62 1.58.23 2.75.12 3.04.73.8 1.17 1.82 1.17 3.07 0 4.4-2.67 5.37-5.22 5.66.41.36.78 1.05.78 2.12v3.14c0 .31.21.66.79.55A11.4 11.4 0 0 0 12 .8Z" /></svg>
      <span>Source</span><span aria-hidden="true">↗</span>
    </a>
  </header>;
}

export function ResearchMasthead({ page, onNavigate }: { page: ResearchPage; onNavigate: NavigateResearch }) {
  const group = researchGroupFor(page);
  if (!group) return null;
  return <>
    {page !== "complementarity" && <section className="research-masthead" aria-label={`${group.label} introduction`}>
      <p className="eyebrow">FORECASTBENCH / {group.label}</p>
      <h1>{group.title}</h1>
      <p>{group.description}</p>
    </section>}
    <nav className="research-section-nav" aria-label="Research sections">
      {group.sections.map((section) => <ResearchLink key={section.id} page={section.id} onNavigate={onNavigate} current={section.id === page}>{section.label}</ResearchLink>)}
    </nav>
  </>;
}

/** Keep visited experiments mounted so switching views never silently resets their controls. */
export function ResearchPanel({ page, active, visited, children }: {
  page: ResearchPage; active: ResearchPage; visited: ReadonlySet<ResearchPage>; children: ReactNode;
}) {
  if (!visited.has(page)) return null;
  return <div className="research-panel" data-page={page} hidden={active !== page}>{children}</div>;
}

export function ResearchPending({ id, error }: { id: string; error?: string }) {
  return <section id={id} className="research-pending" aria-live="polite" aria-busy={!error}>
    <span className="research-pending-mark" aria-hidden="true">{error ? "!" : "···"}</span>
    <h2>{error ? "This experiment is unavailable" : "Loading this experiment"}</h2>
    <p>{error || "Preparing the published results…"}</p>
    {error && <button type="button" className="research-button" onClick={() => window.location.reload()}>Try again</button>}
  </section>;
}
