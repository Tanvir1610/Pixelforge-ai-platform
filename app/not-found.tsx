import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { MarketingNav } from "@/components/layout/marketing-nav";

export default function NotFound() {
  return (
    <>
      <MarketingNav />
      <main id="main" className="grid min-h-[70vh] place-items-center px-5 text-center">
        <div>
          <p className="font-mono text-caption text-content-muted">404</p>
          <h1 className="mt-2 font-display text-[32px] font-bold tracking-[-0.025em]">
            That page hasn&apos;t been generated
          </h1>
          <p className="mx-auto mt-3 max-w-[44ch] text-body text-content-secondary">
            The link may be stale, or the project it pointed at was deleted.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/dashboard" className={buttonClasses("primary")}>Go to dashboard</Link>
            <Link href="/" className={buttonClasses("secondary")}>Back to home</Link>
          </div>
        </div>
      </main>
    </>
  );
}
