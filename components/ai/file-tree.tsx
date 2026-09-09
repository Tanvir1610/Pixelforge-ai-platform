import {
  FileCode2, Home, LayoutGrid, Navigation, Palette, RectangleHorizontal, Ruler, Type as TypeIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FILE_TREE } from "@/lib/data";

const PAGE_ICONS: Record<string, React.ElementType> = {
  Home, About: LayoutGrid, Pricing: RectangleHorizontal, Contact: FileCode2,
};

const TOKEN_ICONS: Record<string, React.ElementType> = {
  "colors.css": Palette, "typography.css": TypeIcon, "spacing.css": Ruler,
};

function statusTone(status: string) {
  if (status === "Done") return "success" as const;
  if (status === "Queued") return "neutral" as const;
  return "accent" as const;
}

/** Left rail of the generation workspace: what exists in the project right now. */
export function ProjectTree({ activePage = "Home" }: { activePage?: string }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto border-r border-border bg-bg-surface scrollbar-thin">
      <h2 className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold text-content-muted">Pages</h2>
      <ul>
        {FILE_TREE.pages.map((page) => {
          const Icon = PAGE_ICONS[page.name] ?? FileCode2;
          const active = page.name === activePage;
          return (
            <li key={page.name}>
              <a
                href="#main"
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 text-body-sm",
                  active ? "bg-accent-soft text-[#3730A3] [&_svg]:text-accent" : "text-content-secondary [&_svg]:text-content-muted hover:bg-bg-subtle",
                )}
              >
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{page.name}</span>
                <Badge tone={statusTone(page.status)} className="h-[18px] px-1.5 text-[11px]">{page.status}</Badge>
              </a>
            </li>
          );
        })}
      </ul>

      <h2 className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold text-content-muted">Components</h2>
      <ul>
        {FILE_TREE.components.map((component) => (
          <li key={component}>
            <a href="#main" className="flex items-center gap-2 px-4 py-1.5 text-body-sm text-content-secondary hover:bg-bg-subtle">
              <Navigation aria-hidden className="h-3.5 w-3.5 shrink-0 text-content-muted" />
              <span className="truncate">{component}</span>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold text-content-muted">Tokens</h2>
      <ul className="pb-4">
        {FILE_TREE.tokens.map((token) => {
          const Icon = TOKEN_ICONS[token] ?? Palette;
          return (
            <li key={token}>
              <a href="#main" className="flex items-center gap-2 px-4 py-1.5 text-body-sm text-content-secondary hover:bg-bg-subtle">
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-content-muted" />
                <span className="truncate">{token}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
