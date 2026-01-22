import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "模擬試験アプリ",
  description: "問題セットを読み込んで効率的に学習できる模擬試験アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
