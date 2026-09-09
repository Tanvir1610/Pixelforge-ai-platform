import "server-only";

import type { DomSnapshot } from "./types";

/**
 * Browser capture.
 *
 * An interface first, because the browser is the least portable part of the
 * platform: Playwright locally, a remote browser pool in production, and a
 * recorded fixture in tests. Everything downstream consumes `Capture` and never
 * knows which produced it.
 *
 * NOTE: the Playwright implementation below is not exercised by the test suite —
 * this environment has no browser binary available. It is written against the
 * documented API and needs a run against a real browser before it is trusted.
 * The comparison logic it feeds is fully tested independently, which is the
 * part that decides what a difference *is*.
 */
export interface Capture {
  breakpoint: number;
  /** PNG bytes of the full page. */
  screenshot: Buffer;
  snapshot: DomSnapshot;
}

export interface CaptureOptions {
  url: string;
  breakpoints: number[];
  /** Wait for fonts and images before capturing, or text shifts under us. */
  settleMs?: number;
  timeoutMs?: number;
}

/** The slice of Playwright's context/page API this file uses. */
interface PlaywrightPage {
  goto: (url: string, options: unknown) => Promise<unknown>;
  evaluate: (script: string) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (options: unknown) => Promise<Buffer>;
}

interface PlaywrightContext {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

export interface Screenshotter {
  capture(options: CaptureOptions): Promise<Capture[]>;
  dispose(): Promise<void>;
}

/**
 * Extracts measured geometry from the live page.
 *
 * Runs inside the browser, so it must be self-contained. `data-pf-node` is
 * stamped on by the generator and is what pairs an element back to its Design
 * IR node — text matching is only a fallback.
 */
export const EXTRACT_DOM_SCRIPT = `(() => {
  const parsePx = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const selectorFor = (element) => {
    if (element.id) return '#' + element.id;
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const first = current.className.trim().split(/\\s+/)[0];
        if (first) part += '.' + first;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };

  const nodes = [];
  const elements = document.querySelectorAll('body *');

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    // Zero-area elements are not rendered and cannot differ visually.
    if (rect.width === 0 && rect.height === 0) continue;
    if (nodes.length > 3000) break;

    const styles = getComputedStyle(element);
    const ownText = Array.from(element.childNodes)
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent.trim())
      .join(' ')
      .trim();

    nodes.push({
      sourceNodeId: element.getAttribute('data-pf-node') || undefined,
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      rect: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      },
      padding: {
        top: parsePx(styles.paddingTop),
        right: parsePx(styles.paddingRight),
        bottom: parsePx(styles.paddingBottom),
        left: parsePx(styles.paddingLeft),
      },
      fontSize: parsePx(styles.fontSize),
      fontWeight: Number.parseInt(styles.fontWeight, 10) || undefined,
      lineHeight: styles.lineHeight === 'normal' ? undefined : parsePx(styles.lineHeight),
      color: styles.color,
      backgroundColor: styles.backgroundColor,
      borderRadius: parsePx(styles.borderTopLeftRadius),
      textContent: ownText || undefined,
    });
  }

  return {
    viewport: { width: window.innerWidth, height: document.documentElement.scrollHeight },
    nodes,
  };
})()`;

/**
 * Playwright-backed capture.
 *
 * Playwright is imported dynamically so the package stays an optional
 * dependency — the platform must build and run without a browser installed,
 * which is exactly the situation in CI and in this repository today.
 */
export class PlaywrightScreenshotter implements Screenshotter {
  /** Typed as unknown: Playwright's types are unavailable at build time. */
  private browser: { newContext: (options: unknown) => Promise<PlaywrightContext>; close: () => Promise<void> } | null =
    null;

  private async launch(): Promise<NonNullable<typeof this.browser>> {
    if (this.browser) return this.browser;

    // Resolved at runtime, not build time: `import("playwright")` would make
    // TypeScript demand the package be installed to typecheck, and the whole
    // point is that it is optional.
    let playwright: { chromium: { launch: (options: unknown) => Promise<unknown> } };
    try {
      const specifier = "playwright";
      playwright = (await import(specifier)) as typeof playwright;
    } catch {
      throw new Error(
        "Playwright is not installed. Run `npm i -D playwright && npx playwright install chromium` to enable visual comparison.",
      );
    }

    this.browser = (await playwright.chromium.launch({
      // The page is generated code from an untrusted design; it must not get a
      // privileged browser. These are the same restrictions the sandbox applies.
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    })) as NonNullable<typeof this.browser>;
    return this.browser;
  }

  async capture(options: CaptureOptions): Promise<Capture[]> {
    const browser = await this.launch();
    const captures: Capture[] = [];

    for (const breakpoint of options.breakpoints) {
      const context = await browser.newContext({
        viewport: { width: breakpoint, height: 900 },
        deviceScaleFactor: 1,
        // Deterministic rendering: a different timezone or locale changes date
        // formatting and shifts text, producing false differences.
        locale: "en-GB",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });

      const page = await context.newPage();
      try {
        await page.goto(options.url, {
          waitUntil: "networkidle",
          timeout: options.timeoutMs ?? 30_000,
        });
        // Fonts settle after networkidle; capturing before they load compares
        // a fallback face against the design's real one.
        await page.evaluate("document.fonts && document.fonts.ready");
        await page.waitForTimeout(options.settleMs ?? 400);

        const screenshot: Buffer = await page.screenshot({ fullPage: true, type: "png" });
        const extracted = (await page.evaluate(EXTRACT_DOM_SCRIPT)) as Omit<DomSnapshot, "breakpoint">;

        captures.push({
          breakpoint,
          screenshot,
          snapshot: { breakpoint, viewport: extracted.viewport, nodes: extracted.nodes },
        });
      } finally {
        await context.close();
      }
    }

    return captures;
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
