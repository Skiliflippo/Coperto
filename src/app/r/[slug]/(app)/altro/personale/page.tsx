"use client";
// PERSONALE — chi entra in sala e con quale PIN. Solo il titolare.
// Il PIN non è una password: serve a firmare le azioni. Si reimposta in un tocco.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Plus, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { Btn, Field, Input, Sheet, SkeletonRows } from "@/components/ui";
import { toast } from "@/components/toast";
import { useTenantPath } from "@/lib/tenant";

type StaffRow = { id: string; name: string; role: string; color: string };

export default function PersonalePage() {
  const tp = useTenantPath();
  const staff = useSession((s) => s.staff);
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [pinFor, setPinFor] = useState<StaffRow | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"staff" | "titolare">("staff");
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["staff-list"],
    queryFn: () => api<{ staff: StaffRow[] }>("/api/staff"),
  });

  if (staff?.role !== "titolare") {
    return (
      <div className="px-4 pt-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-soon" />
        <p className="mt-3 font-bold">Solo il titolare gestisce il personale.</p>
        <Link href={tp("/altro")} className="mt-4 inline-block rounded-2xl bg-raised px-5 py-3 font-semibold">Torna ad Altro</Link>
      </div>
    );
  }

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api("/api/staff/manage", {
        method: "POST",
        body: { restaurantId: staff.restaurantId, staffId: staff.id, staffName: staff.name, ...body },
      });
      await qc.invalidateQueries({ queryKey: ["staff-list"] });
      return true;
    } catch (e: any) { toast({ title: e.message, tone: "err" }); return false; }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (await call({ action: "create", name, pin, role })) {
      toast({ title: `${name.trim()} può entrare col PIN ${pin}`, tone: "ok" });
      setName(""); setPin(""); setRole("staff"); setAddOpen(false);
    }
  };
  const changePin = async () => {
    if (!pinFor) return;
    if (await call({ action: "pin", targetId: pinFor.id, pin })) {
      toast({ title: `Nuovo PIN di ${pinFor.name}: ${pin}`, tone: "ok" });
      setPin(""); setPinFor(null);
    }
  };

  const rows = list.data?.staff ?? [];

  return (
    <div className="px-4 pb-6">
      <header className="flex items-center gap-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <Link href={tp("/altro")} className="grid h-12 w-12 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Indietro"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-[24px] font-bold">Personale</h1>
      </header>

      {list.isLoading ? <div className="mt-4"><SkeletonRows n={3} h={76} /></div> : (
        <div className="mt-4 space-y-2">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: p.color }}>
                {p.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{p.name}{p.id === staff.id && <span className="ml-1.5 text-[13px] font-semibold text-muted">(tu)</span>}</p>
                <button onClick={() => call({ action: "role", targetId: p.id, role: p.role === "titolare" ? "staff" : "titolare" })}
                  className="text-[13px] font-semibold text-muted underline decoration-dotted">
                  {p.role === "titolare" ? "Titolare" : "Staff di sala"}
                </button>
              </div>
              <button onClick={() => { setPin(""); setPinFor(p); }} aria-label={`Cambia PIN di ${p.name}`}
                className="grid h-11 w-11 place-items-center rounded-xl bg-raised text-muted active:scale-95"><KeyRound className="h-[18px] w-[18px]" /></button>
              <button onClick={() => call({ action: "delete", targetId: p.id })} aria-label={`Rimuovi ${p.name}`}
                className="grid h-11 w-11 place-items-center rounded-xl bg-over/15 text-over active:scale-95"><Trash2 className="h-[18px] w-[18px]" /></button>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => { setName(""); setPin(""); setAddOpen(true); }}
        className="mt-3 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-bold text-muted active:scale-[0.98]">
        <Plus className="h-5 w-5" /> Aggiungi una persona
      </button>
      <p className="mt-3 text-center text-[13px] text-muted">
        Chi viene rimosso non entra più, ma resta leggibile nello storico delle azioni.
      </p>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={<span className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-brand" /> Nuova persona</span>}>
        <div className="grid gap-4">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Giulia" autoComplete="off" /></Field>
          <Field label="PIN a 4 cifre">
            <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(["staff", "titolare"] as const).map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={`min-h-[56px] rounded-2xl font-bold active:scale-95 ${role === r ? "bg-brand text-on-brand" : "bg-raised"}`}>
                {r === "staff" ? "Staff di sala" : "Titolare"}
              </button>
            ))}
          </div>
          <Btn size="xl" disabled={busy || !name.trim() || pin.length !== 4} onClick={create}>Aggiungi</Btn>
        </div>
      </Sheet>

      <Sheet open={!!pinFor} onClose={() => setPinFor(null)} title={`Nuovo PIN per ${pinFor?.name ?? ""}`}>
        <div className="grid gap-4">
          <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="4 cifre" />
          <Btn size="xl" disabled={busy || pin.length !== 4} onClick={changePin}>Cambia PIN</Btn>
        </div>
      </Sheet>
    </div>
  );
}
