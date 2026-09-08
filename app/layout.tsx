import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./native-shell.css";

export const metadata: Metadata = {
  title: "CSS Trade Counter Kiosk",
  description: "Chelmsford Safety Supplies customer trade-counter kiosk",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
