// ─────────────────────────────────────────────────────────────────────────────
// PIANIFICATORE TAVOLATE GRANDI
// Pattern applicato: single resource → cluster adiacente → zone vicine → più sale.
// È lo stesso principio usato nello scheduling di risorse con capacità: un evento
// non entra in una risorsa, quindi si cerca un pool compatto; se non basta, si
// divide in pochi pool dichiarando il compromesso.
// ─────────────────────────────────────────────────────────────────────────────
import { areAdjacent, seatsOf, tableBBox } from "./join";
import type { TableT } from "./types";

export type LargePartyGroup = {
  roomId: string;
  tables: TableT[];
  clusters: TableT[][];    // gruppi realmente consecutivi, da mostrare separati
  seats: number;
  people: number;
  contiguous: boolean;
};

export type LargePartyPlan = {
  groups: LargePartyGroup[];
  tables: TableT[];
  totalSeats: number;
  waste: number;
  shortfall: number;
  complete: boolean;
  reason: string;
  preference: "none" | "full" | "partial" | "unavailable";
};

function spatiallyNear(a: TableT, b: TableT, gap: number): boolean {
  if (a.roomId !== b.roomId) return false;
  const A = tableBBox(a), B = tableBBox(b);
  const gx = Math.max(0, Math.max(A.x1 - B.x2, B.x1 - A.x2));
  const gy = Math.max(0, Math.max(A.y1 - B.y2, B.y1 - A.y2));
  return Math.hypot(gx, gy) <= gap;
}

function components(tables: TableT[], gap: number, joinOnly = true): TableT[][] {
  const unseen = new Set(tables.map((t) => t.id));
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out: TableT[][] = [];
  while (unseen.size) {
    const first = unseen.values().next().value as string;
    unseen.delete(first);
    const group: TableT[] = [];
    const queue = [first];
    while (queue.length) {
      const id = queue.shift()!;
      const table = byId.get(id)!;
      group.push(table);
      for (const otherId of [...unseen]) {
        const other = byId.get(otherId)!;
        if (joinOnly ? areAdjacent(table, other, gap) : spatiallyNear(table, other, gap)) {
          unseen.delete(otherId);
          queue.push(otherId);
        }
      }
    }
    out.push(group);
  }
  return out;
}

function connected(tables: TableT[], gap: number): boolean {
  return tables.length <= 1 || components(tables, gap, true).length === 1;
}

// Cresce da ogni possibile tavolo usando ogni volta il vicino più utile. Tiene la
// soluzione con meno spreco, meno tavoli e ingombro più compatto.
function bestCluster(
  tables: TableT[], target: number, gap: number, joinOnly = true,
): TableT[] | null {
  if (!tables.length) return null;
  let best: { tables: TableT[]; score: number } | null = null;
  for (const seed of tables) {
    const selected = [seed];
    const used = new Set([seed.id]);
    let seats = seatsOf(seed);
    while (seats < target && used.size < tables.length) {
      const frontier = tables.filter((candidate) =>
        !used.has(candidate.id)
        && selected.some((picked) => joinOnly
          ? areAdjacent(picked, candidate, gap)
          : spatiallyNear(picked, candidate, gap)));
      if (!frontier.length) break;
      const cx = selected.reduce((sum, t) => sum + t.x, 0) / selected.length;
      const cy = selected.reduce((sum, t) => sum + t.y, 0) / selected.length;
      frontier.sort((a, b) => {
        const da = Math.hypot(a.x - cx, a.y - cy);
        const db = Math.hypot(b.x - cx, b.y - cy);
        return da - db || seatsOf(b) - seatsOf(a);
      });
      const next = frontier[0];
      selected.push(next);
      used.add(next.id);
      seats += seatsOf(next);
    }
    if (seats < target) continue;
    const boxes = selected.map(tableBBox);
    const area = (Math.max(...boxes.map((b) => b.x2)) - Math.min(...boxes.map((b) => b.x1)))
      * (Math.max(...boxes.map((b) => b.y2)) - Math.min(...boxes.map((b) => b.y1)));
    const own = boxes.reduce((sum, b) => sum + (b.x2 - b.x1) * (b.y2 - b.y1), 0) || 1;
    const score = (seats - target) * 10_000 + selected.length * 100 + area / own;
    if (!best || score < best.score) best = { tables: selected, score };
  }
  return best?.tables ?? null;
}

/**
 * Pianifica un gruppo grande sui tavoli liberi in quell'orario.
 * `maxGapCm` è la distanza per tavoli realmente accostabili; la ricerca di zona
 * usa fino a 2.5× quella distanza (max 500cm), senza chiamarla "accorpata".
 */
export function planLargeParty(args: {
  party: number;
  tables: TableT[];
  maxGapCm: number;
  preferredRoomId?: string | null;
}): LargePartyPlan {
  const { party, maxGapCm, preferredRoomId } = args;
  const tables = args.tables.filter((t) => t.state !== "fuori_servizio");
  const totalAvailable = tables.reduce((sum, t) => sum + seatsOf(t), 0);
  const relaxedGap = Math.min(500, Math.max(maxGapCm * 2.5, 300));

  const rooms = new Map<string, TableT[]>();
  for (const table of tables) {
    const list = rooms.get(table.roomId) ?? [];
    list.push(table);
    rooms.set(table.roomId, list);
  }

  // 1. Un solo cluster realmente accostabile, preferibilmente nella sala chiesta.
  const roomOrder = [...rooms.entries()].sort(([a], [b]) =>
    Number(b === preferredRoomId) - Number(a === preferredRoomId));
  for (const [roomId, roomTables] of roomOrder) {
    const cluster = bestCluster(roomTables, party, maxGapCm);
    if (cluster) return makePlan(
      party, [{ roomId, tables: cluster, contiguous: true }], maxGapCm, preferredRoomId,
    );
  }

  // 2. Una sola zona della stessa sala: tavoli vicini, anche se non si toccano.
  for (const [roomId, roomTables] of roomOrder) {
    const cluster = bestCluster(roomTables, party, relaxedGap, false);
    if (cluster) return makePlan(party, [{
      roomId, tables: cluster, contiguous: connected(cluster, maxGapCm),
    }], maxGapCm, preferredRoomId);
  }

  // 3. Più zone: componenti "rilassate" ordinate per sala richiesta e capacità.
  const zones = roomOrder.flatMap(([roomId, roomTables]) =>
    components(roomTables, relaxedGap, false).map((zone) => ({
      roomId,
      tables: zone,
      seats: zone.reduce((sum, t) => sum + seatsOf(t), 0),
      preferred: roomId === preferredRoomId,
    })));
  zones.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.seats - a.seats);

  const chosen: { roomId: string; tables: TableT[]; contiguous: boolean }[] = [];
  let remaining = party;
  for (const zone of zones) {
    if (remaining <= 0) break;
    const subset = bestCluster(zone.tables, Math.min(remaining, zone.seats), relaxedGap, false) ?? zone.tables;
    chosen.push({
      roomId: zone.roomId,
      tables: subset,
      contiguous: connected(subset, maxGapCm),
    });
    remaining -= subset.reduce((sum, t) => sum + seatsOf(t), 0);
  }

  const plan = makePlan(party, chosen, maxGapCm, preferredRoomId);
  if (!plan.complete && totalAvailable < party) {
    return {
      ...plan,
      reason: `${plan.totalSeats} posti disponibili · ne mancano ${party - plan.totalSeats}`,
    };
  }
  return plan;
}

function compareTableLabel(a: TableT, b: TableT): number {
  const an = Number(a.label), bn = Number(b.label);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.label.localeCompare(b.label, "it", { numeric: true });
}

// Divide un cluster connesso in file fisiche leggibili. Una griglia 5×4 non va
// mostrata come "1+2+3+...+20", ma come quattro file separate da virgola.
function displayRuns(cluster: TableT[]): TableT[][] {
  if (cluster.length <= 4) return [[...cluster].sort(compareTableLabel)];
  const minX = Math.min(...cluster.map((t) => t.x));
  const maxX = Math.max(...cluster.map((t) => t.x));
  const minY = Math.min(...cluster.map((t) => t.y));
  const maxY = Math.max(...cluster.map((t) => t.y));
  const horizontal = maxX - minX >= maxY - minY;
  const primary = horizontal ? "y" : "x";
  const secondary = horizontal ? "x" : "y";
  const avgCross = cluster.reduce((sum, t) => sum + (horizontal ? t.height : t.width), 0) / cluster.length;
  const tolerance = Math.max(30, avgCross * 0.65);

  const ordered = [...cluster].sort((a, b) => a[primary] - b[primary] || a[secondary] - b[secondary]);
  const lines: TableT[][] = [];
  const centers: number[] = [];
  for (const table of ordered) {
    let best = -1, bestDistance = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const distance = Math.abs(table[primary] - centers[i]);
      if (distance <= tolerance && distance < bestDistance) { best = i; bestDistance = distance; }
    }
    if (best < 0) { lines.push([table]); centers.push(table[primary]); }
    else {
      lines[best].push(table);
      centers[best] = lines[best].reduce((sum, t) => sum + t[primary], 0) / lines[best].length;
    }
  }
  return lines
    .map((line) => line.sort((a, b) => a[secondary] - b[secondary] || compareTableLabel(a, b)))
    .sort((a, b) => a[0][primary] - b[0][primary]);
}

function makePlan(
  party: number,
  groups: { roomId: string; tables: TableT[]; contiguous: boolean }[],
  maxGapCm: number,
  preferredRoomId?: string | null,
): LargePartyPlan {
  let remaining = party;
  const planned: LargePartyGroup[] = groups.map((group) => {
    const seats = group.tables.reduce((sum, t) => sum + seatsOf(t), 0);
    const people = Math.min(remaining, seats);
    remaining -= people;
    const clusters = components(group.tables, maxGapCm, true)
      .flatMap(displayRuns)
      .map((cluster) => [...cluster].sort(compareTableLabel));
    return { ...group, tables: [...group.tables].sort(compareTableLabel), clusters, seats, people };
  });
  const allTables = planned.flatMap((g) => g.tables);
  const totalSeats = allTables.reduce((sum, t) => sum + seatsOf(t), 0);
  const complete = totalSeats >= party;
  const contiguousGroups = planned.filter((g) => g.contiguous).length;
  const inPreferred = preferredRoomId
    ? planned.filter((group) => group.roomId === preferredRoomId).reduce((sum, group) => sum + group.people, 0)
    : 0;
  const preference: LargePartyPlan["preference"] = !preferredRoomId
    ? "none"
    : inPreferred >= party
      ? "full"
      : inPreferred > 0
        ? "partial"
        : "unavailable";
  const preferenceText = preference === "full" ? " · sala richiesta rispettata"
    : preference === "partial" ? ` · ${inPreferred} persone nella sala richiesta`
      : preference === "unavailable" ? " · sala richiesta non disponibile"
        : "";
  const reason = complete
    ? planned.length === 1 && contiguousGroups === 1
      ? `${allTables.length} tavoli consecutivi · avanzano ${totalSeats - party} posti${preferenceText}`
      : `${planned.length} ${planned.length === 1 ? "zona" : "zone"} · ${allTables.length} tavoli · avanzano ${totalSeats - party} posti${preferenceText}`
    : `${totalSeats} posti disponibili · ne mancano ${party - totalSeats}`;
  return {
    groups: planned,
    tables: allTables,
    totalSeats,
    waste: Math.max(0, totalSeats - party),
    shortfall: Math.max(0, party - totalSeats),
    complete,
    reason,
    preference,
  };
}
