import type { Metadata } from "next";
import "@razorpay/blade/fonts.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "FlowLens — Observe the journey. Discover the friction.",
  description:
    "Test a user journey on any website. Provide your persona, define a task, and observe an AI agent attempt the journey.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
