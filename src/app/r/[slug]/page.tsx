"use client";
// Redirect da /r/[slug] a /r/[slug]/sala o /r/[slug]/login
// Fix 404 visto su Vercel preview: la landing faceva replace a /r/slug che non esisteva
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/store/session";
import { useTenant, useTenantPath } from "@/lib/tenant";

export default function TenantRootPage() {
  const router = useRouter();
  const slug = useTenant();
  const tp = useTenantPath();
  const staff = useSession((s) => s.staff);
  const hydrated = useSession((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    if (!slug) {
      router.replace("/");
      return;
    }
    router.replace(tp(staff ? "/sala" : "/login"));
  }, [hydrated, slug, staff, router, tp]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="grid h-16 w-16 animate-pop place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand">C</div>
        <p className="text-sm font-semibold text-muted">Apro {slug}…</p>
      </div>
    </div>
  );
}
