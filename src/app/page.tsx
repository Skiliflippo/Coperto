import { redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// La radice non è un'app: ogni ristorante vive al suo indirizzo /r/<slug>.
// Se ce n'è uno solo lo si apre (comodo per chi usa l'app da un unico locale),
// altrimenti non si elenca nulla: i link li conosce solo chi li ha ricevuti.
export default async function Home() {
  const restaurants = await db.select({ slug: s.restaurants.slug })
    .from(s.restaurants).orderBy(asc(s.restaurants.createdAt)).limit(2);

  if (restaurants.length === 1) redirect(`/r/${restaurants[0].slug}/sala`);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand shadow-lg shadow-brand/30">
          C
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">Coperto</h1>
        <p className="mt-2 text-muted">
          {restaurants.length === 0
            ? "Nessun ristorante configurato su questo server."
            : "Apri l'app dall'indirizzo che ti è stato consegnato: coperto.app/r/il-tuo-locale"}
        </p>
      </div>
    </main>
  );
}
