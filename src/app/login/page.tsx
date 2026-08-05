"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const form = new FormData(e.currentTarget)
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) })
    setLoading(false)
    if (res.ok) { router.push("/dashboard"); router.refresh() }
    else { const data = await res.json().catch(() => ({})); setError(data.error || "Invalid credentials") }
  }

  return <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.28),_transparent_34rem),radial-gradient(circle_at_bottom_right,_rgba(37,99,235,0.2),_transparent_30rem)]" />
    <div className="relative w-full max-w-md">
      <div className="rounded-3xl border border-white/10 bg-white/[0.97] p-8 shadow-2xl shadow-slate-950/30">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-blue-900/30">
            <Building2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Accounts</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to manage invoices, costs, and reports.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</div>}
          <div><label className="mb-1 block text-sm font-semibold text-slate-700">Email</label><Input name="email" type="email" required placeholder="admin@example.com" defaultValue="admin@example.com" /></div>
          <div><label className="mb-1 block text-sm font-semibold text-slate-700">Password</label><Input name="password" type="password" required placeholder="changeme123" defaultValue="changeme123" /></div>
          <Button type="submit" disabled={loading} className="w-full">{loading ? "Signing in..." : "Sign In"}</Button>
        </form>

        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          Default: admin@example.com / changeme123
        </div>
      </div>
    </div>
  </div>
}
