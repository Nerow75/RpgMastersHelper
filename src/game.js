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

  // Cherche les listes d'enregistrements (objets, monstres, sorts...) : des tableaux
  // d'objets qui ont un nom. On ne suppose rien d'autre sur leur forme.
  function findRecordLists(value, path = "", found = []) {
    if (Array.isArray(value)) {
      const records = value.filter((v) => v && typeof v === "object" && !Array.isArray(v));
      if (records.length >= 3 && records.filter((r) => "name" in r || "nom" in r).length >= 3) {
        found.push({ path, count: value.length, records });
        return found;
      }
      value.forEach((v, i) => findRecordLists(v, `${path}[${i}]`, found));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) findRecordLists(v, path ? `${path}.${k}` : k, found);
    }
    return found;
  }

  // Noms de champs présents dans les données (sans les valeurs), pour s'y retrouver
  // quand aucune liste n'a été reconnue.
  function collectKeys(value, keys = new Set()) {
    if (Array.isArray(value)) value.forEach((v) => collectKeys(v, keys));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        keys.add(k);
        collectKeys(v, keys);
      }
    }
    return keys;
  }

  // Télécharge une page du jeu (avec la session du joueur) et en extrait les listes.
  async function fetchPageData(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (res.redirected && new URL(res.url).pathname.startsWith("/connexion")) {
      throw new Error("non connecté");
    }
    const values = parseFlight(flightFromHtml(await res.text()));
    return { values, lists: values.flatMap((v) => findRecordLists(v)) };
  }

  return { readLevel, readCollection, flightFromHtml, parseFlight, findRecordLists, collectKeys, fetchPageData };
})();
