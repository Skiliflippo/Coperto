# Coperto · Gestione sala e prenotazioni

App per la sala di un ristorante ad alta affluenza: tavoli in tempo reale, prenotazioni
telefoniche e walk-in. Veloce come la carta, pensata per mani occupate.

## Più ristoranti sullo stesso server

La pagina principale `/` è il portale di accesso: si inserisce il codice del locale
e l'app verifica che esista prima di aprire `/r/<slug>/login`. Non sceglie mai il
primo ristorante del database e uno slug errato resta sul portale con un messaggio chiaro.

Ogni locale ha il suo indirizzo: `/r/osteria-del-vicolo/login`. Chi entra da lì vede
solo la propria sala, il proprio personale e le proprie prenotazioni: il controllo
è sul server, non nell'interfaccia. Tentare di scrivere nei dati di un altro locale
restituisce `403`, anche conoscendone gli identificativi.

**Area sviluppatore** — `/admin`, protetta da `ADMIN_PASSWORD` nelle variabili
d'ambiente (senza quella variabile il pannello resta chiuso, risponde `503`).
Da lì registri un cliente inserendo nome del locale, nome del titolare e PIN:
l'app crea tutto il necessario e ti restituisce il link pronto da inviare.
Il pannello non è collegato da nessun menu dell'app.

## Primo avvio su database vuoto

Con un database appena creato (o svuotato) l'app si configura da sola: alla prima
visita mostra `/setup`, dove si inseriscono **nome del locale, nome del titolare e
PIN**. Subito dopo parte il percorso guidato della piantina, poi si entra in servizio.

Serve solo che lo schema sia applicato:

```bash
npx drizzle-kit push     # crea le tabelle (nessun seed necessario)
```

L'endpoint `/api/setup` accetta una sola configurazione: appena esiste un titolare
attivo si chiude e restituisce `409`. Da quel momento si entra da `/login`.

Per ripartire davvero da zero: svuota le tabelle e ricarica la pagina, oppure
disattiva l'ultimo titolare — l'app tornerà a proporre il primo avvio.

## Avvio rapido con dati demo (sviluppo)

```bash
npm install                      # 1 · dipendenze
cp .env.example .env             # 2 · metti la tua DATABASE_URL dentro .env
npx drizzle-kit push             # 3 · crea le tabelle nel database
npx tsx src/db/seed.ts           # 4 · dati demo: Osteria del Vicolo (18 tavoli, 72 coperti)
npm run dev                      # 5 · http://localhost:3000
```

Accesso demo: **Marco · PIN 1234** (titolare) · Sara 1111 · Luca 2222.

In produzione: `npm run build && npm start`. Deploy tipico: Vercel + qualsiasi Postgres
(Neon/Supabase/free tier). L'unica variabile d'ambiente richiesta è `DATABASE_URL`.

## Cosa copiare nel tuo progetto

Copia **tutto tranne**: `.env`, `node_modules/`, `.next/`. Attenzione: copiare i file
nuovi sopra una vecchia cartella **non elimina le route ritirate**. Prima della build
esegui sempre lo script di pulizia cross-platform:

```bash
node scripts/prepare-deploy.mjs
npm install
npx drizzle-kit push   # solo se lo schema è cambiato
npm run build
```

Lo script rimuove esclusivamente cache e percorsi legacy noti: `attesa`, `waitlist`,
la vecchia `floorplan.tsx`, le vecchie route `api/rooms/[id]/route.ts` e
`api/tables/route.ts`, e la config Drizzle JSON. Non tocca `.env`, database o sorgenti correnti. Se usi Git, preferisci
`git pull`: Git applica anche le cancellazioni, una copia manuale no.

Se non hai ancora copiato lo script aggiornato, in PowerShell puoi pulire manualmente:

```powershell
Remove-Item -Recurse -Force -LiteralPath "src\app\(app)\attesa" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force -LiteralPath "src\app\api\waitlist" -ErrorAction SilentlyContinue
Remove-Item -Force -LiteralPath "src\components\floorplan.tsx" -ErrorAction SilentlyContinue
Remove-Item -Force -LiteralPath "src\app\api\rooms\[id]\route.ts" -ErrorAction SilentlyContinue
Remove-Item -Force -LiteralPath "src\app\api\tables\route.ts" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force -LiteralPath ".next" -ErrorAction SilentlyContinue
Remove-Item -Force -LiteralPath "tsconfig.tsbuildinfo" -ErrorAction SilentlyContinue
```

## Struttura

```
├── drizzle.config.ts          # config Drizzle (legge .env)
├── public/
│   ├── manifest.webmanifest   # PWA: installabile su tablet/smartphone
│   ├── sw.js                  # service worker minimale
│   └── icon.svg
├── src/
│   ├── app/
│   │   ├── (app)/             # area autenticata (tab bar in basso)
│   │   │   ├── layout.tsx     #   shell: guardia PIN, realtime, tema
│   │   │   ├── sala/          #   VISTA SALA: tavoli live, walk-in, check-in
│   │   │   ├── prenotazioni/  #   elenco + Piano (timeline drag&drop, auto-sistema)
│   │   │   └── altro/         #   riepilogo, personale e impostazioni
│   │   ├── api/               # route handlers REST + SSE (/api/events)
│   │   ├── login/             # accesso PIN
│   │   ├── layout.tsx · globals.css · providers.tsx
│   ├── components/            # UI: piano, seat-flow, check-in, sheet, toast…
│   ├── db/                    # schema Drizzle + seed
│   ├── lib/                   # time, estimates, autoassign, hooks, api client
│   ├── server/                # hub realtime + query condivise
│   └── store/                 # zustand (sessione staff persistita)
└── .env.example
```

## Architettura in 30 secondi

- **Multi-tenant dal giorno 1**: ogni tabella ha `restaurant_id`. Configurazione = dati
  (`restaurant_settings`), non codice. Un nuovo ristorante = righe nel DB.
- **Prenotazione = intenzione · Seating = realtà**. Le deviazioni (ritardo, coperti
  diversi) sono la differenza tra le due, mai sovrascritte.
- **Realtime**: Server-Sent Events (`/api/events` + `src/server/hub.ts`). Per passare a
  Supabase Realtime basta riscrivere `broadcast()/subscribe()` — i client non cambiano.
- **Undo 10 secondi** sulle azioni distruttive (`src/components/toast.tsx`).
- **Auto-sistema**: greedy in `src/lib/autoassign.ts`, puro e testabile, con motivazioni.

## Risoluzione problemi dopo clone o reseed

### `/api/bootstrap?rid=...` restituisce 404 oppure la pagina resta vuota

Il browser può conservare in `localStorage` l'UUID del database precedente. La rotta
bootstrap ora recupera automaticamente `osteria-del-vicolo` (o il primo tenant valido)
e invalida la vecchia sessione: basta ricaricare e accedere di nuovo col PIN.

Se `/api/bootstrap` restituisce `503 DATABASE_EMPTY`, inizializza il DB:

```bash
npx drizzle-kit push
npx tsx src/db/seed.ts
```

Puoi verificare direttamente: `http://localhost:3000/api/bootstrap`. La risposta deve
contenere `restaurant`, `settings`, `rooms[].layout.elements`, `tables`, `combos` e `periods`.

## Comandi utili

| Comando | Cosa fa |
| --- | --- |
| `npx drizzle-kit push` | allinea il DB allo schema |
| `npx tsx src/db/seed.ts` | reset + dati demo (idempotente, slug `osteria-del-vicolo`) |
| `npm run typecheck` | TypeScript strict |
| `npm run build` | build di produzione |
