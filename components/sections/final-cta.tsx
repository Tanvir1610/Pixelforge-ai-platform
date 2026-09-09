import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-bg-dark px-5 py-20 text-center text-white md:px-10 md:py-24 lg:px-20 lg:py-30">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-200px] h-[500px] w-[800px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,.35),transparent_65%)]"
      />
      <h2 className="relative font-display text-[36px] font-extrabold leading-[1.05] tracking-[-0.03em] md:text-[48px] lg:text-[56px]">
        Stop rebuilding designs.
        <br />
        Start shipping them.
      </h2>
      <div className="relative mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/signup" className={buttonClasses("primary", "lg")}>Start building</Link>
        <Link href="/pricing" className={buttonClasses("onDark", "lg")}>Book a walkthrough</Link>
      </div>
    </section>
  );
}
