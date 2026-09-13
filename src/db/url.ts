// Normalizza la connessione PostgreSQL senza stampare o modificare il segreto.
//
// pg-connection-string v2 avvisa che `sslmode=require` oggi equivale a
// `verify-full`, ma cambierà significato nella prossima major. Neon genera spesso
// URL con `require`: lo convertiamo esplicitamente nella modalità sicura che
// mantiene il comportamento attuale e verifica anche l'hostname del certificato.
export function secureDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const mode = url.searchParams.get("sslmode")?.toLowerCase();
    if (mode === "prefer" || mode === "require" || mode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    // Supporta anche connection string non-URL, senza impedire l'avvio locale.
    return value.replace(
      /([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/i,
      "$1sslmode=verify-full",
    );
  }
}
