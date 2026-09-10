"use client";

import * as React from "react";
import { Check, Copy, Eye, LayoutGrid, Lock, Plus, Rocket, SquareArrowOutUpRight, Zap } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { OptionGroup } from "@/components/ui/option-group";
import { Progress } from "@/components/ui/progress";
import { StatusDot } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { useSequence } from "@/hooks/use-sequence";
import type { Deployment, HostProvider, TaskState } from "@/types";

const HOSTS = [
  { value: "Vercel" as HostProvider, label: "Vercel", swatch: "#111111" },
  { value: "Netlify" as HostProvider, label: "Netlify", swatch: "#0E1E25" },
  { value: "Cloudflare" as HostProvider, label: "Cloudflare", swatch: "#F38020" },
];

const ENV_VARS = [
  { key: "NEXT_PUBLIC_SITE_URL", value: "https://northwind.com", secret: false },
  { key: "ANALYTICS_ID", value: "••••••••••••", secret: true },
  { key: "CONTACT_ENDPOINT", value: "••••••••••••", secret: true },
];

const STEPS = [
  { id: "build", label: "Building", state: "pending" as TaskState, result: "32s" },
  { id: "upload", label: "Uploading", state: "pending" as TaskState, result: "8s" },
  { id: "deploy", label: "Deploying", state: "pending" as TaskState },
  { id: "live", label: "Live", state: "pending" as TaskState },
];

const LOG = [
  "▲ Installing dependencies…", "▲ Compiled successfully in 8.2s", "▲ Collecting page data",
  "▲ Generating static pages (6/6)", "▲ Route sizes — first load 96 kB", "▲ Uploading build output…",
];

export function DeployWorkspace({ deployments }: { deployments: Deployment[] }) {
  const [host, setHost] = React.useState<HostProvider>("Vercel");
  const [started, setStarted] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { items, percent, complete, setRunning } = useSequence(STEPS, 1500, false);

  function deploy() {
    setStarted(true);
    setRunning(true);
  }

  async function copyUrl() {
    await navigator.clipboard?.writeText("https://northwind.com");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader
            title="Where it goes"
            description="Connected hosts appear here. Switching provider re-runs the build."
          />
          <CardBody>
            <OptionGroup label="Deployment host" options={HOSTS} value={host} onChange={setHost} columns={3} />
            <p className="text-caption text-content-muted">
              {host === "Vercel" ? "Connected as basalt-studio." : `Connect your ${host} account to continue.`}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Build configuration" />
          <CardBody>
            <Field label="Build command" htmlFor="build-cmd">
              <Input id="build-cmd" defaultValue="next build" className="font-mono" />
            </Field>
            <Field label="Output directory" htmlFor="out-dir">
              <Input id="out-dir" defaultValue=".next" className="font-mono" />
            </Field>
            <Field label="Node version" htmlFor="node-version">
              <Input id="node-version" defaultValue="20.x" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Environment variables"
            description="Encrypted at rest and injected at build time only."
          />
          <CardBody>
            <table className="w-full overflow-hidden rounded-[10px] border border-border text-caption">
              <thead>
                <tr className="bg-bg text-left text-content-muted">
                  <th scope="col" className="border-b border-border px-3 py-2.5 font-medium">Key</th>
                  <th scope="col" className="border-b border-border px-3 py-2.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {ENV_VARS.map((variable) => (
                  <tr key={variable.key}>
                    <td className="border-b border-border px-3 py-2.5 last:border-b-0">{variable.key}</td>
                    <td className="border-b border-border px-3 py-2.5">{variable.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button variant="secondary" size="sm" className="self-start">
              <Plus />
              Add variable
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Domain" />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-[200px] flex-1" defaultValue="northwind.com" aria-label="Custom domain" />
              <Button variant="secondary">Verify DNS</Button>
            </div>
            <Banner tone="success">DNS verified. Certificate issued and auto-renewing.</Banner>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        {complete ? (
          <section className="relative overflow-hidden rounded-[14px] bg-bg-dark p-7 text-white">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 bg-[radial-gradient(circle,rgba(34,197,94,.35),transparent_65%)]" />
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[rgba(34,197,94,.15)] text-[#4ADE80]">
              <Check aria-hidden className="h-[18px] w-[18px]" strokeWidth={3} />
            </span>
            <h2 className="relative mb-1.5 mt-3.5 font-display text-[24px] font-bold tracking-[-0.02em]">
              Your website is live.
            </h2>
            <p className="relative text-body-sm text-content-on-dark">
              Deployed to production in 51 seconds. Every future generation gets a preview URL first.
            </p>
            <p className="relative my-4 flex items-center gap-2 rounded-md border border-[#2E2E2E] bg-black px-3 py-2.5 font-mono text-body-sm">
              <Lock aria-hidden className="h-3.5 w-3.5 text-success" />
              https://northwind.com
            </p>
            <div className="relative flex flex-wrap gap-2">
              <Button variant="primary">
                <SquareArrowOutUpRight />
                Open website
              </Button>
              <Button variant="onDark" onClick={copyUrl}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy URL"}
              </Button>
            </div>
          </section>
        ) : (
          <Card>
            <CardBody>
              <div className="flex items-center justify-between">
                <b className="text-body">Deployment progress</b>
                <Badge tone={started ? "accent" : "neutral"} dot={started}>
                  {started ? "Running" : "Not started"}
                </Badge>
              </div>
              <Progress value={started ? percent : 0} label="Deployment progress" />
              <ol>
                {items.map((step) => (
                  <li key={step.id} className="flex items-center gap-3 border-t border-border py-3 text-body first:border-t-0">
                    <StatusDot state={started ? step.state : "pending"} />
                    <span className="min-w-0 flex-1">{step.label}</span>
                    {step.result && step.state === "done" && (
                      <span className="font-mono text-caption text-content-muted">{step.result}</span>
                    )}
                  </li>
                ))}
              </ol>
              <Button variant="primary" onClick={deploy} disabled={started} loading={started && !complete}>
                <Rocket />
                Deploy to production
              </Button>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Build log" action={<Button variant="ghost" size="xs">Copy</Button>} />
          <div className="px-[18px] py-3.5 font-mono text-caption leading-[1.9] text-content-secondary">
            {LOG.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {complete && <p className="text-success-text">▲ Deployment ready — northwind.com</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent deployments" action={<Button variant="ghost" size="xs">All</Button>} />
          <table className="w-full text-body-sm">
            <caption className="sr-only">Recent deployments for this project</caption>
            <tbody>
              {deployments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-content-muted">
                    Nothing deployed yet. Your first deployment will appear here.
                  </td>
                </tr>
              ) : (
                deployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td className="border-b border-border px-4 py-3 font-mono text-caption">{deployment.hash}</td>
                    <td className="border-b border-border px-4 py-3">
                      <Badge
                        tone={
                          deployment.status === "ready" ? "success"
                          : deployment.status === "failed" ? "error"
                          : "warning"
                        }
                        dot={deployment.status !== "failed"}
                      >
                        {deployment.status === "ready" ? "Ready"
                          : deployment.status === "failed" ? "Failed"
                          : "Building"}
                      </Badge>
                    </td>
                    <td className="border-b border-border px-4 py-3 text-content-muted">{deployment.time}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="What now" />
          <CardBody className="gap-2.5">
            {[
              { icon: LayoutGrid, text: "Re-import the Figma file when the design changes", cta: "Import" },
              { icon: Eye, text: "Share a preview link with your client", cta: "Share" },
              { icon: Zap, text: "Deploy automatically on every push", cta: "Connect" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.cta} className="flex items-center gap-2 text-body-sm">
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1">{item.text}</span>
                  <Button variant="ghost" size="xs">{item.cta}</Button>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
