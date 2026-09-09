import { Code2, Figma, Rocket, Sparkles } from "lucide-react";

const STEPS = [
  { n: "Step 01", icon: Figma, title: "Import Figma", body: "Connect your account or paste a file URL. We read frames, layers, variables and constraints." },
  { n: "Step 02", icon: Sparkles, title: "AI understands design", body: "Layout structure, repeated components, type ramp, colour tokens and interaction states are identified." },
  { n: "Step 03", icon: Code2, title: "Generate code", body: "Clean React or Next.js components with real props, semantic markup and your chosen styling layer." },
  { n: "Step 04", icon: Rocket, title: "Deploy", body: "Push to Vercel, Netlify or Cloudflare, or export the repository into your own pipeline." },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-border">
      <div className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20 lg:py-24">
        <h2 className="text-[28px] font-bold tracking-[-0.025em] md:text-h1 font-display">
          Four steps from file to production
        </h2>
        <p className="mt-3 max-w-prose text-body md:text-body-lg text-content-secondary">
          Every project follows the same path, so you always know where you are and what happens next.
        </p>
        <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.n} className="border-t border-border pt-6">
                <p className="mb-7 font-mono text-caption text-content-muted">{step.n}</p>
                <div className="mb-5 grid h-[120px] place-items-center rounded-[10px] border border-border bg-bg-surface">
                  <Icon aria-hidden className="h-8 w-8 text-content-secondary" />
                </div>
                <h3 className="mb-1.5 text-[16px] font-semibold">{step.title}</h3>
                <p className="text-body-sm text-content-muted">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
