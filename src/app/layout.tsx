import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { profile } from "@/profile";
import "./globals.css";

export const metadata: Metadata = {
  title: `${profile.name} · My little corner`,
  description: profile.bio,
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  openGraph: { title: profile.name, description: profile.bio, type: "profile" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#100918" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={GeistSans.variable}><body>{children}</body></html>;
}
