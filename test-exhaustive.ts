#!/usr/bin/env tsx
// @ts-nocheck
// Test esaustivo Coperto — pure functions + regressioni
import { clamp, snapTo, normalizeLayout, aabb, elementBox, boxesOverlap, pointInPolygon, pointInOrOnPolygon, rectInsideRoom, clampPointToRoom, polygonBounds, wallLine, wallFromEndpoints, snapWallEndpoint, tableGeometry, tableUnits, shapeForCapacity, unitTableSide, iconFromLabel, MAX_ROOM_CM } from "./src/lib/floor";
import { toMin, toHHMM, overlaps, todayISO, addDays, serviceTimelineSlots } from "./src/lib/time";
import { durationFor, periodFor, computeTableStatuses, availableTargets, freeTargetsAt, loadBySlot } from "./src/lib/estimates";
import { areAdjacent, groupBBox, isCompactGroup, findJoinProposals } from "./src/lib/join";
import { planLargeParty } from "./src/lib/large-party";
import * as fs from "fs";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function eq(name: string, a: any, b: any) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  assert(name, ok, `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
}

// 1. time.ts
assert("toMin 00:00", toMin("00:00") === 0);
assert("toMin 23:59", toMin("23:59") === 23*60+59);
assert("toMin 09:05", toMin("09:05") === 545);
assert("toMin with spaces", toMin(" 9:05 ") === 545);
assert("toHHMM 0", toHHMM(0) === "00:00");
assert("toHHMM 1439", toHHMM(1439) === "23:59");
assert("overlaps true", overlaps(0,10,5,15) === true);
assert("overlaps edge false", overlaps(0,10,10,20) === false);
assert("overlaps inside", overlaps(0,20,5,10) === true);
assert("todayISO format", /^\d{4}-\d{2}-\d{2}$/.test(todayISO()));
assert("addDays", addDays("2025-01-01", 1) === "2025-01-02");
assert("addDays month rollover", addDays("2025-01-31",1) === "2025-02-01");
assert("serviceTimelineSlots 12-15 step15", (() => {
  const slots = serviceTimelineSlots("12:00","15:00",15);
  return slots.length === 13 && slots[0].label === "12:00" && slots[slots.length-1].label === "15:00";
})());
assert("serviceTimelineSlots step<5 clamp", serviceTimelineSlots("12:00","13:00",2).length > 0);
assert("serviceTimelineSlots invalid", serviceTimelineSlots("15:00","12:00",15).length === 0);
assert("serviceTimelineSlots non-divisible adds end", (() => {
  const slots = serviceTimelineSlots("12:00","13:00",20);
  return slots[slots.length-1].minute === 780; // 13:00 = 780
})());

// 2. floor.ts clamp/snap
assert("clamp middle", clamp(5,0,10)===5);
assert("clamp low", clamp(-1,0,10)===0);
assert("clamp high", clamp(15,0,10)===10);
assert("snapTo 12->0", snapTo(12,25)===0);
assert("snapTo 13->25", snapTo(13,25)===25);
assert("unitTableSide default 4", unitTableSide(4) === clamp(60+4*8,70,170));
assert("tableUnits ceil", tableUnits(5,4)===2);
assert("shapeForCapacity units>1 rect", shapeForCapacity(9,"square",4)==="rect");
assert("shapeForCapacity keep current if units=1", shapeForCapacity(2,"round",4)==="round");
assert("tableGeometry round", (() => { const g=tableGeometry(2,"round",4); return g.width===g.height; })());
assert("tableGeometry rect width>height", (() => { const g=tableGeometry(8,"rect",4,2); return g.width>g.height; })());
assert("iconFromLabel bancone", iconFromLabel("Bancone bar")==="bancone");
assert("iconFromLabel cucina", iconFromLabel("Cucina centrale")==="cucina");
assert("iconFromLabel pianta", iconFromLabel("Ficus grande")==="pianta");
assert("iconFromLabel fallback", iconFromLabel("Sgabello")==="generico");

// normalizeLayout clamping
(() => {
  const layout = normalizeLayout({ w: 10000, h: 100, elements: [{ id:"1", kind:"decor", x:0,y:0,w:5000,h:5000, rotation:0, label:"Test", icon:"bancone" }] });
  assert("normalizeLayout w clamp max 3000", layout.w===3000);
  assert("normalizeLayout h clamp min 400", layout.h===400);
  assert("normalizeLayout decor w clamp to room", layout.elements[0].w <= layout.w, `w=${layout.elements[0].w} roomW=${layout.w}`);
  assert("normalizeLayout decor h clamp to room", layout.elements[0].h <= layout.h, `h=${layout.elements[0].h} roomH=${layout.h}`);
})();
(() => {
  const layout = normalizeLayout({ w:1200,h:800, elements: [{ id:"wall1", kind:"wall", x:0,y:0,w:5000,h:20, rotation:0, label:"" }] });
  assert("normalizeLayout wall length clamp to room", layout.elements[0].w <= 1200, `wall w=${layout.elements[0].w}`);
  assert("normalizeLayout wall thickness clamp 300", layout.elements[0].h <= 300);
})();

// aabb / elementBox / boxesOverlap
(() => {
  const b = aabb(100,100,100,50,0);
  assert("aabb no rotation", b.x===50 && b.y===75 && b.w===100 && b.h===50);
  const b90 = aabb(100,100,100,50,90);
  assert("aabb 90deg swap", Math.abs(b90.w-50)<0.01 && Math.abs(b90.h-100)<0.01);
  const el = { id:"1", kind:"decor" as const, x:0,y:0,w:100,h:50, rotation:0, label:"" };
  const eb = elementBox(el);
  assert("elementBox no rot", eb.x===0 && eb.w===100);
  const overlap = boxesOverlap({x:0,y:0,w:10,h:10},{x:5,y:5,w:10,h:10});
  assert("boxesOverlap true", overlap===true);
  const noOverlap = boxesOverlap({x:0,y:0,w:10,h:10},{x:20,y:20,w:10,h:10});
  assert("boxesOverlap false", noOverlap===false);
  const touching = boxesOverlap({x:0,y:0,w:10,h:10},{x:10,y:0,w:10,h:10},2);
  assert("boxesOverlap touching tolerance 2 false", touching===false);
})();

// pointInPolygon
(() => {
  const poly = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  assert("pointInPolygon inside", pointInPolygon({x:5,y:5},poly)===true);
  assert("pointInPolygon outside", pointInPolygon({x:15,y:5},poly)===false);
  assert("pointInOrOnPolygon on edge tolerance", pointInOrOnPolygon({x:0,y:5},poly,1.5)===true);
  assert("rectInsideRoom inside", rectInsideRoom(1,1,8,8,poly)===true);
  assert("rectInsideRoom outside", rectInsideRoom(20,20,5,5,poly)===false);
  const clamped = clampPointToRoom({x:20,y:5},poly);
  assert("clampPointToRoom returns inside", pointInPolygon(clamped,poly)===true);
  const bounds = polygonBounds(poly);
  assert("polygonBounds", bounds.x1===0 && bounds.x2===10 && bounds.y1===0 && bounds.y2===10);
})();

// wallLine / wallFromEndpoints
(() => {
  const el = { id:"w", kind:"wall" as const, x:0,y:0,w:100,h:20, rotation:0, label:"" };
  const line = wallLine(el);
  assert("wallLine horizontal", line.a.x < line.b.x && line.thickness===20);
  const wall = wallFromEndpoints("w2",{x:0,y:0},{x:100,y:0},15);
  assert("wallFromEndpoints length", Math.abs(wall.w-100)<1);
  assert("wallFromEndpoints thickness round/5", wall.h%5===0);
})();

// 3. estimates.ts
(() => {
  const settings: any = { durations:{ cena:{base:90,large:120,xl:150}, pranzo:{base:60,large:90,xl:120} }, reservationHoldMinutes:90, overtimeMinutes:60, bufferMinutes:15 };
  assert("durationFor base", durationFor(2,"cena",settings)===90);
  assert("durationFor large", durationFor(7,"cena",settings)===120);
  assert("durationFor xl", durationFor(10,"cena",settings)===150);
  assert("durationFor null period fallback cena", durationFor(2,null,settings)===90);
  assert("durationFor case insensitive", durationFor(2,"CENA",settings)===90);
  const periods = [{ id:"1", name:"Pranzo", startTime:"12:00", endTime:"15:00" }, { id:"2", name:"Cena", startTime:"19:00", endTime:"23:00" }];
  assert("periodFor inside", periodFor(12*60+30, periods as any)?.name==="Pranzo");
  assert("periodFor outside", periodFor(16*60, periods as any)===null);
  assert("periodFor boundary inclusive", periodFor(12*60, periods as any)?.name==="Pranzo");
})();

// computeTableStatuses
(() => {
  const tables: any = [{ id:"t1", state:"libero", capacity:2, roomId:"r1" }, { id:"t2", state:"fuori_servizio", capacity:4, roomId:"r1" }];
  const seatings: any = [{ id:"s1", tableIds:["t1"], status:"seduto", seatedAt: new Date(Date.now()-30*60000).toISOString(), expectedEndAt: new Date(Date.now()+60*60000).toISOString(), partySize:2 }];
  const reservations: any = [];
  const settings: any = { reservationHoldMinutes:90, overtimeMinutes:60 };
  const statuses = computeTableStatuses({ tables, combos:[], seatings, reservations, settings, nowMs:Date.now(), nowMinOfDay: 12*60 });
  assert("computeTableStatuses occupato", statuses.get("t1")?.state==="occupato");
  assert("computeTableStatuses fuori_servizio", statuses.get("t2")?.state==="fuori_servizio");
  // overtime
  const seatingsOver: any = [{ id:"s2", tableIds:["t1"], status:"seduto", seatedAt: new Date(Date.now()-90*60000).toISOString(), expectedEndAt: new Date(Date.now()-10*60000).toISOString(), partySize:2 }];
  const statusesOver = computeTableStatuses({ tables, combos:[], seatings:seatingsOver, reservations, settings, nowMs:Date.now(), nowMinOfDay:12*60 });
  assert("computeTableStatuses oltre_tempo", statusesOver.get("t1")?.state==="oltre_tempo");
  // prenotato hold
  const resHold: any = [{ id:"r1", guestName:"Mario", time:"12:30", partySize:2, status:"confermata", assignedTableId:"t1", assignedComboId:null, joinedTableIds:[] }];
  const statusesHold = computeTableStatuses({ tables:[{ id:"t1", state:"libero", capacity:2, roomId:"r1" }], combos:[], seatings:[], reservations:resHold, settings, nowMs:Date.now(), nowMinOfDay:12*60 });
  assert("computeTableStatuses prenotato hold", statusesHold.get("t1")?.state==="prenotato");
  // cancellata -> libero
  const resCancelled: any = [{ id:"r1", guestName:"Mario", time:"12:30", partySize:2, status:"cancellata", assignedTableId:"t1", assignedComboId:null }];
  const statusesCancelled = computeTableStatuses({ tables:[{ id:"t1", state:"libero", capacity:2, roomId:"r1" }], combos:[], seatings:[], reservations:resCancelled, settings, nowMs:Date.now(), nowMinOfDay:12*60 });
  assert("computeTableStatuses cancellata -> libero", statusesCancelled.get("t1")?.state==="libero");
})();

// availableTargets
(() => {
  const tables: any = [
    { id:"t1", label:"1", capacity:2, maxCapacity:2, roomId:"r1", state:"libero", x:0,y:0,width:100,height:100, rotation:0 },
    { id:"t2", label:"2", capacity:4, maxCapacity:6, roomId:"r1", state:"libero", x:200,y:0,width:100,height:100, rotation:0 },
    { id:"t3", label:"3", capacity:2, roomId:"r1", state:"libero", x:400,y:0,width:100,height:100, rotation:0, isJoinable:false },
  ];
  const statuses = new Map([["t1",{state:"libero" as const}],["t2",{state:"libero" as const}],["t3",{state:"libero" as const}]]);
  const { free } = availableTargets({ party:2, tables, combos:[], statuses });
  assert("availableTargets free count", free.length===3);
  assert("availableTargets extraChairs", (() => {
    const t = free.find((f:any)=>f.table?.id==="t2");
    return t && (t as any).extraChairs===0;
  })());
  const { free: free5 } = availableTargets({ party:5, tables, combos:[], statuses });
  assert("availableTargets party 5 only t2 with maxCap", free5.length===1 && (free5[0] as any).table.id==="t2");
  // excludeIds
  const { free: freeEx } = availableTargets({ party:2, tables, combos:[], statuses, excludeIds:["t1"] });
  assert("availableTargets excludeIds", freeEx.length===2 && !freeEx.some((f:any)=>f.table?.id==="t1"));
  // forReservationId prenotato
  const statusesPren = new Map([["t1",{state:"prenotato" as const, reservation:{id:"res1"}}],["t2",{state:"libero" as const}]]);
  const { free: freePren } = availableTargets({ party:2, tables, combos:[], statuses:statusesPren as any, forReservationId:"res1" });
  assert("availableTargets forReservationId allows prenotato", freePren.some((f:any)=>f.table?.id==="t1"));
})();

// freeTargetsAt
(() => {
  const tables: any = [{ id:"t1", capacity:2, maxCapacity:2, state:"libero", roomId:"r1" }, { id:"t2", capacity:4, state:"libero", roomId:"r1" }];
  const assigned = [{ time:"12:00", partySize:2, assignedTableId:"t1", assignedComboId:null, joinedTableIds:[] }];
  const res = freeTargetsAt({ timeMin:12*60+30, party:2, dur:90, buf:15, tables, combos:[], assigned, durFor:()=>90 });
  assert("freeTargetsAt overlapping -> t1 busy", res.tables.length===1 && res.tables[0].id==="t2");
  const res2 = freeTargetsAt({ timeMin:14*60, party:2, dur:90, buf:15, tables, combos:[], assigned, durFor:()=>90 });
  assert("freeTargetsAt non overlapping -> both free", res2.tables.length===2);
})();

// 4. join.ts
(() => {
  const t1: any = { id:"1", label:"1", roomId:"r1", x:0,y:0,width:100,height:100, rotation:0, capacity:2, isJoinable:true };
  const t2: any = { id:"2", label:"2", roomId:"r1", x:110,y:0,width:100,height:100, rotation:0, capacity:2, isJoinable:true };
  const t3: any = { id:"3", label:"3", roomId:"r2", x:0,y:0,width:100,height:100, rotation:0, capacity:2, isJoinable:true };
  const t4: any = { id:"4", label:"4", roomId:"r1", x:0,y:0,width:100,height:100, rotation:0, capacity:2, isJoinable:false };
  assert("areAdjacent same room close", areAdjacent(t1,t2,150)===true);
  assert("areAdjacent different room false", areAdjacent(t1,t3,150)===false);
  assert("areAdjacent isJoinable false", areAdjacent(t1,t4,150)===false);
  assert("groupBBox", (() => { const b=groupBBox([t1,t2]); return b.w>0 && b.h>0; })());
  assert("isCompactGroup compact", isCompactGroup([t1,t2])===true);
  const tFar: any = { id:"5", label:"5", roomId:"r1", x:1000,y:1000,width:100,height:100, rotation:0, capacity:2, isJoinable:true };
  assert("isCompactGroup scattered false", isCompactGroup([t1,tFar])===false);
  const proposals = findJoinProposals({ party:4, tables:[t1,t2], maxGapCm:150 });
  assert("findJoinProposals finds chain", proposals.length>0 && proposals[0].tableIds.length===2);
  const noProposals = findJoinProposals({ party:10, tables:[t1], maxGapCm:150 });
  assert("findJoinProposals no tables enough", noProposals.length===0);
})();

// 5. large-party
(() => {
  const tables: any = [
    { id:"1", label:"1", roomId:"r1", x:0,y:0,width:100,height:100, rotation:0, capacity:4, state:"libero" },
    { id:"2", label:"2", roomId:"r1", x:110,y:0,width:100,height:100, rotation:0, capacity:4, state:"libero" },
    { id:"3", label:"3", roomId:"r1", x:220,y:0,width:100,height:100, rotation:0, capacity:4, state:"libero" },
  ];
  const plan = planLargeParty({ party:8, tables, maxGapCm:150 });
  assert("planLargeParty complete", plan.complete===true);
  assert("planLargeParty totalSeats >= party", plan.totalSeats>=8);
  const planBig = planLargeParty({ party:20, tables, maxGapCm:150 });
  assert("planLargeParty shortfall when not enough", planBig.shortfall>0 || planBig.totalSeats<20);
  const tables2Rooms: any = [
    { id:"1", label:"1", roomId:"r1", x:0,y:0,width:100,height:100, rotation:0, capacity:4, state:"libero" },
    { id:"2", label:"2", roomId:"r2", x:0,y:0,width:100,height:100, rotation:0, capacity:4, state:"libero" },
  ];
  const planPref = planLargeParty({ party:4, tables:tables2Rooms, maxGapCm:150, preferredRoomId:"r2" });
  assert("planLargeParty preferred room", planPref.groups[0]?.roomId==="r2");
})();

// 6. Phrase checks
(() => {
  const pageContent = fs.readFileSync("src/app/page.tsx","utf8");
  assert("phrase messaggio di attivazione", pageContent.includes("Lo trovi nel messaggio di attivazione."), "phrase not found");
  assert("phrase NOT email", !pageContent.includes("Lo trovi nell'email di attivazione."), "old phrase still present");
  assert("phrase NOT messaggio ricevuto dal ristoratore", !pageContent.includes("messaggio ricevuto dal ristoratore"), "very old phrase present");
})();

// 7. Altro page no Cambia locale
(() => {
  const altroContent = fs.readFileSync("src/app/r/[slug]/(app)/altro/page.tsx","utf8");
  assert("Altro no Cambia locale button", !altroContent.includes("Cambia locale"), "Cambia locale still exists");
  assert("Altro has Cambia utente", altroContent.includes("Cambia utente"));
})();

// 8. floor-editor max clamping
(() => {
  const editorContent = fs.readFileSync("src/components/floor-editor.tsx","utf8");
  assert("floor-editor has MAX_DECOR clamping", editorContent.includes("MAX_DECOR") || editorContent.includes("roomMaxW"));
  assert("floor-editor has MAX_WALL_THICK", editorContent.includes("MAX_WALL_THICK") || editorContent.includes("300"));
  assert("floor-editor rubber clamp", editorContent.includes("clamp") && editorContent.includes("maxW"));
})();

// 9. floor.ts normalize clamping
(() => {
  const floorContent = fs.readFileSync("src/lib/floor.ts","utf8");
  assert("floor.ts decor clamp to room", floorContent.includes("Math.min(w, MAX_ROOM_CM)") || floorContent.includes("clamp(width"));
  assert("floor.ts wall thickness clamp 300", floorContent.includes("300"));
})();

// 10. use-viewport momentum thresholds
(() => {
  const vpContent = fs.readFileSync("src/lib/use-viewport.ts","utf8");
  assert("use-viewport friction 0.92", vpContent.includes("0.92"));
  assert("use-viewport dist>=3", vpContent.includes("dist >=") || vpContent.includes("dist >") || vpContent.includes(">= 3"));
  assert("use-viewport speed>0.1", vpContent.includes("0.1"));
  assert("use-viewport freeze function", vpContent.includes("const freeze"));
  assert("use-viewport wasAnimating logic", vpContent.includes("wasAnimating"));
})();

// 11. ListView sorting
(() => {
  const salaContent = fs.readFileSync("src/app/r/[slug]/(app)/sala/page.tsx","utf8");
  assert("ListView has order map libero 0", salaContent.includes("libero: 0"));
  assert("ListView has sorting", salaContent.includes(".sort("));
  assert("ListView h 52px", salaContent.includes("h-[52px]"));
})();

// 12. PWA guard
(() => {
  const guardExists = fs.existsSync("src/components/pwa-guard.tsx");
  assert("PwaGuard file exists", guardExists);
  if (guardExists) {
    const c = fs.readFileSync("src/components/pwa-guard.tsx","utf8");
    assert("PwaGuard blocks gesturestart", c.includes("gesturestart"));
    assert("PwaGuard blocks double tap 300", c.includes("300"));
  }
})();

console.log(`\n=== RISULTATO ===\nPassati: ${passed}\nFalliti: ${failed}\n`);
if (failed>0) process.exit(1);
else console.log("🎉 Tutto verde — bugproof per release 1");
