import {
  Boxes, Code2, Download, Eye, GitBranch, Image as ImageIcon, Layers, Lock,
  Monitor, MousePointer2, Palette, Ruler, Sparkles,
} from "lucide-react";

const FEATURES = [
  { icon: Ruler, title: "Pixel-perfect conversion", body: "Spacing, sizes and alignment are measured from the file, not estimated from a screenshot." },
  { icon: Monitor, title: "Responsive generation", body: "Constraints and auto layout become real breakpoints you can inspect and override." },
  { icon: Boxes, title: "Component detection", body: "Repeated elements are collapsed into one component with props instead of copies." },
  { icon: Palette, title: "Design token extraction", body: "Colour, type and spacing variables map to CSS custom properties or a Tailwind theme." },
  { icon: ImageIcon, title: "Asset recognition", body: "Images, icons and vectors are exported at the right density and optimised on the way out." },
  { icon: Layers, title: "Auto layout interpretation", body: "Stacks, gaps and hug/fill rules translate to flex and grid rather than absolute positions." },
  { icon: MousePointer2, title: "Interactive state generation", body: "Hover, focus, active and disabled variants come through as real states in the code." },
  { icon: GitBranch, title: "Clean component architecture", body: "Sensible file structure, typed props and no thousand-line pages to untangle later." },
  { icon: Download, title: "Code export", body: "Download a repository or push to GitHub. The output is yours, with no runtime lock-in." },
  { icon: Eye, title: "Live preview", body: "See the real site render as it is generated, at any breakpoint and zoom level." },
  { icon: Sparkles, title: "AI-powered refinement", body: "Ask for a change in plain language and review the diff before anything is applied." },
  { icon: Lock, title: "Private by default", body: "Your designs are never used for training and are deleted from processing storage after export." },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">
        Built for designs that already exist
      </h2>
      <p className="mt-3 max-w-prose text-body md:text-body-lg text-content-secondary">
        Not a template generator. PixelForge reads what you actually drew.
      </p>
      <ul className="mt-12 grid gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <li key={feature.title} className="bg-bg-surface p-6">
              <span className="mb-4 grid h-9 w-9 place-items-center rounded-[9px] bg-bg-subtle">
                <Icon aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <h3 className="mb-1 text-[15px] font-semibold">{feature.title}</h3>
              <p className="text-body-sm text-content-muted">{feature.body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
