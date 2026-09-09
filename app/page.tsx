import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { BeforeAfter } from "@/components/sections/before-after";
import { CodePreview } from "@/components/sections/code-preview";
import { Faq } from "@/components/sections/faq";
import { Features } from "@/components/sections/features";
import { FinalCta } from "@/components/sections/final-cta";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { PricingSection } from "@/components/sections/pricing";
import { Refinement } from "@/components/sections/refinement";
import { SocialProof } from "@/components/sections/social-proof";
import { Stack } from "@/components/sections/stack";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main id="main">
        <Hero />
        <SocialProof />
        <HowItWorks />
        <Features />
        <BeforeAfter />
        <CodePreview />
        <Refinement />
        <Stack />
        <PricingSection />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
