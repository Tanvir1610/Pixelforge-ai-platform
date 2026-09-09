import Link from "next/link";
import { Logo } from "./logo";

const COLUMNS = [
  { title: "Product", links: ["Features", "Pricing", "Changelog", "Roadmap"] },
  { title: "Developers", links: ["Documentation", "API reference", "Figma plugin", "Status"] },
  { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
  { title: "Legal", links: ["Privacy", "Terms", "Security", "DPA"] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-container gap-8 px-5 py-14 md:grid-cols-3 md:px-10 lg:grid-cols-5 lg:px-20">
        <div className="lg:col-span-1">
          <Logo />
          <p className="mt-3 max-w-[30ch] text-body-sm text-content-muted">
            Turn Figma designs into production-ready websites.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="mb-3 text-body-sm font-semibold">{column.title}</h2>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link}>
                  <Link href="/" className="text-body-sm text-content-muted hover:text-content">{link}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="col-span-full flex flex-col gap-2 border-t border-border pt-5 text-body-sm text-content-muted sm:flex-row sm:justify-between">
          <span>© 2026 PixelForge AI</span>
          <span>Made for designers who ship</span>
        </div>
      </div>
    </footer>
  );
}
