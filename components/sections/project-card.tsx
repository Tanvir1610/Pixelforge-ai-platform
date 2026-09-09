import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { toProjectCard } from "@/lib/presenters/project";
import type { ProjectRow } from "@/lib/db/database.types";

export function ProjectCard({ project }: { project: ProjectRow }) {
  const card = toProjectCard(project);

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-bg-surface">
      <div className="relative h-[150px] border-b border-border bg-bg-subtle">
        <Badge tone={card.status.tone} dot={card.status.dot} className="absolute right-2.5 top-2.5 z-10">
          {card.status.label}
        </Badge>
        <ScaledSite scale={0.72} height={150}>
          <MiniSite brand={card.brand} headline={card.headline} dark={card.dark} />
        </ScaledSite>
      </div>
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-body font-semibold">{card.name}</h3>
          <MoreHorizontal aria-hidden className="h-4 w-4 shrink-0 text-content-muted" />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-content-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 rounded-[3px]" style={{ background: card.frameworkColour }} />
            {card.frameworkLabel}
          </span>
          <span aria-hidden>·</span>
          <span>{card.stylingLabel}</span>
          <span aria-hidden>·</span>
          <span>{card.editedAt}</span>
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-bg px-4 py-2.5">
        <span className="truncate text-caption text-content-muted">{card.meta}</span>
        <Link href={`/project/${card.slug}/preview`} className={buttonClasses("secondary", "sm")}>
          Open<span className="sr-only"> {card.name}</span>
        </Link>
      </div>
    </li>
  );
}
