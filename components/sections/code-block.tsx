import * as React from "react";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<string, string> = {
  keyword: "text-[#C4B5FD]",
  string: "text-[#86EFAC]",
  fn: "text-[#93C5FD]",
  comment: "text-[#6B7280] italic",
  tag: "text-[#FDE68A]",
  prop: "text-[#F9A8D4]",
};

const KEYWORDS = /\b(import|from|export|default|function|return|const|let|await|async|type|interface)\b/g;

/**
 * Deliberately small highlighter. A full grammar parser is not worth the bundle
 * cost when the editor only ever renders a fixed set of generated files.
 */
function highlight(line: string, key: number) {
  if (line.trimStart().startsWith("//") || line.trimStart().startsWith("/*"))
    return <span className={TOKEN_CLASS.comment}>{line}</span>;

  const parts: React.ReactNode[] = [];
  const pattern = /("[^"]*")|(&lt;\/?[A-Za-z][\w.]*)|(\b[A-Za-z_$][\w$]*(?=\())/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const escaped = line.replace(/</g, "&lt;");

  while ((match = pattern.exec(escaped)) !== null) {
    if (match.index > cursor) parts.push(plain(escaped.slice(cursor, match.index), `p${key}-${cursor}`));
    const cls = match[1] ? TOKEN_CLASS.string : match[2] ? TOKEN_CLASS.tag : TOKEN_CLASS.fn;
    parts.push(
      <span key={`t${key}-${match.index}`} className={cls} dangerouslySetInnerHTML={{ __html: match[0] }} />,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < escaped.length) parts.push(plain(escaped.slice(cursor), `p${key}-end`));
  return <>{parts}</>;
}

function plain(text: string, key: string) {
  const html = text.replace(KEYWORDS, `<span class="${TOKEN_CLASS.keyword}">$1</span>`);
  return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodeBlock({ lines, className, showLineNumbers = true }: {
  lines: string[]; className?: string; showLineNumbers?: boolean;
}) {
  return (
    <pre className={cn("overflow-auto p-5 font-mono text-code text-[#E5E7EB] scrollbar-thin", className)}>
      <code>
        {lines.map((line, index) => (
          <div key={index} className="whitespace-pre">
            {showLineNumbers && (
              <span aria-hidden className="inline-block w-8 select-none text-[#4B5563]">{index + 1}</span>
            )}
            {highlight(line, index)}
          </div>
        ))}
      </code>
    </pre>
  );
}
