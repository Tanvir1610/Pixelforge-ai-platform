import { Download, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "./code-block";
import { EditorTabs } from "./editor-tabs";
import { CODE_FILES } from "@/lib/data";

export function CodePreview() {
  return (
    <section className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">
            Code you would have written
          </h2>
          <p className="mt-3 max-w-[46ch] text-body md:text-body-lg text-content-secondary">
            Typed props, real component boundaries, tokens instead of magic numbers. Open any file and it reads like a
            considered codebase, not machine output.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="secondary"><Github />Push to GitHub</Button>
            <Button variant="ghost"><Download />Download repository</Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-[14px] bg-bg-dark shadow-lg">
          <EditorTabs files={["Hero.tsx", "Navbar.tsx", "globals.css"]} active="Hero.tsx" />
          <CodeBlock lines={CODE_FILES["Hero.tsx"].lines} />
        </div>
      </div>
    </section>
  );
}
