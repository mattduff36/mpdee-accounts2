import type { Metadata } from "next"
import "./globals.css"
export const metadata: Metadata = { title: "Accounts - Small Business Accounting", description: "Invoicing, expenses, and accounting for small UK businesses" }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="antialiased">{children}</body></html>
}
