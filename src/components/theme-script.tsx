// Iniettato nei server component prima di <body>: legge localStorage in sincrono
// e applica subito .dark / .theme-x. Nessun flash di default quando l'app si apre.
// Il server non sa nulla del tema dell'utente: questo script è client-only.
export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try {
  var s = JSON.parse(localStorage.getItem("coperto.session.v4") || "{}");
  var d = document.documentElement;
  if (s.theme === "dark") d.classList.add("dark");
  if (s.restaurantTheme && s.restaurantTheme !== "terracotta") d.classList.add("theme-" + s.restaurantTheme);
  if (s.fontScale && s.fontScale !== 100) d.style.fontSize = (17 * s.fontScale / 100) + "px";
} catch (e) {}`,
      }}
    />
  );
}
