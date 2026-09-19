import { notFound, redirect } from "next/navigation";
import { getRestaurantBySlug } from "@/server/data";

export const dynamic = "force-dynamic";

// /r/<slug> nuda: si entra sempre dalla vista sala.
// Se non sei loggato il guard dell'app manda lui a /login;
// se la sessione c'è già, atterri direttamente sulla mappa.
// (Prima qui non c'era NESSUNA page → Next rispondeva 404 e bisognava
//  digitare a mano /login ad ogni aggiornamento/deploy.)
export default async function TenantRootPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();
  redirect(`/r/${slug}/sala`);
}
