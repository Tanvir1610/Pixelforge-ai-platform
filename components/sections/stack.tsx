const FRAMEWORKS = [
  { label: "React", colour: "#61DAFB" }, { label: "Next.js", colour: "#111111" },
  { label: "Vue", colour: "#42B883" }, { label: "HTML / CSS", colour: "#E44D26" },
  { label: "Tailwind CSS", colour: "#38BDF8" },
];

const HOSTS = [
  { label: "Vercel", colour: "#111111" }, { label: "Netlify", colour: "#0E1E25" },
  { label: "Cloudflare", colour: "#F38020" }, { label: "GitHub", colour: "#24292E" },
];

function Chip({ label, colour }: { label: string; colour: string }) {
  return (
    <li className="inline-flex h-11 items-center gap-2.5 rounded-[10px] border border-border bg-bg-surface pl-3.5 pr-[18px] text-body font-medium shadow-sm">
      <span aria-hidden className="h-5 w-5 rounded-[5px]" style={{ background: colour }} />
      {label}
    </li>
  );
}

export function Stack() {
  return (
    <section className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">Your stack, your host</h2>
      <ul className="mt-10 flex flex-wrap gap-2.5">
        {FRAMEWORKS.map((item) => <Chip key={item.label} {...item} />)}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-2.5">
        {HOSTS.map((item) => <Chip key={item.label} {...item} />)}
      </ul>
    </section>
  );
}
