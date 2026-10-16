import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-info";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
});

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: `${APP_NAME}: سامانه داخلی مدیریت فعالیت‌های تجاری شرکت`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
