#!/usr/bin/env node
/**
 * Prepara una copia locale di Coperto al deploy.
 *
 * Copiare una versione nuova sopra una cartella vecchia non elimina i file ritirati.
 * Next.js, però, compila ogni route/componente ancora presente: anche se non è più
 * collegato dalla UI può rompere la build. Questo script elimina solo residui noti
 * di versioni precedenti e file generati. Non tocca .env, database o codice attuale.
 *
 * Esecuzione: node scripts/prepare-deploy.mjs
 */
import { rm, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

// Percorsi rimossi o sostituiti nelle versioni successive dell'app.
// Devono essere letterali: funzionano allo stesso modo su Windows, macOS e Linux.
const retiredPaths = [
  // Lista d'attesa rimossa dal prodotto
  "src/app/(app)/attesa",
  "src/app/api/waitlist",

  // Prima implementazione della mappa, sostituita da floor-view + floor-editor
  "src/components/floorplan.tsx",

  // Vecchia route layout stanza, sostituita da /api/rooms/[id]/floor
  "src/app/api/rooms/[id]/route.ts",

  // Vecchia creazione tavoli singola: oggi l'editor salva tutto in blocco e
  // verifica il tenant tramite /api/rooms/[id]/floor
  "src/app/api/tables/route.ts",

  // Vecchia configurazione Drizzle con URL hardcoded
  "drizzle.config.json",
];

const generatedPaths = [".next", "tsconfig.tsbuildinfo"];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

console.log("\nCoperto · preparazione deploy\n");

let removed = 0;
for (const relativePath of [...retiredPaths, ...generatedPaths]) {
  if (!(await exists(relativePath))) continue;
  await rm(path.join(root, relativePath), { recursive: true, force: true });
  console.log(`✓ rimosso ${relativePath}`);
  removed++;
}
if (!removed) console.log("✓ nessun file legacy o cache da rimuovere");

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const nextRange = String(packageJson.dependencies?.next ?? "");
const match = nextRange.match(/(\d+)\.(\d+)\.(\d+)/);
const version = match ? match.slice(1).map(Number) : null;
const isSupported = !!version && (
  version[0] > 16 ||
  (version[0] === 16 && version[1] > 3) ||
  (version[0] === 16 && version[1] === 3 && version[2] >= 4)
);

if (!isSupported) {
  console.error(`\n✗ package.json usa Next ${nextRange || "non definito"}; serve almeno 16.3.4.`);
  console.error("  Copia package.json e package-lock.json aggiornati, poi esegui npm install.\n");
  process.exitCode = 1;
} else {
  console.log(`✓ Next.js ${nextRange} (supportato)`);
}

const forbidden = retiredPaths.filter((relativePath) => relativePath.startsWith("src/"));
const leftovers = [];
for (const relativePath of forbidden) {
  if (await exists(relativePath)) leftovers.push(relativePath);
}

if (leftovers.length) {
  console.error("\n✗ restano percorsi legacy:", leftovers.join(", "));
  process.exitCode = 1;
} else {
  console.log("✓ nessuna route o componente legacy nel sorgente");
}

if (!process.exitCode) {
  console.log("\nPronto. Ora esegui: npm install && npx drizzle-kit push && npm run build\n");
}
