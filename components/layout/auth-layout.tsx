import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { Logo } from "./logo";
import { ProviderButton } from "./oauth-buttons";
import { signInWithProvider } from "@/lib/auth/actions";

/** Split auth shell. The showcase panel is hidden below lg so the form owns the viewport. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[3fr_2fr] xl:grid-cols-[1fr_560px]">
      {/* Laid out in flow rather than absolutely.
          The showcase card used to be `absolute … top-48 bottom-32`, which
          overlapped the quote below it as soon as the viewport was shorter than
          the design's reference height — the two collided on any laptop screen.
          A flex column with the card as the only growing item cannot overlap
          anything, at any height. */}
      <div className="relative hidden flex-col gap-8 overflow-hidden bg-bg-dark p-12 text-white lg:flex">
        <div aria-hidden className="absolute -bottom-52 -right-52 h-[600px] w-[600px] bg-[radial-gradient(circle,rgba(99,102,241,.35),transparent_65%)]" />
        <Logo inverse className="relative shrink-0" />

        <div className="relative -mr-32 min-h-0 flex-1 overflow-hidden rounded-lg border border-[#2E2E2E] bg-bg-dark-2 shadow-lg">
          <div className="flex h-11 items-center justify-between border-b border-[#2E2E2E] px-4">
            <span className="text-caption text-content-on-dark">Home / page.tsx</span>
            {/* Was a green "97% match" badge. Nothing measured it — it is a
                number beside a mockup, and the same number the app used to
                report for real projects it had never compared. */}
            <Badge tone="neutral">Example output</Badge>
          </div>
          <div className="p-5">
            <ScaledSite scale={1.4} height={340} className="rounded-md">
              <MiniSite brand="Northwind" headline="Ship your ideas without the rebuild." />
            </ScaledSite>
          </div>
        </div>

        {/* A testimonial used to sit here — "Six screens, one afternoon, no
            hand-off meeting." attributed to "Priya Raman · Design lead, Basalt
            Studio". Neither the person nor the studio exists. A fabricated
            quote from a named person is not placeholder copy; it is a claim
            about a customer, put in front of someone deciding whether to sign
            up. This says what the product does instead. */}
        <p className="relative max-w-[26ch] shrink-0 font-display text-[24px] font-bold leading-[1.25] tracking-[-0.02em] xl:text-[28px]">
          Your Figma file, read properly — layout, tokens and components, not a
          screenshot traced into divs.
        </p>
      </div>

      <div className="flex items-center justify-center bg-bg px-5 py-10 sm:py-12 md:px-12">
        <main id="main" className="flex w-full max-w-[400px] flex-col gap-5">
          {/* The only branding below lg: the panel that carries the logo is
              hidden there, which left the mobile sign-up page with none at all
              and no way back to the site. */}
          <Link href="/" className="mb-1 inline-flex self-start lg:hidden" aria-label="PixelForge AI home">
            <Logo />
          </Link>
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Provider sign-in.
 *
 * These were `<button type="button">` with no handler at all — the server
 * action existed, nothing ever called it, and clicking did nothing. Each is now
 * a form posting to that action, which redirects to the provider.
 */
export function OauthButtons() {
  return (
    <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <form action={signInWithProvider} className="contents">
          <ProviderButton provider="google" label="Google">
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
              <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
              <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
              <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5z" />
              <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z" />
            </svg>
          </ProviderButton>
        </form>

        <form action={signInWithProvider} className="contents">
          <ProviderButton provider="github" label="GitHub">
            <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
              <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
            </svg>
          </ProviderButton>
        </form>
      </div>
      <div className="flex items-center gap-3 text-caption text-content-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or
      </div>
    </>
  );
}
