"use client";
// Rete di sicurezza: se un dato sporco dal server arriva a rompere il render
// (campo null imprevisto), NON si mostra più la pagina bianca che sembra un
// crash dell'app — si offre subito il riavvio. Nessun log, nessuna diagnostica.
import { Component, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* nessun log: esperienza sala silenziosa */ }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-soon/15 text-soon">
            <TriangleAlert className="h-8 w-8" />
          </div>
          <p className="font-display text-xl font-bold">Qualcosa si è inceppato.</p>
          <p className="text-sm font-semibold text-muted">Un ricarico sistema quasi sempre: i dati della sala non si perdono.</p>
          <button onClick={() => window.location.reload()}
            className="mt-2 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.97]">
            <RefreshCw className="h-5 w-5" /> Ricarica l'app
          </button>
        </div>
      </div>
    );
  }
}
