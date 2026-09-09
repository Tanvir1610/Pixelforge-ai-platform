import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PixelForge AI — Turn Figma designs into production-ready websites",
    template: "%s · PixelForge AI",
  },
  description:
    "Transform pixel-perfect Figma designs into responsive, production-ready websites without rebuilding your UI from scratch.",
  metadataBase: new URL("https://pixelforge.ai"),
  openGraph: {
    title: "PixelForge AI",
    description: "Turn Figma designs into production-ready websites.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#FAFAFA", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts are linked rather than loaded through next/font so the project
          builds in offline CI. Swap to next/font/google (or next/font/local with
          self-hosted files) if you want the zero-layout-shift inlining.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router: this <head> is applied to every route, not a single page. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-bg-dark focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
