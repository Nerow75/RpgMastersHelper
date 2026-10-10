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

  return { readLevel, readCollection };
})();
