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

  // Premier objet qui possède tous les champs demandés (ex. les props d'un composant).
  function findObject(value, keys) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const found = findObject(v, keys);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      if (keys.every((k) => k in value)) return value;
      for (const v of Object.values(value)) {
        const found = findObject(v, keys);
        if (found) return found;
      }
    }
    return null;
  }

  // En-tête du site : bouton « Mon profil et mon énergie » qui affiche « Niv. 112 ».
  function readHeaderLevel(root) {
    const button = root.querySelector('button[aria-label="Mon profil et mon énergie"]');
    const m = button?.textContent.match(/Niv\.\s*(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // Code de deck du jeu (« DM-S-… »), à coller dans Deck → « Importer un code ».
  // Même format que le bouton « Code du deck » du site : version 2, classe, nombre de cartes
  // et identifiants en entiers variables, écrits en base 32, suivis d'un contrôle FNV-1a.
  const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const MAX_CARD_ID = 0x80000000 - 1;

  function pushVarint(bytes, value) {
    let v = Math.max(0, Math.floor(value));
    for (; v >= 128; v = Math.floor(v / 128)) bytes.push((v % 128) | 128);
    bytes.push(v);
  }

  function deckCode(classId, cardIds) {
    const ids = [...new Set(cardIds.map((id) => Math.floor(Number(id))))]
      .filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_CARD_ID)
      .slice(0, 30);
    const bytes = [2];
    pushVarint(bytes, classId);
    pushVarint(bytes, ids.length);
    for (const id of ids) pushVarint(bytes, id);

    let body = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
      buffer = (buffer << 8) | (byte & 255);
      bits += 8;
      for (; bits >= 5; bits -= 5) body += CODE_ALPHABET[(buffer >>> (bits - 5)) & 31];
      buffer &= (1 << bits) - 1;
    }
    if (bits > 0) body += CODE_ALPHABET[(buffer << (5 - bits)) & 31];

    let hash = 0x811c9dc5;
    for (const byte of [83, ...bytes]) hash = Math.imul(hash ^ byte, 0x1000193) >>> 0;
    const top = hash >>> 12;
    let check = "";
    for (let i = 3; i >= 0; i--) check += CODE_ALPHABET[(top >>> (5 * i)) & 31];
    return `DM-S-${body}-${check}`;
  }

  // Télécharge une page du jeu (avec la session du joueur) et en extrait les listes.
  async function fetchPageData(url) {
    // no-store : toujours la version actuelle de la page, jamais une copie en cache.
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (res.redirected && new URL(res.url).pathname.startsWith("/connexion")) {
      throw new Error("non connecté");
    }
    return parseFlight(flightFromHtml(await res.text()));
  }

  return { readLevel, readCollection, flightFromHtml, parseFlight, findRecords, findFields, findObject, readHeaderLevel, deckCode, fetchPageData };
})();
