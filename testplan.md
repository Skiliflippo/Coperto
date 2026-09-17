# Coperto — Test Plan Esaustivo (Bugproof Release 1)

Obiettivo: primo rilascio senza crash, con UX da app carta (veloce, 60fps, no bug ghiaccio).

---

## 1. Landing / Tenant / Auth

### 1.1 Codice locale
- [ ] Input vuoto → errore "Inserisci il codice del tuo locale."
- [ ] Codice con spazi, minuscole, simboli → normalizzato uppercase alfanumerico (es. ` k7-mq 2xrq4t ` → `K7MQ2XRQ4T`)
- [ ] Codice inesistente → ApiError mostrato
- [ ] Codice valido → redirect `/r/{slug}/login`
- [ ] rememberedSlug presente + hydrated → auto-redirect a `/r/{rememberedSlug}` senza chiedere codice
- [ ] Frase sotto input = "Lo trovi nel messaggio di attivazione." (non email, non messaggio ricevuto dal ristoratore)
- [ ] Enter submit funziona
- [ ] Loading state "Controllo…" disabilita bottone

### 1.2 Login PIN
- [ ] PIN errato → errore
- [ ] PIN corretto → setStaff + rememberLocale + redirect sala
- [ ] Staff titolare vs staff → UI diversa (matita editor solo titolare)

### 1.3 Session / Tenant
- [ ] rememberLocale salva slug in localStorage (zustand persist)
- [ ] forgetLocale azzera rememberedSlug, slug, staff, roomId, roomOrder
- [ ] "Cambia locale" NON esiste in Altro (rimosso) — verifica DOM
- [ ] "Cambia utente" esiste e fa setStaff(null) → login
- [ ] Theme toggle light/dark persiste

---

## 2. Sala — Vista Mappa (FloorView)

### 2.1 Viewport base
- [ ] fit() al mount e al cambio stanza → tutta la sala visibile con padding 34
- [ ] Zoom min = max(MIN_ZOOM, (vw-pad)/boundsW *0.8) — sala piccola centrata con margine 30% o 140px
- [ ] Zoom max = MAX_ZOOM 2.4
- [ ] Pan clamp: se sala più piccola di viewport → clamp con margine, se più grande → clamp con margine negativo
- [ ] GridBackdrop: cell = CM_PER_CELL*zoom, se cell<4 → null, transform modulo major per evitare repaint, backgroundSize aggiornata solo se zoom delta >0.001
- [ ] contentRef transform = translate3d(panX, panY, 0) scale(zoom) — GPU only

### 2.2 Pan & Momentum (Google Earth)
- [ ] Drag da sfondo (non da [data-table-id] né button) → panning.current settato, isPanning true, scheduleDom con clampVp
- [ ] Drag lento <3px → no momentum, commit finale
- [ ] Flick veloce: dist>=3px && speed>0.1px/ms (100px/s) → startMomentum
- [ ] Momentum: friction 0.92, curVx*=friction ogni frame, speed<0.015 → stop, commit, isPanning false
- [ ] Momentum trasforma px/ms in px/frame *16
- [ ] Se clamp blocca asse → azzera solo quell'asse
- [ ] Durante momentum isPanning true → cursor-grabbing, shadow rimosse via .is-panning CSS
- [ ] **Corner: drag consecutivi** — durante momentum, pointerDown su sfondo → freeze immediato alla pos corrente + inizia nuovo drag senza aspettare fine momentum (bug segnalato)
- [ ] **Corner: tap tavolo durante momentum** → onPointerDown viewport vede wasAnimating, freeza a pos corrente e ritorna (non inizia pan), poi TableNode tapRef gestisce pick, mappa NON torna indietro (bug segnalato)
- [ ] **Corner: tap tavolo senza momentum** → cancelPan fa revert a committedVpRef per evitare jitter 1-2px
- [ ] **Corner: pointerId reuse** — mouse ha sempre id 1, touch id diversi → Map gestita correttamente, delete su pointerUp
- [ ] **Corner: enabled false 50ms** dopo cancelPan/freeze non blocca drag successivi oltre 50ms
- [ ] Pinch: 2 pointers → pinch.current con startDist, startZoom, startPan, center, factor = dist/startDist, zoom clamp, pan da centro
- [ ] Wheel: ctrl/meta → zoom factor exp(-deltaY*0.01), altrimenti exp(-deltaY*0.0016), shift → pan orizzontale, debounce 150ms commit
- [ ] touchAction none, userSelect none, overscroll none su viewport, ma input/textarea restano selectable

### 2.3 TableNode / JoinedNode
- [ ] data-table-id presente su root → viewport early return
- [ ] touchAction none su nodo
- [ ] onPointerDown startTap → freeze() + stopPropagation + tapRef = {x,y,key,time}
- [ ] onPointerUp endTap → check key match, hypot>8 → no pick, time>350 → no pick, altrimenti preventDefault + cancelPan (smart) + onPick
- [ ] onPointerCancel → tapRef null
- [ ] Tone da TABLE_STATE[stato].card, dot da .dot, sub: seating → "3p · 12′", prenotato → "19:30 · 4p", libero → "2-4p"
- [ ] JoinedNode: label = tavoli sortati numerici joinati con "+", box = groupBBox, badge "uniti", data-table-id = label

### 2.4 UI Sala
- [ ] Walk-in bottone "Quanti siete?" → PartyGrid 1-8 + 9+ (big UI con +/− fino a 80)
- [ ] Upcoming: filtra confermata, d = nMin - toMin(time) in [-90,75], sort toMin, late se > lateThreshold, chip +late′, phone icon
- [ ] ViewToggle mappa/lista: icona sola, toggle state
- [ ] StatusBar counts: freeT, freeC, busyT, busyC, overT, heldT
- [ ] Nessun tavolo → messaggio "Nessun tavolo in {room}" + matita se owner

---

## 3. Sala — Vista Lista

### 3.1 Ordinamento e densità (fix "fa cagare")
- [ ] Ordine: libero (0), prenotato (1), occupato (2), oltre_tempo (3), fuori_servizio (4)
- [ ] Dentro stesso stato → label numerico asc, fallback localeCompare
- [ ] Grid: cols 3 (mobile) → 4 sm → 5 md → 6 lg → 8 xl, gap-2, auto-rows-min, pb-2
- [ ] Card h 52px (prima 62px), rounded 12px, border sottile con tinta stato: ok/20 bg-ok/5% ecc, hover più scuro, active scale 0.97
- [ ] Label 18px font-display extrabold, dot 6px
- [ ] Sub: libero → "2p" o "2-4p" muted (non "Libero · 2p"), occupato → nome corto (split " ")[0] + "3p · 12′", prenotato → time·party + nome, fuori servizio → testo oos
- [ ] Troncamento: truncate su nome, guestName
- [ ] 70 tavoli liberi (294 coperti) come in screenshot → deve stare senza scroll eccessivo

### 3.2 Interazione
- [ ] Tap card → onPick → TableSheet
- [ ] RoomTabs funzionanti
- [ ] StatusBar uguale a mappa

---

## 4. TableSheet / CheckInSheet / WalkInSheet

### 4.1 TableSheet
- [ ] Libero: "Siedi qualcuno qui" → seat flow, split se splitInto>=2, merge se splitParentId, nota, fuori servizio con undo
- [ ] Occupato: mostra seating.name, partySize, minutesSeated, oltre_tempo flag, nota, Libera con undo, +15/+30, coperti, sposta, nota veloce
- [ ] Prenotato: chip tenuto per {guestName}, "Siedi qui comunque"
- [ ] Fuori servizio: "Rimetti in servizio"
- [ ] Azioni: act() → PATCH /api/tables o /api/seatings + invalidateQueries day+bootstrap, toast ok/err

### 4.2 CheckInSheet
- [ ] Late: nowMin - toMin > lateThr → banner "In ritardo di X min" + Chiama + No-show con undo
- [ ] Early: lateMin < -thr → banner "In anticipo"
- [ ] PartyGrid: quanti sono davvero vs prenotati
- [ ] Anomalia p>targetCap → rosso "In X non ci state"
- [ ] Anomalia p <= cap-3 e tavolo >=6 → proposta "basta un tavolo piccolo"
- [ ] Target: picked ?? table+joined ?? combo
- [ ] Cambia tavolo → SuggestedTables
- [ ] Siedi → seat() con reservationId, note

### 4.3 Seat Flow
- [ ] PartyGrid: 1-8 grid, 9+ → big UI con −/+ clamp 1-80
- [ ] useSeat: POST /api/seatings con expectedEndAt = now+dur, 409 conflict → toast "Tavolo appena occupato da X" + invalidate
- [ ] SuggestedTables: computeTableStatuses + availableTargets, free slice 0-6 (compact 3), sort waste+extraChairs
- [ ] Splittable: bestWaste>=stdSeats && stdSeats>=party → tavoli splitInto>=2 liberi, partSeats=std, freed sort
- [ ] Joins: allowTableJoin && !free.length → findJoinProposals con maxGap
- [ ] Nessun tavolo: mostra nextFreeMin/label e held count

---

## 5. Floor Editor (Modifica Sala)

### 5.1 Setup
- [ ] Draft da room.layout normalize + tables filter roomId map toNode
- [ ] Past/future per undo/redo (max 40)
- [ ] Tool select/table/wall/decor/perimetro
- [ ] Dirty = past.length>0 → "non salvata"
- [ ] Bounds da polygonOf(draft.layout)

### 5.2 Creazione
- [ ] Tavolo: toWorld, cap da shape (round 2, square 4, rect std*2), units, geometry, clampPointToRoom, snapG, nextLabel incrementale, splitInto da suggestedSplitParts, isJoinable true
- [ ] Muro: snapWallEndpoint su griglia + altri muri + perimetro, rubber preview con wallBox collision tables, wallInsideRoom, min length STEP, commit wallFromEndpoints con uid
- [ ] Decor: rubber drag → x,y,w,h snapG, w/h min 18, **max clamp a sala.w/h** (fix crash), boxFits, commit con DECOR_PRESETS label/icon
- [ ] Perimetro: dragCorner con DAMP 0.28, rAF throttled, shift per non andare negativo, w/h max MAX_ROOM_CM, holdFit true durante drag, addCorner mid snapG, removeCorner min 3 angoli

### 5.3 Drag & Resize (crash fix)
- [ ] dragNode: solo se tool select, cancelPan, setPointerCapture, shift/ctrl multi-select, group = selIds se include id altrimenti [id], start = toWorld, items map con x,y,w,h,rotation, otherItems = altri tavoli+elementi, boxAt con aabb se rotated, delta snapG, single wall vs decor vs multi, snapBoxToWalls per single non-wall, moved flag, node.style.transform direct (no re-render), bad via scheduleBad throttled rAF, wallMoves via scheduleWalls, up → clear rAF, setBadIds [], setLiveWalls {}, moveSelection se moved
- [ ] **resizeEl**: cancelPan, capture, start = toWorld, center0, box, **MAX clamping**:
  - roomMaxW = layout.w, roomMaxH = layout.h, MAX_DECOR = min(room, MAX_ROOM_CM), MAX_WALL_LEN = max(roomW,roomH), MAX_WALL_THICK=300
  - min wall 4, decor 15, horizontalWall = w>=h, verticalWall = h>w, snapWidth/Height, w/h = hx==0?el.w:clamp(snap(...),min,max), shiftLocal per centro, x,y, cand aabb se rotated, scheduleBad boxFits, node.style direct, commit su up
- [ ] dragWallEndpoint: cancelPan, capture, original wallLine, fixed = altro estremo, horizontal/vertical detection, otherWalls, move → toWorld, target axis-aligned se hor/ver, snapWallEndpoint, min dist STEP, wallFromEndpoints, node.style, scheduleWalls, box collision tables, scheduleBad wallInsideRoom, up → patchEl
- [ ] Marquee: ctrl/meta + drag → marquee Box, setMarquee, up → selected = tables+elements che overlap last, selIds

### 5.4 Validazione & Save
- [ ] invalidIds: per ogni item, wallInsideRoom se wall altrimenti boxInsideRoom, poi overlap check con tolerance 2, wall vs non-table escluso
- [ ] isBad = badIds (live) || invalidIds
- [ ] focusInvalid: primo invalid, setSelIds, box per revealRect
- [ ] save: se invalidIds.size → toast err con action "Mostra" → focusInvalid, altrimenti PUT /api/rooms/{id}/floor con staffId, staffName, layout, tables, deleted, invalidate bootstrap, toast ok, onClose
- [ ] tryClose: se dirty → confirmClose modal con Continua/Esci/Salva ed esci

### 5.5 Performance & Crash
- [ ] 100 tavoli + 100 arredi → dragNode 60fps (rAF batching, style direct, no re-render per pixel)
- [ ] Decor 2000x2000 → prima crashava, ora clamp a sala (es. 1200x800) → no crash
- [ ] Wall 5000cm lunghezza → clamp a max sala → no crash
- [ ] ElementNode will-change solo durante pan, non su ogni tavolo (evita esaurimento GPU Safari "a problem repeatedly occurred")

---

## 6. Prenotazioni & Piano

### 6.1 Elenco
- [ ] DayNav: oggi, +/- giorni, calendario
- [ ] grouped: active (confermata/seduta), closed (no_show/cancellata), covers sum, daSistemare count
- [ ] statusOf: confermata + late → in_ritardo, altrimenti da_sistemare/sistemata
- [ ] tableLabel: assignedTableId + joinedTableIds → "Tav. 7+8", combo → "Acc. X"
- [ ] Elenco button → ResSheet, disabled se closed, Chip RES_STATUS, Phone tel link stopPropagation
- [ ] FAB + → ReservationFormSheet con defaultDate
- [ ] Print area hidden con table per CSV-like

### 6.2 Piano
- [ ] Period tabs: boot.periods, active = periodId ?? first, startMin/endMin toMin, slotMinutes max(5, settings.slotMinutes)
- [ ] timelineSlots = serviceTimelineSlots(start,end,slotMinutes) — vedi Time tests
- [ ] confermate = status confermata/seduta, inPeriod = time+duration > startMin && time < end+60
- [ ] biggestTable, biggestCombo, needsJoin = party > max(table,combo)
- [ ] roomSeats sum max(cap,maxCap) per over capacity check
- [ ] unassigned = confermata && !assigned && inPeriod, sort needsJoin desc, party desc, time asc
- [ ] assigned = inPeriod con assigned
- [ ] blocksByCol Map<colKey, Reservation[]>, pushBlock evita duplicati, include joinedTableIds
- [ ] totalCap sum capacity, slotLoad Map<slot, covers>, overSlots = load >= overbookingPct, isOver
- [ ] Conflicts: perTable Map<tableId, {id,a,b}[]>, a=toMin(time), b=a+duration+buffer, overlaps → bad Set
- [ ] patchAssign optimistic: qc setQueryData day, PATCH /api/reservations/{id} con tableId,comboId,joined,time,label, invalidate, rollback su err toast
- [ ] dropTarget: da DragMove/End, res da active.data, over.id = "rail" o "table:id" o "combo:id", top = translated.top - over.rect.top, dur, maxIdx = round((end-start-dur)/slot), idx = clamp round(top/ROW_H), capacity: se staysInCurrentGroup (table in currentGroup) → sum group capacity altrimenti singola, valid = missing==0, time = toHHMM(start+idx*slot), slots = round(dur/slot), colKey, staysInCurrentGroup
- [ ] onDragStart → dragRes, onDragMove → preview (col,top,height,time,valid,message) solo se changed, onDragEnd → justDragged flag + microtask, rail → unassign se aveva tavolo, altrimenti se !valid → toast + AssignSheet, se samePlace+sameTime → no-op, altrimenti patchAssign con tableId/comboId/joined/time/label (joined conservato solo se staysInCurrentGroup)
- [ ] Rail: droppable id "rail", isOver → border brand bg, count, RailChip draggable con PointerSensor distance 8, late detection, needsJoin
- [ ] Column: droppable id colKey, label cap oos, height slotCount*ROW_H, rows grid, preview dashed border brand/over
- [ ] Block: draggable id block-{id}, top = (toMin(time)-periodStart)/slot*ROW_H, height max(ROW_H*2-4, dur/slot*ROW_H-4), cls seated/conflict/late/busy, touchAction none, opacity 0.25 se dragging
- [ ] DragOverlay: res name·party·time
- [ ] Auto-sistema: runAuto POST /api/autoassign preview, planBusy, planOpen, proposals con reason, skipped, applyPlan → proposals map to kind/id2/joined, POST apply, invalidate day, toast, close

### 6.3 AssignSheet
- [ ] freeTargetsAt con timeMin, party, dur, buf, tables, combos, assigned busyAtTime, durFor
- [ ] roomName, preferred = res.preferredRoomId
- [ ] Opt: table/combo, label, sub con capacity+room, waste, pref, splitTableId, zones
- [ ] Split: bestWaste>=stdSeats && stdSeats>=party → tavoli splitInto>=2 liberi, waste = std-party, pref
- [ ] freeAtTime per largePlan, planLargeParty se !opts.length && allowTableJoin
- [ ] opts sort pref desc waste asc
- [ ] pick: se splitTableId → POST /api/tables/{id}/split, invalidate bootstrap, part con capacity>=party, poi PATCH reservation assign

---

## 7. Lib Pure Functions — Unit

### 7.1 time.ts
- toMin: "00:00" 0, "01:30" 90, "23:59" 1439, " 9:05 " 545, "" NaN? deve gestire, "24:00" 1440? check
- toHHMM: 0 "00:00", 60 "01:00", 1439 "23:59", 1440 "24:00" o clamp, negative → "00:00" o errore
- overlaps: [0,10] vs [5,15] true, [0,10] vs [10,20] false (escluso), [0,10] vs [10,10] false, [5,5] vs [0,10] true? dipende impl
- todayISO: format YYYY-MM-DD, todayISO(-1) ieri
- addDays: "2025-01-01" +1 → "2025-01-02", mese/anno rollover, +30, -1
- serviceTimelineSlots: 12:00-15:00 step15 → 13 slots (12:00..15:00), label ogni 30min + start/end, step<5 → clamp 5, end==start → [], end<start → [], invalid time → [], non-divisible es. 12:00-13:00 step20 → minutes [720,740,760,780] + end 780? deve aggiungere end se non divisibile
- nowMin, dayLabel, relDay, mmssAgo

### 7.2 floor.ts
- clamp: clamp(5,0,10)=5, clamp(-1,0,10)=0, clamp(15,0,10)=10
- snapTo: snapTo(12,25)=0, snapTo(13,25)=25, snapTo(0,25)=0
- normalizeLayout: w/h clamp 400-3000, default 1200x800 se missing, polygon round, elements: kind default wall, width max 10, height, wall thickness round/5, decor width clamp a sala (fix), labelRotation mod 360, labelScale clamp 0.6-1.5, tone fallback neutro o verde se pianta, iconFromLabel
- iconFromLabel: "Bancone bar" → bancone, "Cucina" → cucina, "Cassa" → cassa, "Scala" → scala, "Bagno" → bagno, "Ingresso porta" → porta, "Pilastro" → pilastro, "Pianta ficus" → pianta, "Altro" → generico fallback
- aabb: cx,cy,w,h,rotation 0 → x=cx-w/2, 90° → w/h swap, 45° → bw = w*c + h*s
- elementBox: no rotation → x,y,w,h, con rotation → aabb
- boxesOverlap: overlap true, touching con tolerance 2 → false se gap==2? check, no overlap false
- boxInsideRoom: rectInsideRoom con eps 2 → appoggiato a perimetro valido
- pointInPolygon: quadrato (0,0)-(10,0)-(10,10)-(0,10), punto (5,5) true, (15,5) false, (0,0) edge? ray casting
- pointInOrOnPolygon: punto sul bordo con tolerance 1.5 → true
- wallInsideRoom: linea centrale dentro + estremi sul bordo → true
- rectInsideRoom: 5 punti testati con eps
- clampPointToRoom: punto fuori → vertice bordo più vicino + rientro 6cm verso centroid
- polygonBounds: min/max
- wallLine: w>=h → orizzontale, dx = w/2*cos, altrimenti verticale
- wallFromEndpoints: length hypot, angle atan2, thickness round/5 min10, cx,cy, x=cx-len/2, y=cy-t/2, w=len,h=t,rotation=angle
- snapWallEndpoint: gridPoint, cerca altri muri endpoint entro threshold 14, poi perimetro edges closestPointOnSegment, ritorna round
- tableGeometry: side = clamp(60+std*8,70,170), round/square → side,side, rect → side*units, side, units = max(2, lengthUnits??tableUnits)
- tableLengthUnits: round(width/side)
- tableUnits: ceil(cap/std)
- shapeForCapacity: units>1 → rect altrimenti current
- unitTableSide
- suggestedSplitParts: rect → units>1 ? min(20,units):0 altrimenti 0
- splitTableParts: n clamp 2-20, std max(2,standard), alongWidth = w>=h, partW = w/n or w, partH, rad, localOffset, lx,ly, label 12a,12b, capacity std, x,y con cos/sin, width,height,rotation
- tableSeats, computeRoomSeats: vedi join

### 7.3 estimates.ts
- durationFor: party 2 cena base, party 8 large, party 10 xl, periodName null → cena, case insensitive "CENA" → cena, missing bands → fallback cena
- periodFor: timeMin dentro periodo → period, fuori → null, boundary inclusive
- computeTableStatuses: 
  - fuori_servizio → stato fuori_servizio
  - seating seduto → occupato, minutesSeated = (nowMs - seatedAt)/60000, >overtime → oltre_tempo
  - holds: reservation confermata, t-nowMin in [-60, hold], ids = assignedTableId + joined + combo.tableIds, holds Map con earliest time se multipla stessa tavola
  - altrimenti libero
  - Corner: reservation cancellata/no-show → tavolo libero
  - Corner: multiple reservations same table → earliest wins
  - Corner: combo
- activeSeatingByTable: filtra status seduto, per ogni tableIds set
- availableTargets:
  - usable = !excludeIds && statuses libero OR prenotato con forReservationId match
  - free tables: seats = max(cap,maxCap) >=party && usable, waste, extraChairs
  - combos: canJoin = every table isJoinable!=false, capacity>=party, every usable
  - sort extraChairs asc waste asc table before combo
  - nextFree: per ogni table cap>=party con seating, left = expectedEndAt - now, min
  - Corner: party 80, party 1, excludeIds, forReservationId
- freeTargetsAt: s=timeMin, e=time+dur+buf, busyByTable Map id→[a,b][], push per assignedTableId, joined, combo, free = no overlap s<b && a<e, filter tables cap>=party && not fuori_servizio && free, combos cap>=party && joinable && every free
- loadBySlot: floor(time/slot)*slot → sum partySize

### 7.4 join.ts
- seatsOf: withExtraChairs true → max(cap,maxCap), false → cap
- tableBBox: rad, c,s, w = width*c+height*s, h = width*s+height*c, x1=cx-w/2 etc
- areAdjacent: roomId diverso → false, isJoinable false → false, gapX = max(0, max(A.x1-B.x2, B.x1-A.x2)), gapY simile, overlapX = min(A.x2,B.x2)-max(A.x1,B.x1), overlapY, minW/minH, gapX<=maxGap && overlapY>minH/3 → true (orizz), gapY<=maxGap && overlapX>minW/3 → true (vert)
- groupBBox: boxes map tableBBox, x1 min -pad, etc, w,h
- isCompactGroup: <2 true, box 0 pad, own sum area, box.w*h <= own*tolerance
- findJoinProposals: free = tables filter not fuori_servizio && isFree (libero), biggest, needed = ceil(party/max(2,biggest)), maxTables = max(2,min(args.maxTables??10, needed+2)), neighbours Map id→free filter adjacent, make group→Proposal, found Map label→Proposal, seen Set, budget 20000, grow recursive: if chain>=2 && seats>=party && isCompact → found, return, if chain>=maxTables return, for candidate in chain.flatMap neighbours, if chain includes skip, key sorted ids join "|", if seen skip, seen add, grow([...chain,candidate], seats+seatsOf), start sorted seatsOf desc, out sort waste, tables.length, extraChairs, reason con chairs, slice limit

### 7.5 large-party.ts
- spatiallyNear: roomId diverso false, gap = hypot(gx,gy) <= gap
- components: BFS con unseen Set, byId Map, out groups, while unseen, first, queue, group, while queue, table, for otherId in unseen, if joinOnly?areAdjacent:spatiallyNear → delete unseen push queue, out push group
- connected: tables<=1 true altrimenti components true length 1
- bestCluster: seed ogni tavolo, selected [seed], used Set, seats, while seats<target && used<size, frontier = tables filter !used && selected some adjacent/near, if !frontier break, cx,cy avg selected, frontier sort dist to center asc seats desc, next frontier[0], push, seats+=, if seats>=target → area = max-min, own sum, score = (seats-target)*10000 + len*100 + area/own, best min score
- planLargeParty: tables filter not fuori_servizio, totalAvailable sum seatsOf, relaxedGap = min(500, max(maxGap*2.5,300)), rooms Map roomId→tables, roomOrder sort preferredRoomId first, 1. cluster accostabile per sala → bestCluster con maxGap, if cluster → makePlan contiguous true, 2. zona stessa sala con relaxedGap false → cluster → makePlan contiguous = connected(...), 3. più zone: zones = roomOrder flatMap components relaxedGap false map {roomId,tables,seats,preferred}, sort preferred desc seats desc, chosen [], remaining=party, for zone in zones, if remaining<=0 break, subset = bestCluster(zone.tables, min(remaining,zone.seats), relaxedGap,false) ?? zone.tables, push {roomId,tables:subset,contiguous:connected(subset,maxGap)}, remaining-=subset seats, plan = makePlan, if !complete && totalAvailable<party → reason con posti disponibili e mancanti
- makePlan: groups map con roomId,tables,clusters via components true? displayRuns? reason, totalSeats, waste, shortfall, complete, preference

### 7.6 tenant-code
- normalize: trim uppercase alfanumerico via /[^A-Z0-9]/g
- generate: random 10 chars?

### 7.7 use-viewport pure
- clampVp con sizeCache w,h,minZoom, boundsW,H, bx1,by1, margin 30% o 140, w=boundsW*zoom, h=boundsH*zoom, offX=bx1*zoom, offY, panX clamp: w<=vw ? clamp(panX, -offX-margin, vw-w-offX+margin) : clamp(panX, vw-w-offX-margin, -offX+margin) simile panY
- fit: vw,vh, minZoom, zoom = clamp(min((vw-pad*2)/boundsW, (vh-pad*2)/boundsH),MIN,MAX), cx,cy = (bx1+bx2)/2, target pan = vw/2 - cx*zoom
- selectionViewport: margin 36, availableW = vw-margin*2, availableH = vh-bottomInset-margin*2, top = box.y*zoom+panY etc, visibleBottom = vh-bottomInset-margin, hidden = bottom>visibleBottom || top<margin || left<margin || right>vw-margin, fitZoom = min(availableW/box.w, availableH/box.h)*0.92, zoom = min(current.zoom,fitZoom), cx,cy box center, centerY = margin+availableH/2, view pan = vw/2 - cx*zoom, centerY - cy*zoom

---

## 8. API & Data

- [ ] /api/tenant?slug → exists true/false, error handling
- [ ] /api/rooms/{id}/floor PUT → staffId, layout, tables, deleted, validation invalidIds, toast
- [ ] /api/reservations/{id} PATCH assign/status → optimistic + rollback
- [ ] /api/seatings POST → 409 conflict con occupiedBy
- [ ] /api/tables/{id}/split POST/DELETE → parts, bootstrap invalidate
- [ ] /api/autoassign preview/apply → proposals, skipped
- [ ] /api/summary?rid&date&csv → covers, seatings, noShow, etc
- [ ] /api/log → staff actions
- [ ] Drizzle ORM: pg, dotenv

---

## 9. PWA & Performance

- [ ] PwaGuard: gesturestart/change/end preventDefault, touchend double tap ≤300ms prevent se non input/textarea/button/a/[contenteditable]/[role=button]
- [ ] globals.css: html touch-action pan-y, overscroll none, body user-select none, input/textarea user-select text, button touch-action manipulation, .floor-viewport touch-action none !important, overscroll none, user-select none, tap-highlight transparent, isolation isolate, contain layout style, .floor-content transform translateZ(0) backface hidden contain layout style, .floor-grid will-change transform, .is-panning .floor-grid opacity 0.7, .is-panning .shadow* box-shadow none !important, backdrop-filter none
- [ ] layout.tsx: viewport width device-width initialScale 1 maximumScale 1 userScalable false viewportFit cover, themeColor, manifest, appleWebApp
- [ ] 60 FPS: pan/zoom via transform GPU, no re-render per frame (scheduleDom rAF), dragNode style direct, liveWalls/badIds rAF throttled, shadow removal
- [ ] Memory: no will-change su ogni tavolo, solo su floor-content e grid, evita "a problem repeatedly occurred" iOS
- [ ] Build: next build passa, tsc --noEmit --skipLibCheck passa, lint

---

## 10. Security & Validation

- [ ] Slug: solo A-Z0-9, uppercase, trim, via regex
- [ ] PIN: non in chiaro in UI, staff role check titolare per personale/impostazioni/editor
- [ ] Tenant isolation: rid da staff.restaurantId, ogni query filtra per rid
- [ ] Reservation: partySize 1-80, time valid HH:MM, guestName required, phone optional, notes
- [ ] Table: capacity 1-80, maxCapacity >=capacity, label max 6 chars, rotation 0-360 mod, splitInto 0-20
- [ ] FloorElement: w/h min 10, max sala (decor) o MAX_ROOM_CM (wall), thickness max 300, label max 28, labelScale 0.6-1.5, labelRotation mod 360, tone enum
- [ ] Room: w/h 400-3000, polygon min 3 punti, MAX_ROOM_CM 3000
- [ ] Overbooking: settings.overbookingPct, lateThreshold, reservationHold, overtime, buffer, slotMinutes min 5, standardTableSeats, joinMaxGap, allowTableJoin

---

## 11. Corner Cases Espliciti (Crash & Bug Storici)

- [ ] Decor 5000x5000 → clamp a sala, no crash (fix)
- [ ] Wall lunghezza 10000 → clamp a max sala
- [ ] Wall spessore 1000 → clamp a 300
- [ ] 100 tavoli drag multi-select → rAF batching, no lag
- [ ] Polygon 100 punti → bounds, pointInPolygon, dragCorner ok
- [ ] Tavolo con rotation 90/180/270/45 → aabb, elementBox, drag, resize ok
- [ ] Label con 28 char + scale 1.5 → DecorFace fitByWidth, usableW/H, ellipsis
- [ ] Pilastro con label → label nascosto se icon pilastro
- [ ] Tavolo 80 persone → duration xl, tableUnits, splitParts, geometry
- [ ] Prenotazione a mezzanotte 00:00 → toMin 0, periodFor, holds
- [ ] Prenotazione 23:59 + durata oltre mezzanotte → freeTargetsAt con e = time+dur+buf può superare 1440 → overlap check deve gestire >1440? attualmente no, ma dovrebbe clamp o gestire
- [ ] DST / todayISO con offset → new Date(iso+"T12:00:00") evita DST
- [ ] 1000 prenotazioni stesso giorno → grouped, slotLoad, Piano performance
- [ ] Combo con tavolo non joinable → canJoin false → non proposto
- [ ] JoinedGroup non compatto → isCompactGroup false → scartato
- [ ] Catena tavoli con buco (1+3 saltando 2) → isCompactGroup con tolerance 1.45 scarta
- [ ] Budget 20000 in findJoinProposals → su sale grandi non esplode
- [ ] Large party 80 con 2 sale → multi-zone, reason con posti disponibili
- [ ] Shortfall: totalAvailable < party → reason con mancanti
- [ ] Overlap esatto bordo [0,10] vs [10,20] → no overlap (s < b && a < e)
- [ ] Velocity window 100ms, dt>2 → evita divisione per zero
- [ ] MoveHistory shift while >2 e t<cutoff → tiene solo ultimi 100ms
- [ ] Pointer capture release su pointerUp/Cancel → try/catch
- [ ] Wheel ctrl/meta vs shift → zoom vs pan
- [ ] FitHold true durante dragCorner → fit non chiamato
- [ ] Undo/redo 40 max, past slice -40
- [ ] Delete con Backspace/Delete solo se selIds e non input
- [ ] Input font-size 17px evita zoom iOS
- [ ] Skeleton loading per boot/day/summary/log
- [ ] Empty states: nessun tavolo, nessuna prenotazione, nessun turno configurato
- [ ] Stampa: .no-print hidden, .print-area visible

---

## 12. Test Esecuzione

Eseguire:
- `npm run typecheck` → tsc passa
- `npm run build` → build verde
- `npx tsx test-exhaustive.ts` → unit tests pure functions
- Manuale su device: iPad, iPhone, Android, Chrome desktop con touch emulation

Criterio bugproof: 0 crash, 0 regressioni su bug storici (momentum, click tavolo, zoom bottoni, frase attivazione, cambia locale, arredo gigante).
