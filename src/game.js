// Lecture (seule) des informations affichées par le jeu.
// Le site est une application Next.js : les classes CSS "pageKit-module__xxx" sont générées
// et peuvent changer à chaque mise à jour, donc on se repose sur les textes et attributs
// (title, alt, "niv. 12"...) plutôt que sur ces classes.
var DMX_GAME = (() => {
  // Page "Ma collection" : « Équipables par moi (niv. 112 ou moins) »
  function readLevel(root) {
    for (const label of root.querySelectorAll("label")) {
      const m = label.textContent.match(/Équipables par moi \(niv\.\s*(\d+)/);
      if (m) return Number(m[1]);
    }
    return null;
  }

  // Page "Ma collection" : une carte <li title="Nom (pas encore obtenu)"> par objet.
  // On y lit le nom, le type (Chapeau, Anneau...), le niveau, la rareté et si l'objet est obtenu.
  function readCollection(root) {
    const items = [];
    for (const li of root.querySelectorAll("main ul > li[title]")) {
      const title = li.getAttribute("title");
      const owned = !title.includes("(pas encore obtenu)");
      const name = title.replace(/\s*\(pas encore obtenu\)\s*$/, "").trim();
      let type = null;
      let level = null;
      for (const span of li.querySelectorAll("span")) {
        const m = span.textContent.trim().match(/^(.+?)\s*·\s*niv\.\s*(\d+)$/);
        if (m) {
          type = m[1].trim();
          level = Number(m[2]);
          break;
        }
      }
      if (!type) continue;
      const rarity = li.querySelector(".sr-only")?.textContent.trim() || "";
      const img = li.querySelector("img")?.getAttribute("src") || null;
      items.push({ name, type, level, rarity, owned, img });
    }
    return items;
  }

  // Le serveur Next.js glisse les données de la page dans des scripts
  // `self.__next_f.push([1, "..."])`. Mis bout à bout, ces morceaux forment un texte
  // "Flight" : une ligne par bloc, au format `id:JSON`.
  function flightFromHtml(html) {
    let text = "";
    for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
      try {
        const chunk = JSON.parse(m[1]);
        if (typeof chunk[1] === "string") text += chunk[1];
      } catch {
        // Morceau qui n'est pas du JSON pur : ignoré.
      }
    }
    return text;
  }

  function parseFlight(text) {
    const values = [];
    for (const line of text.split("\n")) {
      const m = line.match(/^[0-9a-f]+:([[{"].*)$/);
      if (!m) continue;
      try {
        values.push(JSON.parse(m[1]));
      } catch {
        // Ligne de texte brut ou tronquée : ignorée.
      }
    }
    return values;
  }

  // Le jeu abrège ses champs : `n` = nom, `lvl` = niveau, `lo`/`hi` = fourchette de niveau
  // (monstres), `cls` = classe (sorts). Un "enregistrement" est un objet nommé qui a l'un d'eux.
  function isRecord(o) {
    return typeof o.n === "string" && ("lvl" in o || "lo" in o || "cls" in o);
  }

  // Regroupe les enregistrements trouvés selon le champ qui les contient (item, monsters, cards...),
  // sans doublon (même id).
  function findRecords(value, key = "", groups = {}) {
    if (Array.isArray(value)) {
      value.forEach((v) => findRecords(v, key, groups));
    } else if (value && typeof value === "object") {
      if (isRecord(value)) {
        const group = (groups[key] ??= new Map());
        group.set(value.id ?? `${value.n}:${group.size}`, value);
      }
      for (const [k, v] of Object.entries(value)) findRecords(v, k, groups);
    }
    return groups;
  }

  // Première valeur trouvée pour chacun des champs demandés.
  function findFields(value, wanted, found = {}) {
    if (Array.isArray(value)) value.forEach((v) => findFields(v, wanted, found));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (wanted.includes(k) && !(k in found)) found[k] = v;
        findFields(v, wanted, found);
      }
    }
    return found;
  }

  // Télécharge une page du jeu (avec la session du joueur) et en extrait les listes.
  async function fetchPageData(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (res.redirected && new URL(res.url).pathname.startsWith("/connexion")) {
      throw new Error("non connecté");
    }
    return parseFlight(flightFromHtml(await res.text()));
  }

  return { readLevel, readCollection, flightFromHtml, parseFlight, findRecords, findFields, fetchPageData };
})();
