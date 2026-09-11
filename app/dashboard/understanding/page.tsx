import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Boxes, FileQuestion, Image as ImageIcon, LayoutGrid, MousePointer2,
  Navigation, RectangleHorizontal, SquareUser, Type as TypeIcon, Video,
} from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { DESIGN_TOKENS, DETECTED_COMPONENTS } from "@/lib/data";
import { getDesignSummary } from "@/lib/repositories/design-read";
import { getDesignDetail, type DesignDetail } from "@/lib/repositories/design-detail";
import { UnderstandingNav } from "./understanding-nav";
import { AnalysisSummary } from "./analysis-summary";
import { requireSession } from "@/lib/auth/session";
import { GenerateButton } from "@/components/ai/generate-button";
import { listProjects } from "@/lib/repositories/projects";
import { getLatestArtifact } from "@/lib/repositories/artifacts";
import { isInferenceConfigured } from "@/lib/ai/bootstrap";
import { formatBytes } from "@/lib/utils";
import type { DesignAnalysis } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Design understanding" };

const ICONS: Record<string, React.ElementType> = {
  nav: Navigation, navbar: Navigation, hero: LayoutGrid, button: RectangleHorizontal,
  card: Boxes, feature_card: Boxes, input: RectangleHorizontal, avatar: SquareUser,
  user: SquareUser, grid: LayoutGrid, feature_grid: LayoutGrid, footer: LayoutGrid,
};

const ASSET_ICONS: Record<string, React.ElementType> = {
  image: ImageIcon, icon: MousePointer2, svg: Boxes, font: TypeIcon, video: Video,
};

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
 * What a panel says when the import produced nothing for it.
 *
 * Each of these panels used to render a fixture instead, so a user who had
 * imported nothing — or whose file genuinely had no interactions — was shown a
 * confident description of somebody else's design. An empty panel that says
 * what is missing is the honest answer, and the only one a user can act on.
 */
function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 px-[18px] py-4 text-body-sm text-content-muted">
      <FileQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
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
  const demo = session.demo;
  const projects = demo ? [] : await listProjects(session, 1);
  const project = projects[0] ?? null;

  // Real detections, tokens and structure, from what the import persisted.
  const [summary, detail] = project && !demo
    ? await Promise.all([
        getDesignSummary(session, project.id),
        getDesignDetail(session, project.id),
      ])
    : [null, null];

  /**
   * Token rows carry a jsonb `value`, so each panel needs the shape it renders.
   * Read defensively: these came out of a design file, not a schema we control.
   */
  const tokenValue = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const typographyTokens = (summary?.tokens ?? [])
    .filter((token) => token.category === "typography")
    .map((token) => {
      const value = tokenValue(token.value);
      const size = Number(value.fontSize ?? 16);
      return {
        name: token.name,
        size: `${size}px`,
        weight: Number(value.fontWeight ?? 400),
        spec: `${size}px · ${value.fontFamily ?? "inherit"} ${value.fontWeight ?? 400}`,
      };
    });

  const colourTokens = (summary?.tokens ?? [])
    .filter((token) => token.category === "color")
    .map((token) => {
      const value = tokenValue(token.value);
      return { name: token.name, hex: String(value.hex ?? value.value ?? "#000000") };
    })
    .filter((token) => /^#|^rgb|^hsl/.test(token.hex));

  const spacingTokens = (summary?.tokens ?? [])
    .filter((token) => token.category === "spacing")
    .map((token) => `${Number(tokenValue(token.value).value ?? 0)}px`)
    .filter((value) => value !== "0px");

  const analysis = project
    ? await getLatestArtifact<DesignAnalysis & { model?: string }>(project.id, "design_analysis")
    : null;

  const inferenceReady = isInferenceConfigured();
  const disabledReason = demo
    ? "Connect Supabase and import a design to run the analyst on real data."
    : !project
      ? "Create a project and import a design first."
      : !inferenceReady
        ? "No AI provider is configured. Set ANTHROPIC_API_KEY to enable the analyst."
        : undefined;

  /**
   * Fixtures are for demo mode alone, where nothing is connected and the banner
   * says so. A signed-in account with no import gets an empty panel telling it
   * to import — it used to get the fixture, which is how a brand-new workspace
   * came to display nine components it had never seen.
   */
  const components = summary?.components.length
    ? summary.components.map((component) => ({
        name: component.name,
        confidence: Math.round(component.confidence),
        icon: component.role ?? "component",
      }))
    : demo
      ? DETECTED_COMPONENTS
      : [];

  const typography = typographyTokens.length ? typographyTokens : demo ? DESIGN_TOKENS.typography : [];
  const colours = colourTokens.length ? colourTokens : demo ? DESIGN_TOKENS.colours : [];
  const spacing = spacingTokens.length
    ? spacingTokens
    : demo
      ? DESIGN_TOKENS.spacing.map((value) => `${value}px`)
      : [];

  const importHint = project
    ? "Import a Figma file or upload a design image, and this fills in from what the importer finds."
    : "Create a project and import a design first.";

  return (
    <AppShell crumbs={[project?.name ?? "Projects", "Design understanding"]}>
      <PageHeading
        title="What we found in your design"
        description="Review before generating. Correcting a mapping here saves a refinement pass later."
        actions={
          <>
            {analysis && <Badge tone="success" dot className="mr-1">Analysis complete</Badge>}
            {/* The re-analyse control lives in the Design Analyst panel below,
                where it is a real form. The button that used to sit here did
                nothing at all. */}
            <Link
              href={project ? `/project/${project.id}/code` : "/dashboard/import"}
              className={buttonClasses("secondary", "sm")}
            >
              {project ? "View code" : "Import a design"}
              <ArrowRight />
            </Link>
          </>
        }
      />

      {/* The control that actually runs the pipeline. */}
      <div className="mb-6 max-w-[420px]">
        <GenerateButton canGenerate={Boolean(project && (summary?.nodeCount ?? 0) > 0)} />
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

          <LayoutPanel detail={detail} hint={importHint} />

          <Panel
            id="components"
            title="Components detected"
            badge={components.length > 0 ? `${components.length} components` : undefined}
          >
            {components.length === 0 ? (
              <Nothing>No components detected yet. {importHint}</Nothing>
            ) : (
              <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                {components.map((component) => {
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
            )}
          </Panel>

          <Panel
            id="typography"
            title="Typography"
            badge={typography.length > 0 ? `${typography.length} styles` : undefined}
          >
            {typography.length === 0 ? (
              <Nothing>No text styles extracted yet. {importHint}</Nothing>
            ) : (
              <ul>
                {typography.map((style) => (
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
            )}
          </Panel>

          <Panel
            id="colours"
            title="Colours"
            badge={colours.length > 0 ? `${colours.length} tokens` : undefined}
          >
            {colours.length === 0 ? (
              <Nothing>No colour tokens extracted yet. {importHint}</Nothing>
            ) : (
              <ul className="flex flex-wrap gap-2.5 px-[18px] py-4">
                {colours.map((token) => (
                  <li key={token.name} className="w-24">
                    <span
                      aria-hidden
                      className="mb-1.5 block h-11 rounded-md border border-black/5"
                      style={{ background: token.hex }}
                    />
                    <b className="block break-words text-caption font-medium">{token.name}</b>
                    <small className="font-mono text-[11px] text-content-muted">{token.hex}</small>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel id="spacing" title="Spacing">
              {spacing.length === 0 ? (
                <Nothing>No spacing scale extracted yet. {importHint}</Nothing>
              ) : (
                <div className="px-[18px] py-4">
                  <ul className="flex flex-wrap items-end gap-3">
                    {spacing.map((value) => (
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
                  {/* Measured off this design's own frames, not a house rule. */}
                  {(detail?.spacingBase || detail?.sectionPadding) && (
                    <p className="mt-3.5 text-caption text-content-muted">
                      {detail.spacingBase ? `Base unit ${detail.spacingBase}px.` : null}
                      {detail.spacingBase && detail.sectionPadding ? " " : null}
                      {detail.sectionPadding ? `Section padding uses ${detail.sectionPadding}.` : null}
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <AssetsPanel detail={detail} hint={importHint} />
            <InteractionsPanel detail={detail} hint={importHint} />
            <ResponsivePanel detail={detail} hint={importHint} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** The frame's real structure, as deep as the tree is worth reading. */
function LayoutPanel({ detail, hint }: { detail: DesignDetail | null; hint: string }) {
  return (
    <Panel
      id="layout"
      title="Layout structure"
      badge={detail ? `${detail.sectionCount} sections` : undefined}
    >
      {!detail || detail.layout.length === 0 ? (
        <Nothing>No frame structure imported yet. {hint}</Nothing>
      ) : (
        <>
          <p className="border-b border-border px-[18px] py-2 text-caption text-content-muted">
            {detail.frameName} · {detail.frameWidth} × {detail.frameHeight}
          </p>
          <ol className="overflow-x-auto px-[18px] py-3 font-mono text-caption leading-[1.9] text-content-secondary">
            {detail.layout.map((node) => (
              <li key={node.id} style={{ paddingLeft: `${node.depth * 20}px` }} className="whitespace-nowrap">
                {node.depth > 0 && <span aria-hidden className="text-content-muted">├ </span>}
                {node.tag && <span className="text-accent">&lt;{node.tag}&gt; </span>}
                <b className="font-medium text-content">{node.name}</b>
                {node.detail && <span> · {node.detail}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

/** Counted and sized from design_assets, not from a fixed "23 files". */
function AssetsPanel({ detail, hint }: { detail: DesignDetail | null; hint: string }) {
  const missing = (detail?.fonts ?? []).filter((font) => font.missing);

  return (
    <Panel
      id="assets"
      title="Assets"
      badge={detail && detail.assetCount > 0 ? `${detail.assetCount} files` : undefined}
    >
      {!detail || detail.assets.length === 0 ? (
        <div>
          <Nothing>
            No assets extracted yet. Images, icons and fonts are pulled in during import. {hint}
          </Nothing>
          {missing.length > 0 && <FontWarning families={missing.map((font) => font.family)} />}
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5 px-[18px] py-4">
          {detail.assets.map((group) => {
            const Icon = ASSET_ICONS[group.kind] ?? ImageIcon;
            return (
              <li key={group.kind} className="flex items-center justify-between text-body-sm">
                <span className="flex items-center gap-2">
                  <Icon aria-hidden className="h-3.5 w-3.5 text-content-muted" />
                  {group.label}
                </span>
                <span className="text-content-muted">
                  {group.count} · {formatBytes(group.bytes)}
                </span>
              </li>
            );
          })}
          <li className="flex items-center justify-between border-t border-border pt-2.5 text-body-sm font-medium">
            <span>Total</span>
            <span className="text-content-muted">{formatBytes(detail.assetBytes)}</span>
          </li>
          {missing.length > 0 && (
            <li>
              <FontWarning families={missing.map((font) => font.family)} />
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Named from the design's own typefaces.
 *
 * This warning was hard-coded to Söhne, so every design was told a font it had
 * never used was missing.
 */
function FontWarning({ families }: { families: string[] }) {
  const shown = families.slice(0, 3).join(", ");
  return (
    <Banner tone="warning">
      No font file was imported for {shown}
      {families.length > 3 ? ` and ${families.length - 3} more` : ""}. Upload the file, or generation
      will fall back to the nearest web-safe family.
    </Banner>
  );
}

/** Triggers found on nodes, marked when the analyser inferred rather than read them. */
function InteractionsPanel({ detail, hint }: { detail: DesignDetail | null; hint: string }) {
  return (
    <Panel id="interactions" title="Interactions">
      {!detail || detail.interactions.length === 0 ? (
        <Nothing>
          No interactions found. Figma prototype links and hover variants are read during import;
          a static frame has none. {hint}
        </Nothing>
      ) : (
        <ul className="flex flex-col gap-2.5 px-[18px] py-4">
          {detail.interactions.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="min-w-0 truncate">
                {item.label} — {item.triggers.join(", ")}
              </span>
              <Badge tone={item.inferred ? "warning" : "success"}>
                {item.inferred ? "Inferred" : `${item.triggers.length} states`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The breakpoints the designer drew, plus whatever the analyser derived.
 *
 * Frame widths are observed facts and are listed as such; hints are labelled
 * "Derived", which is the distinction §18 of the brief asks for.
 */
function ResponsivePanel({ detail, hint }: { detail: DesignDetail | null; hint: string }) {
  const breakpoints = detail?.breakpoints ?? [];
  const rules = detail?.responsive ?? [];

  return (
    <Panel id="responsive" title="Responsive rules">
      {breakpoints.length === 0 && rules.length === 0 ? (
        <Nothing>
          No responsive behaviour yet. Import frames at more than one width and the rules between
          them are worked out here. {hint}
        </Nothing>
      ) : (
        <ul className="flex flex-col gap-2.5 px-[18px] py-4">
          {breakpoints.length > 0 && (
            <li className="flex items-center justify-between gap-3 text-body-sm">
              <span>Frames imported</span>
              <span className="text-content-muted">{breakpoints.map((width) => `${width}px`).join(" · ")}</span>
            </li>
          )}
          {breakpoints.length === 1 && (
            <li>
              <Banner tone="info">
                Only one width was imported, so any responsive behaviour below {breakpoints[0]}px has to
                be inferred. Import the tablet and mobile frames for rules read from the design itself.
              </Banner>
            </li>
          )}
          {rules.map((rule) => (
            <li key={`${rule.label}-${rule.rule}`} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="min-w-0 truncate">{rule.label}</span>
              <span className="flex shrink-0 items-center gap-2 text-content-muted">
                {rule.rule}
                {rule.derived && <Badge tone="warning">Derived</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
