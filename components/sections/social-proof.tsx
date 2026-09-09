const LOGOS = ["Northwind", "Rivet", "Basalt Studio", "Lumen Labs", "Fieldnote", "Kerning & Co."];

export function SocialProof() {
  return (
    <section aria-label="Customers" className="mx-auto max-w-container px-5 pb-16 md:px-10 lg:px-20">
      <ul className="flex flex-wrap items-center justify-between gap-6">
        {LOGOS.map((logo) => (
          <li key={logo} className="font-display text-[18px] font-bold tracking-[-0.01em] text-[#A3A7B0]">{logo}</li>
        ))}
      </ul>
    </section>
  );
}
