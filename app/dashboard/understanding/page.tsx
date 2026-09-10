import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Boxes, Image as ImageIcon, LayoutGrid, MousePointer2,
  Navigation, RectangleHorizontal, RotateCw, SquareUser, Type as TypeIcon,
} from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { DESIGN_TOKENS, DETECTED_COMPONENTS } from "@/lib/data";
import { UnderstandingNav } from "./understanding-nav";
import { AnalysisSummary } from "./analysis-summary";
import { requireSession } from "@/lib/auth/session";
import { GenerateButton } from "@/components/ai/generate-button";
import { listProjects } from "@/lib/repositories/projects";
import { getLatestArtifact } from "@/lib/repositories/artifacts";
import { isInferenceConfigured } from "@/lib/ai/bootstrap";
import type { DesignAnalysis } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Design understanding" };

const ICONS: Record<string, React.ElementType> = {
  nav: Navigation, hero: LayoutGrid, button: RectangleHorizontal, card: Boxes,
  input: RectangleHorizontal, user: SquareUser, grid: LayoutGrid, footer: LayoutGrid,
};

const LAYOUT_TREE = [
  { depth: 0, tag: "page", name: "Home", detail: "1440 × 3820 · vertical stack, gap 0" },
  { depth: 1, tag: "header", name: "Navbar", detail: "sticky · horizontal, space-between, padding 0 80" },
  { depth: 1, tag: "section", name: "Hero", detail: "vertical, gap 20, padding 96 80" },
  { depth: 2, tag: null, name: "Heading", detail: "display 64/68" },
  { depth: 2, tag: null, name: "Body", detail: "max-width 52ch" },
  { depth: 2, tag: null, name: "Button group", detail: "horizontal, gap 12" },
  { depth: 1, tag: "section", name: "Feature grid", detail: "3 columns, gap 24, hug height" },
  { depth: 1, tag: "section", name: "Testimonial", detail: "centred, max-width 720" },
  { depth: 1, tag: "footer", name: "Footer", detail: "5 columns, gap 32" },
];

const RESPONSIVE = [
  { label: "Feature grid", rule: "3 → 2 → 1 column" },
  { label: "Navbar", rule: "Links collapse below 768px" },
  { label: "Section padding", rule: "80 → 40 → 20" },
  { label: "Display type", rule: "64 → 48 → 36" },
];

const INTERACTIONS = [
  { label: "Button — hover, focus, active, disabled", badge: "4 states", tone: "success" as const },
  { label: "Nav link — hover, current page", badge: "2 states", tone: "success" as const },
  { label: "Feature card — hover lift", badge: "1 state", tone: "success" as const },
  { label: "Input — focus ring, error", badge: "Inferred", tone: "warning" as const },
];

const ASSET_SUMMARY = [
  { icon: ImageIcon, label: "Images", detail: "8 · 1.9 MB" },
  { icon: MousePointer2, label: "Icons", detail: "11 · 24 KB" },
  { icon: Boxes, label: "SVG illustrations", detail: "2 · 61 KB" },
  { icon: TypeIcon, label: "Fonts", detail: "2 families" },
];

function Panel({ id, title, badge, children }: {
  id: string; title: string; badge?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-4 scroll-mt-20 overflow-hidden rounded-lg border border-border bg-bg-surface">
      <h2 className="flex items-center justify-between gap-3 border-b border-border px-[18px] py-3.5 text-body font-semibold">
        {title}
        {badge && <Badge>{badge}</Badge>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Generation runs from here, and each model call is a request of its own, so
 * the ceiling has to allow for one planner call rather than the platform's
 * default few seconds. The client asks for each build step separately.
 */
export const maxDuration = 300;

export default async function UnderstandingPage() {
  const session = await requireSession();
  const projects = session.demo ? [] : await listProjects(session, 1);
  const project = projects[0] ?? null;

  const analysis = project
    ? await getLatestArtifact<DesignAnalysis & { model?: string }>(project.id, "design_analysis")
    : null;

  const inferenceReady = isInferenceConfigured();
  const disabledReason = session.demo
    ? "Connect Supabase and import a design to run the analyst on real data."
    : !project
      ? "Create a project and import a design first."
      : !inferenceReady
        ? "No AI provider is configured. Set ANTHROPIC_API_KEY to enable the analyst."
        : undefined;

  return (
    <AppShell crumbs={[project?.name ?? "Projects", "Design understanding"]}>
      <PageHeading
        title="What we found in your design"
        description="Review before generating. Correcting a mapping here saves a refinement pass later."
        actions={
          <>
            {analysis && <Badge tone="success" dot className="mr-1">Analysis complete</Badge>}
            <button type="button" className={buttonClasses("secondary", "sm")}>
              <RotateCw />
              Re-analyse
            </button>
            {/* Was a link to /project/northwind/preview — a sample route that
                generated nothing. It now runs the pipeline. */}
            <Link
              href={project ? `/project/${project.id}/code` : "/dashboard/import"}
              className={buttonClasses("secondary", "sm")}
            >
              View code
              <ArrowRight />
            </Link>
          </>
        }
      />

      {/* The control that actually runs the pipeline. */}
      <div className="mb-6 max-w-[420px]">
        <GenerateButton canGenerate={Boolean(project && analysis)} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <UnderstandingNav />

        <div>
          <AnalysisSummary
            projectId={project?.id ?? null}
            analysis={analysis}
            model={analysis?.model}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
          />
          <Panel id="layout" title="Layout structure" badge="14 sections">
            <ol className="px-[18px] py-3 font-mono text-caption leading-[1.9] text-content-secondary">
              {LAYOUT_TREE.map((node, index) => (
                <li key={`${node.name}-${index}`} style={{ paddingLeft: `${node.depth * 20}px` }}>
                  {node.depth > 0 && <span aria-hidden className="text-content-muted">├ </span>}
                  {node.tag && <span className="text-accent">&lt;{node.tag}&gt; </span>}
                  <b className="font-medium text-content">{node.name}</b>
                  <span> · {node.detail}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel id="components" title="Components detected" badge="9 components">
            <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {DETECTED_COMPONENTS.map((component) => {
                const Icon = ICONS[component.icon] ?? Boxes;
                return (
                  <li key={component.name} className="flex items-center gap-3 bg-bg-surface px-4 py-3.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-bg-subtle">
                      <Icon aria-hidden className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">{component.name}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-caption text-content-muted">
                        <span aria-hidden className="relative inline-block h-1 w-14 overflow-hidden rounded-full bg-bg-subtle">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${component.confidence}%` }} />
                        </span>
                        {component.confidence}% confidence
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel id="typography" title="Typography" badge="6 styles">
            <ul>
              {DESIGN_TOKENS.typography.map((style) => (
                <li key={style.name} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-[18px] py-3 last:border-b-0">
                  <span
                    className="font-display tracking-[-0.02em]"
                    style={{ fontSize: style.size, fontWeight: style.weight }}
                  >
                    {style.name}
                  </span>
                  <span className="font-mono text-[11px] text-content-muted">{style.spec}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel id="colours" title="Colours" badge="11 tokens">
            <ul className="flex flex-wrap gap-2.5 px-[18px] py-4">
              {DESIGN_TOKENS.colours.map((token) => (
                <li key={token.name} className="w-24">
                  <span
                    aria-hidden
                    className="mb-1.5 block h-11 rounded-md border border-black/5"
                    style={{ background: token.hex }}
                  />
                  <b className="block text-caption font-medium">{token.name}</b>
                  <small className="font-mono text-[11px] text-content-muted">{token.hex}</small>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel id="spacing" title="Spacing">
              <div className="px-[18px] py-4">
                <ul className="flex flex-wrap items-end gap-3">
                  {DESIGN_TOKENS.spacing.map((value) => (
                    <li key={value} className="flex flex-col items-center gap-1.5 font-mono text-[11px] text-content-muted">
                      <span
                        aria-hidden
                        className="block rounded-[3px] border border-[#C7D2FE] bg-accent-soft"
                        style={{ width: value, height: value }}
                      />
                      {value}
                    </li>
                  ))}
                </ul>
                <p className="mt-3.5 text-caption text-content-muted">
                  Base unit 4px. Section padding uses 96 vertical, 80 horizontal.
                </p>
              </div>
            </Panel>

            <Panel id="assets" title="Assets" badge="23 files">
              <ul className="flex flex-col gap-2.5 px-[18px] py-4">
                {ASSET_SUMMARY.map((asset) => {
                  const Icon = asset.icon;
                  return (
                    <li key={asset.label} className="flex items-center justify-between text-body-sm">
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden className="h-3.5 w-3.5 text-content-muted" />
                        {asset.label}
                      </span>
                      <span className="text-content-muted">{asset.detail}</span>
                    </li>
                  );
                })}
                <li>
                  <Banner tone="warning">
                    Söhne isn&apos;t on Google Fonts. Upload the file or we&apos;ll fall back to Inter.
                  </Banner>
                </li>
              </ul>
            </Panel>

            <Panel id="interactions" title="Interactions">
              <ul className="flex flex-col gap-2.5 px-[18px] py-4">
                {INTERACTIONS.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 text-body-sm">
                    <span className="min-w-0">{item.label}</span>
                    <Badge tone={item.tone}>{item.badge}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel id="responsive" title="Responsive rules">
              <ul className="flex flex-col gap-2.5 px-[18px] py-4">
                {RESPONSIVE.map((rule) => (
                  <li key={rule.label} className="flex items-center justify-between gap-3 text-body-sm">
                    <span>{rule.label}</span>
                    <span className="text-content-muted">{rule.rule}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
