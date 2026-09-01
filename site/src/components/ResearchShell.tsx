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
