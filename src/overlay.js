// Panneau de recommandations injecté par-dessus la page du jeu.
// Il ne lit ni ne modifie rien dans le jeu : il affiche seulement des conseils
// à partir de la classe et de l'élément choisis par le joueur (données dans data/builds.js).
(() => {
  if (window.__dmxLoaded) return;
  window.__dmxLoaded = true;

  const data = DMX_DATA;
  const STORAGE_KEY = "dmx-settings";
  const PROFILE_KEY = "dmx-profile";
  let settings = { classKey: "iop", elementKey: "terre", visible: true };
  // Ce que l'extension a lu dans le jeu : niveau + objets vus sur la page "Ma collection".
  let profile = { level: null, items: {} };

  // Ordre d'affichage des emplacements ; combien d'objets recommander pour chacun.
  const SLOTS = [
    ["Arme", 1], ["Bouclier", 1], ["Chapeau", 1], ["Cape", 1], ["Amulette", 1],
    ["Anneau", 2], ["Ceinture", 1], ["Bottes", 1], ["Familier", 1], ["Dofus / Trophée", 6],
  ];

  const panel = document.createElement("div");
  panel.id = "dmx-panel";
  panel.innerHTML = `
    <div class="dmx-header">
      <span>Dofus Masters Helper</span>
      <button class="dmx-close" title="Masquer">×</button>
    </div>
    <div class="dmx-controls">
      <label>Classe <select class="dmx-class"></select></label>
      <label>Élément <select class="dmx-element"></select></label>
    </div>
    <div class="dmx-body"></div>
    <div class="dmx-footer">
      <button class="dmx-export">Exporter un échantillon des données du jeu</button>
      <textarea class="dmx-export-out" readonly hidden></textarea>
    </div>
  `;

  const classSelect = panel.querySelector(".dmx-class");
  const elementSelect = panel.querySelector(".dmx-element");
  const body = panel.querySelector(".dmx-body");

  for (const [key, cls] of Object.entries(data.classes)) {
    classSelect.add(new Option(cls.label, key));
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function list(items) {
    return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  }

  function fillElements() {
    const cls = data.classes[settings.classKey];
    elementSelect.innerHTML = "";
    for (const key of cls.elements) {
      elementSelect.add(new Option(data.elements[key].label, key));
    }
    if (!cls.elements.includes(settings.elementKey)) settings.elementKey = cls.elements[0];
    elementSelect.value = settings.elementKey;
  }

  // Pour chaque emplacement : les meilleurs objets (niveau le plus haut) équipables à ton niveau.
  function bestBySlot(owned) {
    const items = Object.values(profile.items).filter(
      (i) => i.owned === owned && (profile.level == null || i.level <= profile.level)
    );
    const rows = [];
    for (const [slot, count] of SLOTS) {
      const best = items
        .filter((i) => i.type === slot)
        .sort((a, b) => b.level - a.level)
        .slice(0, count);
      if (best.length) rows.push([slot, best]);
    }
    return rows;
  }

  function slotTable(rows) {
    return `<table class="dmx-slots">${rows
      .map(
        ([slot, items]) =>
          `<tr><th>${escapeHtml(slot)}</th><td>${items
            .map((i) => `${escapeHtml(i.name)} <span class="dmx-dim">niv. ${i.level}</span>`)
            .join("<br>")}</td></tr>`
      )
      .join("")}</table>`;
  }

  function renderProfile() {
    const known = Object.keys(profile.items).length;
    const level = profile.level != null ? `Niveau <strong>${profile.level}</strong>` : "Niveau inconnu";
    if (!known) {
      return `<section><h4>Ton personnage</h4><p>${level}</p>
        <p class="dmx-empty">Ouvre « Ma collection » pour que l'extension lise ton niveau et tes objets.</p></section>`;
    }
    const mine = bestBySlot(true);
    const targets = bestBySlot(false);
    return `
      <section><h4>Ton personnage</h4><p>${level} · ${known} objets lus</p></section>
      <section><h4>Ton meilleur équipement possédé</h4>
        ${mine.length ? slotTable(mine) : `<p class="dmx-empty">Aucun objet obtenu repéré.</p>`}</section>
      <section><h4>Objets à viser</h4>
        ${targets.length ? slotTable(targets) : `<p class="dmx-empty">Rien à signaler.</p>`}
        <p class="dmx-dim">Seuls les objets déjà affichés sont connus : dans « Ma collection », clique sur
        le filtre « Niv. … à ${profile.level ?? "…"} » pour voir ceux de ton niveau.</p></section>
    `;
  }

  function render() {
    const cls = data.classes[settings.classKey];
    const el = data.elements[settings.elementKey];
    const decks = cls.decks[settings.elementKey] || [];
    const decksHtml = decks.length
      ? decks
          .map(
            (d) => `
          <div class="dmx-deck">
            <strong>${escapeHtml(d.name)}</strong>
            ${list(d.spells)}
            ${d.tip ? `<em>${escapeHtml(d.tip)}</em>` : ""}
          </div>`
          )
          .join("")
      : `<p class="dmx-empty">Aucun deck renseigné pour ${escapeHtml(cls.label)} ${escapeHtml(el.label)}.
         Ajoute-le dans <code>data/builds.js</code>.</p>`;

    body.innerHTML = `
      ${renderProfile()}
      <section><h4>Rôle</h4><p>${escapeHtml(cls.role)}</p></section>
      <section><h4>Points de caractéristique</h4>${list(el.points)}</section>
      <section><h4>Équipement</h4>${list(el.gear)}</section>
      <section><h4>Points forts du build</h4>${list(el.strengths)}</section>
      <section><h4>Decks de sorts</h4>${decksHtml}</section>
    `;
  }

  function applyVisibility() {
    panel.style.display = settings.visible ? "" : "none";
  }

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  classSelect.addEventListener("change", () => {
    settings.classKey = classSelect.value;
    fillElements();
    render();
    save();
  });

  elementSelect.addEventListener("change", () => {
    settings.elementKey = elementSelect.value;
    render();
    save();
  });

  // Pages dont on veut connaître la forme des données.
  const EXPORT_PAGES = [
    "/bestiaire",
    "/bestiaire?onglet=objets",
    "/bestiaire?onglet=boss",
    "/collection?onglet=sorts",
    "/personnage",
  ];
  const SAMPLE_SIZE = 3;
  const MAX_RECORD_CHARS = 2000;

  // Récupère quelques enregistrements de chaque liste trouvée sur ces pages,
  // pour pouvoir écrire ensuite un lecteur adapté à leur format.
  panel.querySelector(".dmx-export").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const out = panel.querySelector(".dmx-export-out");
    button.disabled = true;
    button.textContent = "Récupération…";
    const report = {};
    for (const url of EXPORT_PAGES) {
      try {
        const { values, lists } = await DMX_GAME.fetchPageData(url);
        if (!lists.length) {
          const keys = new Set();
          values.forEach((v) => DMX_GAME.collectKeys(v, keys));
          report[url] = { aucuneListe: true, champs: [...keys].slice(0, 300) };
          continue;
        }
        report[url] = lists.map((l) => ({
          path: l.path,
          count: l.count,
          sample: l.records.slice(0, SAMPLE_SIZE).map((r) => {
            const json = JSON.stringify(r);
            return json.length > MAX_RECORD_CHARS ? json.slice(0, MAX_RECORD_CHARS) + "…" : r;
          }),
        }));
      } catch (err) {
        report[url] = `erreur : ${err.message}`;
      }
    }
    out.value = JSON.stringify(report, null, 1);
    out.hidden = false;
    out.select();
    try {
      await navigator.clipboard.writeText(out.value);
      button.textContent = "Copié ! Colle-le à Claude";
    } catch {
      button.textContent = "Copie le texte ci-dessous (Ctrl+C)";
    }
    button.disabled = false;
  });

  panel.querySelector(".dmx-close").addEventListener("click", () => {
    settings.visible = false;
    applyVisibility();
    save();
  });

  // Déplacement du panneau en le tirant par son en-tête.
  const header = panel.querySelector(".dmx-header");
  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev) => {
      panel.style.left = `${ev.clientX - dx}px`;
      panel.style.top = `${ev.clientY - dy}px`;
      panel.style.right = "auto";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "dmx-toggle") return;
    settings.visible = !settings.visible;
    applyVisibility();
    save();
  });

  // Relit la page et met à jour le profil si quelque chose a changé.
  function scan() {
    let changed = false;
    const level = DMX_GAME.readLevel(document);
    if (level != null && level !== profile.level) {
      profile.level = level;
      changed = true;
    }
    for (const item of DMX_GAME.readCollection(document)) {
      const prev = profile.items[item.name];
      if (!prev || prev.owned !== item.owned || prev.level !== item.level) {
        profile.items[item.name] = item;
        changed = true;
      }
    }
    if (changed) {
      chrome.storage.local.set({ [PROFILE_KEY]: profile });
      render();
    }
  }

  // Le site change de page sans recharger (Next.js) et charge les objets au fur et à mesure :
  // on relit la page à chaque modification, en ignorant celles de notre propre panneau.
  let scanTimer = null;
  new MutationObserver((mutations) => {
    if (mutations.every((m) => panel.contains(m.target))) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.storage.local.get([STORAGE_KEY, PROFILE_KEY], (stored) => {
    const saved = stored[STORAGE_KEY];
    if (saved && data.classes[saved.classKey]) settings = { ...settings, ...saved };
    if (stored[PROFILE_KEY]) profile = { ...profile, ...stored[PROFILE_KEY] };
    classSelect.value = settings.classKey;
    fillElements();
    render();
    applyVisibility();
    document.body.appendChild(panel);
    scan();
  });
})();
