"use client";

import * as React from "react";
import { ArrowUp, Check, Eye, FileCode2, Plus, Undo2, X } from "lucide-react";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { INITIAL_CHAT } from "@/lib/data";
import { askAssistantAction } from "@/lib/actions/assistant";
import type { ChatMessage } from "@/types";

/**
 * The refinement assistant. It reads as a code reviewer rather than a chat bot:
 * findings are scoped to named files and nothing is applied without approval.
 *
 * `live` decides whether it talks to the model. It used to reply from a
 * setTimeout with a fixed sentence — "Applied. Hero now matches at 99%." — to
 * anything at all, including an empty project, which reported work nobody had
 * done. Without a project or a provider the scripted thread still stands in,
 * and says so.
 */
export function ChatPanel({
  live = false,
  history,
}: {
  live?: boolean;
  history?: { role: "user" | "assistant"; body: string }[];
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => {
    if (!live) return INITIAL_CHAT;
    return (history ?? []).map((entry, index) => ({
      id: `h${index}`,
      role: entry.role,
      body: entry.body,
    }));
  });
  const [draft, setDraft] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const logRef = React.useRef<HTMLDivElement>(null);
  const messagesRef = React.useRef(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    const id = `m${Date.now()}`;
    const asked: ChatMessage = { id, role: "user", body: text };
    setMessages((current) => [...current, asked]);
    setDraft("");
    setThinking(true);

    if (!live) {
      // The scripted thread, kept only for the seeded demo. It answers with the
      // fact that it is not answering.
      window.setTimeout(() => {
        setThinking(false);
        setMessages((current) => [
          ...current,
          {
            id: `${id}-reply`,
            role: "assistant",
            body: "This is sample data, so I can't look at a real project. Import a design and set an AI provider to ask about your own.",
          },
        ]);
      }, 600);
      return;
    }

    // Sent with the thread so far, so a follow-up question keeps its referent.
    const priorTurns = messagesRef.current
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role as "user" | "assistant", body: message.body }));

    const reply = await askAssistantAction({ prompt: text, history: priorTurns });

    setThinking(false);
    setMessages((current) => [
      ...current,
      {
        id: `${id}-reply`,
        role: "assistant",
        body: reply.message,
        // Real provenance: which model, how many tokens, how long. An assistant
        // that hides what it spent is one nobody can audit.
        status: reply.status,
      },
    ]);
  }

  function apply(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, findings: undefined, actions: false, status: "3 changes applied · preview rebuilt" }
          : message,
      ),
    );
  }

  return (
    <>
      <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-[13.5px] scrollbar-thin" aria-live="polite">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex flex-col gap-1.5">
              <p className="flex items-center gap-2 text-caption font-semibold text-content-muted">
                <Avatar initials="TA" size="sm" />
                You
              </p>
              <p className="self-start rounded-[10px] bg-bg-subtle px-3 py-2.5">{message.body}</p>
            </div>
          ) : (
            <div key={message.id} className="flex flex-col gap-1.5">
              <p className="flex items-center gap-2 text-caption font-semibold text-content-muted">
                <AiGlyph />
                PixelForge
              </p>
              <div>
                <p>{message.body}</p>
                {message.findings && (
                  <ul className="my-2 flex flex-col gap-1.5">
                    {message.findings.map((finding) => (
                      <li key={finding.label} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-body-sm">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-error-soft text-error-text">
                          <X aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{finding.label}</span>
                        <span className="font-mono text-[11px] text-content-muted">{finding.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {message.files && (
                  <p className="text-body-sm">
                    Two files change:{" "}
                    {message.files.map((file, index) => (
                      <React.Fragment key={file}>
                        {index > 0 && " and "}
                        <code className="font-mono text-caption">{file}</code>
                      </React.Fragment>
                    ))}
                    .
                  </p>
                )}
                {message.status && (
                  <Banner tone="success" className="mt-2.5">{message.status}</Banner>
                )}
                {message.actions && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => apply(message.id)}>
                      <Check />
                      Apply changes
                    </Button>
                    <Button variant="secondary" size="sm"><Eye />Preview</Button>
                    <Button variant="ghost" size="sm"><Undo2 />Undo</Button>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {thinking && (
          <p className="flex items-center gap-2 text-caption text-content-muted">
            <AiGlyph pulse />
            Comparing the rendered page against the frame…
          </p>
        )}
      </div>

      <form onSubmit={send} className="shrink-0 border-t border-border p-3">
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-bg-surface p-3 shadow-sm focus-within:border-accent">
          <label htmlFor="assistant-input" className="sr-only">Ask the assistant for a change</label>
          <textarea
            id="assistant-input"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(event);
              }
            }}
            placeholder="Make the feature cards stack sooner on tablet…"
            className="resize-none bg-transparent text-base outline-none placeholder:text-content-muted sm:text-[13.5px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-bg-subtle px-2 py-1 text-caption text-content-secondary">
                <FileCode2 aria-hidden className="h-3.5 w-3.5" />
                Hero.tsx
              </span>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-sm bg-bg-subtle px-2 py-1 text-caption text-content-secondary hover:text-content">
                <Plus aria-hidden className="h-3.5 w-3.5" />
                Add context
              </button>
            </span>
            <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
              <ArrowUp />
              <span className="sr-only">Send message</span>
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
