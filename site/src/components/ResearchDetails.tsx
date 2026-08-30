import type { ReactNode } from "react";

export function ResearchDetails({
  children,
  label = "Method & interpretation",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="research-details">
      <summary>{label}</summary>
      <div className="research-details-content">{children}</div>
    </details>
  );
}
