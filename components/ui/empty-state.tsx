import * as React from "react";

export function EmptyState({ icon, title, body, action }: {
  icon: React.ReactNode; title: string; body: string; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-11 text-center">
      <div className="mx-auto mb-3.5 grid h-12 w-12 place-items-center rounded-lg bg-bg-subtle [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </div>
      <h4 className="text-[15px] font-semibold">{title}</h4>
      <p className="mx-auto mb-4 mt-1 max-w-[34ch] text-body-sm text-content-muted">{body}</p>
      {action}
    </div>
  );
}
