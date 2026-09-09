import type {
  AnalysisStep, AssetItem, ChatMessage, ComponentEntry, DetectedComponent, Deployment,
  Device, GenerationTask, MatchMetric, Project, VisualDifference,
} from "@/types";

export const DEVICES: Device[] = [
  { key: "desktop", label: "Desktop", width: 1440 },
  { key: "tablet", label: "Tablet", width: 768 },
  { key: "mobile", label: "Mobile", width: 390 },
];

export const PROJECTS: Project[] = [
  { id: "northwind", name: "Northwind marketing", brand: "Northwind", headline: "Ship your ideas without the rebuild.", framework: "Next.js", styling: "Tailwind CSS", status: "live", editedAt: "2 hours ago", meta: "6 pages · 14 components", pages: 6, components: 14, matchScore: 97 },
  { id: "rivet", name: "Rivet product site", brand: "Rivet", headline: "Field data, finally in one place.", framework: "React", styling: "CSS Modules", status: "generating", editedAt: "Just now", meta: "Generating 4 of 5 pages", pages: 5, components: 11, progress: 74 },
  { id: "lumen", name: "Lumen Labs landing", brand: "Lumen", headline: "Measure what your models actually do.", framework: "Next.js", styling: "Tailwind CSS", status: "review", editedAt: "Yesterday", meta: "92% match · 5 differences", pages: 3, components: 9, matchScore: 92, theme: "dark" },
  { id: "fieldnote", name: "Fieldnote app pages", brand: "Fieldnote", headline: "Notes that survive the field.", framework: "Vue", styling: "Vanilla CSS", status: "draft", editedAt: "3 days ago", meta: "Design imported, not generated", pages: 4, components: 0 },
  { id: "kerning", name: "Kerning & Co. shop", brand: "Kerning", headline: "Type specimens for working studios.", framework: "Next.js", styling: "Tailwind CSS", status: "failed", editedAt: "4 days ago", meta: "Missing font file in build", pages: 5, components: 12 },
];

export function getProject(id: string): Project {
  return PROJECTS.find((p) => p.id === id) ?? PROJECTS[0];
}

export const ANALYSIS_STEPS: AnalysisStep[] = [
  { id: "layout", label: "Analysing layout", state: "done", result: "14 sections" },
  { id: "components", label: "Detecting components", state: "done", result: "9 found" },
  { id: "type", label: "Extracting typography", state: "done", result: "6 styles" },
  { id: "colour", label: "Analysing colours", state: "done", result: "11 tokens" },
  { id: "assets", label: "Mapping assets", state: "done", result: "23 files" },
  { id: "responsive", label: "Understanding responsive behaviour", state: "active" },
  { id: "tree", label: "Building component tree", state: "pending" },
  { id: "plan", label: "Preparing generation plan", state: "pending" },
];

export const GENERATION_TASKS: GenerationTask[] = [
  { id: "layout", label: "Creating layout", state: "done", result: "4 files" },
  { id: "components", label: "Creating components", state: "done", result: "9 files" },
  { id: "type", label: "Applying typography", state: "done", result: "6 styles" },
  { id: "assets", label: "Adding assets", state: "done", result: "23 files" },
  { id: "responsive", label: "Implementing responsiveness", state: "active", result: "2 of 3" },
  { id: "interactions", label: "Adding interactions", state: "pending" },
];

export const DETECTED_COMPONENTS: DetectedComponent[] = [
  { name: "Navbar", confidence: 99, icon: "nav" },
  { name: "Hero", confidence: 98, icon: "hero" },
  { name: "Button", confidence: 96, icon: "button" },
  { name: "Feature card", confidence: 95, icon: "card" },
  { name: "Input", confidence: 93, icon: "input" },
  { name: "Avatar", confidence: 91, icon: "user" },
  { name: "Logo row", confidence: 88, icon: "grid" },
  { name: "Pricing plan", confidence: 86, icon: "card" },
  { name: "Footer", confidence: 97, icon: "footer" },
];

export const MATCH_METRICS: MatchMetric[] = [
  { label: "Spacing", value: 98 },
  { label: "Typography", value: 96 },
  { label: "Colours", value: 100 },
  { label: "Layout", value: 97 },
  { label: "Components", value: 95 },
];

export const VISUAL_DIFFERENCES: VisualDifference[] = [
  { id: "d1", label: "Hero padding", detail: "96 vs 88px", severity: "high" },
  { id: "d2", label: "Heading size", detail: "64 vs 60px", severity: "high" },
  { id: "d3", label: "Card gap", detail: "24 vs 20px", severity: "medium" },
  { id: "d4", label: "Button radius", detail: "8 vs 6px", severity: "medium" },
  { id: "d5", label: "Footer column widths", detail: "±12px", severity: "medium" },
];

export const INITIAL_CHAT: ChatMessage[] = [
  { id: "m1", role: "user", body: "Make the hero section match the Figma design more closely." },
  {
    id: "m2", role: "assistant",
    body: "I compared the rendered hero against frame Hero / Desktop 1440 and found 3 differences:",
    findings: [
      { label: "Hero spacing", detail: "96 → 88px" },
      { label: "Heading size", detail: "60 → 64px" },
      { label: "Button alignment", detail: "center → left" },
    ],
    files: ["Hero.tsx", "tokens.css"],
    actions: true,
  },
];

export const DESIGN_TOKENS = {
  colours: [
    { name: "text/primary", hex: "#111111" }, { name: "text/muted", hex: "#6B7280" },
    { name: "accent/primary", hex: "#6366F1" }, { name: "accent/secondary", hex: "#8B5CF6" },
    { name: "bg/primary", hex: "#FAFAFA" }, { name: "bg/surface", hex: "#FFFFFF" },
    { name: "border/default", hex: "#E5E7EB" }, { name: "status/success", hex: "#22C55E" },
  ],
  typography: [
    { name: "Display", spec: "Plus Jakarta Sans 800 · 64/68 · -3%", size: 30, weight: 800 },
    { name: "Heading 1", spec: "Plus Jakarta Sans 700 · 40/46 · -2.5%", size: 24, weight: 700 },
    { name: "Heading 2", spec: "Plus Jakarta Sans 700 · 28/34 · -2%", size: 19, weight: 700 },
    { name: "Heading 3", spec: "Inter 600 · 18/24", size: 16, weight: 600 },
    { name: "Body large", spec: "Inter 400 · 17/27", size: 15, weight: 400 },
    { name: "Body", spec: "Inter 400 · 14/22", size: 13, weight: 400 },
  ],
  spacing: [4, 8, 12, 16, 24, 32, 48, 80],
};

export const RESPONSIVE_RULES = [
  "grid-cols-3 → md:grid-cols-2 → grid-cols-1",
  "px-20 → md:px-10 → px-5",
  "text-[64px] → md:text-5xl → text-4xl",
];

export const COMPONENT_LIBRARY: ComponentEntry[] = [
  { id: "button", name: "Button", usage: 42, variants: ["Primary", "Secondary", "Outline", "Ghost"], states: ["Default", "Hover", "Active", "Disabled"] },
  { id: "feature-card", name: "FeatureCard", usage: 12, variants: ["Icon", "Image", "Compact"] },
  { id: "navbar", name: "Navbar", usage: 6, variants: ["Default", "Sticky", "Transparent", "Mobile"] },
  { id: "input", name: "Input", usage: 19, variants: ["Default", "Focus", "Error", "Disabled"] },
  { id: "badge", name: "Badge", usage: 31, variants: ["Neutral", "Accent", "Success", "Warning", "Error"] },
  { id: "hero", name: "Hero", usage: 4, variants: ["Centred", "Split", "With media"] },
];

export const ASSETS: AssetItem[] = [
  { id: "a1", name: "hero-field.jpg", kind: "Image", bytes: 421888, uses: 4, needsOptimising: true },
  { id: "a2", name: "team-photo.png", kind: "Image", bytes: 397312, uses: 1, needsOptimising: true },
  { id: "a3", name: "logo-mark.svg", kind: "SVG", bytes: 4096, uses: 9 },
  { id: "a4", name: "icon-bolt.svg", kind: "Icon", bytes: 1024, uses: 3 },
  { id: "a5", name: "PlusJakartaSans.woff2", kind: "Font", bytes: 69632, uses: 1 },
  { id: "a6", name: "case-study-01.jpg", kind: "Image", bytes: 313344, uses: 1, needsOptimising: true },
  { id: "a7", name: "product-loop.mp4", kind: "Video", bytes: 1258291, uses: 1 },
  { id: "a8", name: "avatar-priya.png", kind: "Image", bytes: 22528, uses: 2 },
  { id: "a9", name: "Inter-variable.woff2", kind: "Font", bytes: 96256, uses: 1 },
  { id: "a10", name: "og-image.png", kind: "Image", bytes: 90112, uses: 1 },
];

export const DEPLOYMENTS: Deployment[] = [
  { id: "dp1", hash: "a1b2c3d", status: "ready", branch: "main", time: "2m ago" },
  { id: "dp2", hash: "9f8e7d6", status: "failed", branch: "feat/hero", time: "1h ago" },
  { id: "dp3", hash: "5c4b3a2", status: "ready", branch: "main", time: "1d ago" },
];

export const FILE_TREE = {
  pages: [
    { name: "Home", status: "Done" as const },
    { name: "About", status: "Done" as const },
    { name: "Pricing", status: "87%" as const },
    { name: "Contact", status: "Queued" as const },
  ],
  components: ["Navbar", "Hero", "Features", "Button", "FeatureCard", "Footer"],
  tokens: ["colors.css", "typography.css", "spacing.css"],
};

export const CODE_FILES: Record<string, { language: string; lines: string[] }> = {
  "page.tsx": {
    language: "tsx",
    lines: [
      'import { Navbar } from "@/components/Navbar"',
      'import { Hero } from "@/components/Hero"',
      'import { FeatureCard } from "@/components/FeatureCard"',
      'import { Footer } from "@/components/Footer"',
      'import { features } from "@/lib/content"',
      "",
      "// Generated from Figma · Northwind / Home / Desktop 1440",
      "// Section order and spacing follow the frame's auto layout.",
      "export default function HomePage() {",
      "  return (",
      '    <main className="min-h-screen bg-surface text-primary">',
      "      <Navbar sticky />",
      "",
      "      <Hero",
      '        title="Ship your ideas without the rebuild."',
      '        body="Northwind turns field research into decisions your team can act on."',
      '        primaryCta={{ label: "Get started", href: "/signup" }}',
      '        secondaryCta={{ label: "Book a demo", href: "/demo" }}',
      "      />",
      "",
      '      <section className="mx-auto max-w-7xl px-20 py-24">',
      '        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">',
      "          {features.map((feature) => (",
      "            <FeatureCard key={feature.id} {...feature} />",
      "          ))}",
      "        </div>",
      "      </section>",
      "",
      "      <Footer />",
      "    </main>",
      "  )",
      "}",
    ],
  },
  "Hero.tsx": {
    language: "tsx",
    lines: [
      'import { Button } from "@/components/ui/button"',
      "",
      '// Frame "Hero" — 1440×520, auto layout, gap 24',
      "export function Hero({ title, body, primaryCta }: HeroProps) {",
      "  return (",
      '    <section className="mx-auto max-w-7xl px-20 py-24">',
      '      <h1 className="text-display tracking-tight">{title}</h1>',
      '      <p className="mt-5 max-w-[52ch] text-lg text-secondary">',
      "        {body}",
      "      </p>",
      '      <Button size="lg" className="mt-8">{primaryCta.label}</Button>',
      "    </section>",
      "  )",
      "}",
    ],
  },
  "globals.css": {
    language: "css",
    lines: [
      "/* Design tokens extracted from Figma variables */",
      ":root {",
      "  --color-accent: #6366f1;",
      "  --color-surface: #ffffff;",
      "  --space-section: 96px;",
      "  --radius-md: 8px;",
      "}",
    ],
  },
};
