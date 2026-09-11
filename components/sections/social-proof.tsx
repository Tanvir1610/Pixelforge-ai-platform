import { Braces, Ruler, ShieldCheck, Type as TypeIcon } from "lucide-react";

/**
 * What the importer reads out of a design file.
 *
 * This section was a customer logo wall — "Northwind", "Rivet", "Basalt
 * Studio", "Lumen Labs", "Fieldnote", "Kerning & Co." — under
 * `aria-label="Customers"`. None of those companies exist. Invented logos are
 * not a placeholder in the way an invented screenshot is: they are a claim
 * about who uses the product, made to a visitor deciding whether to trust it.
 *
 * Replaced with something the product can actually be held to.
 */
const CAPABILITIES = [
  { icon: Ruler, label: "Auto layout", detail: "Direction, gap and padding become flex and grid rules" },
  { icon: TypeIcon, label: "Text styles", detail: "Figma styles and variables become design tokens" },
  { icon: Braces, label: "Components", detail: "Repeated frames become one component with variants" },
  { icon: ShieldCheck, label: "Constraints", detail: "Resize behaviour becomes responsive breakpoints" },
];

export function SocialProof() {
  return (
    <section aria-label="What the importer reads" className="mx-auto max-w-container px-5 pb-16 md:px-10 lg:px-20">
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {CAPABILITIES.map((capability) => {
          const Icon = capability.icon;
          return (
            <li key={capability.label} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-subtle text-content-secondary"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <b className="block text-body-sm font-semibold">{capability.label}</b>
                <span className="mt-0.5 block text-caption leading-relaxed text-content-muted">
                  {capability.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
