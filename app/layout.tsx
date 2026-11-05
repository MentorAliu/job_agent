import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeWatcher } from "@/components/theme";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Job Agent", template: "%s · Job Agent" },
  description: "Finds remote roles, scores them and prepares applications.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script adds the `dark` class before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
