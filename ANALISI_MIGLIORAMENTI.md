# Coperto — Analisi aggiornata dopo lettura codice
*Data: 2026-09-16 — Ho letto floor-view, piano, month-view, table-sheet, seat-flow, reservation-form, checkin, status-bar, app-shell*

## 0. Fix immediato

**Portale:** `Lo trovi nel messaggio ricevuto dal ristoratore.` → `Lo trovi nell'email di attivazione.` (`src/app/page.tsx:91`)  
**Build Vercel:** `onClick={fit}` → `onClick={() => fit()}` in floor-view/editor (TS2322)

---

## 1. Cosa esiste già (non si vedeva dagli screenshot vuoti)

Hai ragione, metà della mia lista precedente esiste già nel codice — non avevi prenotazioni negli screenshot quindi non si vedeva:

**Mese heatmap:** esiste. In `month-view.tsx:38-65` c'è `load = covers / roomCapacity` e barra `absolute inset-x-1 bottom-1 h-1` con `width: ${load*100}%`. Se non hai prenotazioni, `c` è null e mostra "—". Quindi è corretto, appare solo con dati.

**Piano — molto più avanzato di quanto pensassi:**
- Drag & drop con preview (`piano.tsx:197-240` dropTarget + preview)
- Auto-sistema con motivazioni (`/api/autoassign` + `planLargeParty`)
- Rail "Da sistemare" con chip trascinabili
- Overbooking detection per slot (`slotLoad >= overbookingPct`)
- Conflitti stesso tavolo evidenziati (`conflicts`)
- Colonne con larghezza proporzionale ai posti (`46 + (cap-2)*7`)
- Stampa lista cartacea (print-area hidden) — perfetto per transizione carta→digitale

**Gestione sala:**
- Split/Merge tavoli (`/api/tables/[id]/split`) già in `table-sheet.tsx:43-63` e `seat-flow.tsx:128-160`
- Join proposals con `findJoinProposals` e `maxGapCm` (hai setting 150cm)
- Note tavolo/seating con placeholder "compleanno, allergia, abituale…" (`table-sheet.tsx:196`)
- Check-in con ritardo/anticipo, no-show, cambio tavolo, chiamata telefono (`checkin-sheet.tsx`)
- Walk-in "Quanti siete?" con scoring "Perfetto, nessuno spreco / Buon incastro" (`seat-flow.tsx`)

**PWA/offline:** service worker in `providers.tsx:11`, guard anti-zoom in `pwa-guard.tsx`, realtime SSE in `hooks.ts:53` con badge Live/Offline.

Quindi **non serve** riproporre: heatmap, drag-drop piano, split/join, note, check-in, auto-sistema. Esistono.

---

## 2. Contesto corretto — app introduttiva per chi è su carta

Obiettivo non è SevenRooms enterprise, ma **sostituire quaderno e piantina plastificata**. Il ristoratore su carta ha 3 dolori:
1. Non sa quanti coperti ha davvero liberi a colpo d'occhio
2. Perde prenotazioni al telefono (scritte male, dimenticate)
3. Litiga con colleghi su "chi ha spostato il tavolo 12"

Tutto ciò che è integrazione TheFork/Google, depositi, carta su file, WhatsApp bot, Voice AI — lo mettiamo in **FUTURO**, come hai chiesto.

---

## 3. Miglioramenti concreti per la fase introduttiva (12 quick win + 10 idee)

### A. QUICK WIN UI — si vedono subito in demo (1-2h ciascuno)

**A1. FAB "+" copre timeline in Piano**
In `prenotazioni/page.tsx:230` il FAB è `bottom-[calc(...82px)] right-4` fixed. Quando scorri orizzontalmente i tavoli, copre l'ultima colonna. Fix: sposta in alto vicino a "Auto-sistema" o aggiungi `pb-[120px]` al contenitore piano. Oggi in screenshot 6 il + copre griglia.

**A2. Zoom controls 40px → 48px e safe area**
In `floor-view.tsx:153-155` sono 40px. Su iPad con mani unte servono 44-48px min (Apple HIG). Aggiungi `h-12 w-12` e `bottom-[calc(16px+env(safe-area-inset-bottom))]`

**A3. StatusBar sotto mappa troppo piccola**
`status-bar.tsx:27` usa `text-[11px]`. Su carta il titolare vuole leggere da 1m. Porta a 12px e aggiungi sempre `(coperti)` non solo su sm: oggi è `hidden sm:inline` quindi su telefono non si capisce se "36 liberi" sono tavoli o coperti.

**A4. Lista "Elenco" in Sala (ListView) — manca stato**
In `sala/page.tsx:154-168` mostri solo tavolo e dot. Aggiungi orario prenotazione se prenotato: già fai in `table-sheet` ma non in lista. Mostra "20:00 Rossi" invece di solo "prenotato".

**A5. Prenotazioni Elenco — card più leggibile**
Oggi `prenotazioni/page.tsx:138` mostra ora grande ma note troncate. Per chi viene da carta, serve **telefono sempre visibile** + **sala**. Aggiungi icona telefono sempre, non solo se esiste chip.

**A6. Portale — aggiungi "Hai perso il codice? Contattaci"**
In `page.tsx` sotto bottone, link WhatsApp `wa.me/...` con messaggio precompilato "Ciao, ho perso codice locale Coperto". Per venditore è lead gen.

**A7. Impostazioni — raggruppa con accordion**
In `altro/impostazioni` hai 20+ righe con -/+ identiche. Chi è su carta si spaventa. Raggruppa in 4 accordion: Tavoli, Servizio, Avvisi, Permanenza. Chiudi di default tranne Tavoli.

**A8. Riepilogo vuoto — empty state utile**
In `altro/page.tsx` se 0 coperti, mostra "Nessun servizio oggi. Inizia turno alle 11:46" + bottone "Vai in Sala". Oggi mostra solo 0 ovunque.

### B. FUNZIONALITÀ INTRODUTTIVE — per convincere chi usa carta

**B1. Stampa foglio sala giornaliero (già esiste print-area, ma miglioralo)**
Hai già `<div className="print-area hidden">` in prenotazioni. Aggiungi anche in Sala: stampa piantina con stato tavoli + lista prenotazioni del giorno. Il ristoratore su carta vuole appendere foglio in cucina. Aggiungi QR su stampa che riporta a Coperto.

**B2. Modalità "Solo oggi, niente passato"**
Chi è su carta non vuole vedere date passate. Aggiungi toggle in alto "Oggi" fisso, e calendario nascosto dietro icona. Oggi DayNav è sempre visibile, confonde.

**B3. Undo visibile dopo libera tavolo**
Hai già `runWithUndo` in `table-sheet.tsx:92`. Ma toast scompare in 3s. Per chi è su carta, che ha paura di sbagliare, mostra barra undo fissa in basso per 10s: "Tavolo 12 liberato — Annulla".

**B4. Tour guidato per primo accesso**
In `onboarding.tsx` già c'è primo avvio. Aggiungi 3 step in Sala: "Tocca tavolo per sedere", "Trascina prenotazione su Piano", "Vedi Riepilogo a fine sera". 30s max.

**B5. Contatore "Quanto manca a fine servizio"**
Per chi è su carta, sapere "Mancano 8 coperti per finire" è motivante. Mostra in StatusBar: "36 liberi (124 coperti) · 12 in arrivo".

**B6. Note rapide con chip anche su tavolo**
Hai chip note in prenotazione form (`NOTE_CHIPS`), ma in `table-sheet` nota è input libero. Riutilizza stessi chip: "Compleanno", "Seggiolone", "Allergia" — un tap, non digitare.

**B7. Backup/export locale**
Chi è su carta ha paura "se perdo telefono?". Aggiungi in Altro → "Esporta backup" che scarica JSON di tavoli + prenotazioni. Già hai CSV in riepilogo, estendi.

**B8. Sezione "Fuori/Dentro" più chiara**
Oggi sono pill in `room-tabs.tsx`. Aggiungi icona sole/ombrello e capienza per sala: "Fuori · 36 tavoli · 124p". Così capisce dove conviene mettere.

### C. IDEE INNOVATIVE MA SEMPLICI (ispirate ad altri ambiti, non enterprise)

**C1. Come iOS Notes: swipe su prenotazione per azioni rapide**
Swipe destra su card prenotazione → "Check-in", swipe sinistra → "Cancella". Più veloce di aprire sheet.

**C2. Come Apple Watch: complicazione permanenza**
Sul tavolo occupato mostra cerchio che si chiude (come anello attività) in base a `durationFor(partySize)`. Vedi a colpo d'occhio chi è oltre tempo senza leggere numeri.

**C3. Come Google Maps: "Orari di punta"**
Nel Mese view, oltre alla barra, mostra sotto "Martedì e venerdì più pieni". Usa `monthRes` già calcolato per suggerire.

**C4. Come Linear: Cmd+K per power user**
Palette comandi "Vai a tavolo 12", "Cerca Rossi". Per te in demo è wow, per ristoratore su carta non serve ma per te come venditore sì.

---

## 4. Cosa mettere da parte per FUTURO (come richiesto)

Tutto ciò che riguarda:
- Integrazione TheFork, Google Reservations, Resy, OpenTable
- Depositi, pre-autorizzazioni, no-show fee, carta su file (riduce no-show 65% [TheFork] ma è per fase 2)
- WhatsApp Business bot, Voice AI telefonate, QR waitlist esterno
- Marketing automation, CRM avanzato con storico allergie/compleanni
- Overbooking intelligente con AI prediction

Queste restano in backlog. Quando avrai 20+ locali attivi e dati reali, le riprendiamo. Per ora focus: **far smettere di usare carta in 5 minuti**.

---

## 5. Priorità per te (venditore)

Per vendere a chi è su carta, fai demo in questo ordine:

1. **Portale + codice** (10s) → mostra che è già suo locale, non generico
2. **Sala mappa** → "Tocca tavolo 12, siedi 2" (5s) vs scrivere su foglio
3. **Prenotazione telefono** → compila in 20s con PartyGrid (mostra anti-duplicato)
4. **Piano drag-drop** → trascina prenotazione su tavolo, vedi conflitto rosso
5. **Riepilogo sera** → "Oggi 87 coperti, 2 no-show" — valore immediato

Se in questi 5 step il ristoratore dice "è più facile della carta", hai vinto. Non serve altro per fase introduttiva.

---

## 6. Checklist fix immediati da fare prima di prossima demo

- [ ] FAB + in Piano non deve coprire ultima colonna tavoli
- [ ] StatusBar: mostra sempre coperti, non solo su sm
- [ ] ListView Sala: mostra orario prenotazione se stato prenotato
- [ ] MonthView: verifica barra appare con dati (testa con seed di 5 prenotazioni)
- [ ] Impostazioni: accordion per non spaventare
- [ ] Portale: link WhatsApp "Hai perso codice?"
- [ ] Stampa: aggiungi piantina + lista in print-area anche per Sala
- [ ] Undo: allunga a 10s e rendi più visibile

*Ho rimosso dalla lista precedente tutto ciò che già esiste nel codice (verificato in piano.tsx, month-view.tsx, table-sheet.tsx, seat-flow.tsx).*
