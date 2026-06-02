import type { Metadata } from "next";
import { Baloo_Bhaijaan_2 } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { BRAND } from "@/lib/branding";

const baloo = Baloo_Bhaijaan_2({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-baloo',
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} | نظام إدارة موارد المؤسسة`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${baloo.variable} font-jakarta antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
