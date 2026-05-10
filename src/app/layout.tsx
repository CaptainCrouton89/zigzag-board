import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zigzag Board",
  description: "Recursive priority board — weave between directional sagas in priority order.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
