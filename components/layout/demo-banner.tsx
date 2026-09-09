import { Banner } from "@/components/ui/banner";

/**
 * Shown on every data-backed screen when Supabase is not configured. The point
 * is that nobody can mistake seeded data for a working backend.
 */
export function DemoBanner() {
  return (
    <Banner tone="info" className="mb-6">
      <b className="font-semibold">Demo data.</b> Supabase isn&apos;t configured, so these projects are seeded
      locally. Add <code className="font-mono text-caption">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
      <code className="font-mono text-caption">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to connect a real workspace.
    </Banner>
  );
}
