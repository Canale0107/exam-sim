import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "study (BYOS)",
  description: "BYOS (Bring Your Own Storage) の模試/学習UI。進捗のみ保存します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
