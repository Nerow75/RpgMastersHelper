// Panneau injecté par-dessus la page du jeu. Il lit les données du jeu (catalog.js, game.js),
// calcule des conseils (advisor.js) et les affiche. Il ne modifie jamais rien dans le jeu.
(() => {
  if (window.__dmxLoaded) return;
  window.__dmxLoaded = true;

  const { ELEMENTS } = DMX_ADVISOR;
  const STORAGE_KEY = "dmx-settings-v2";
  const PROFILE_KEY = "dmx-profile";
  // classId / elementKey à null = détection automatique.
  let settings = {
    classId: null,
    elementKey: null,
    tab: "conseils",
    visible: true,
    pointsMode: "optimal", // optimal | element | vitalite | libre
    customPoints: {}, // mode libre : { clé de stat: points }
  };
  // Lu sur la page "Ma collection" : niveau + objets affichés (obtenus ou non), par nom.
  let profile = { level: null, items: {} };
  let syncError = null;
  let currentDecks = []; // decks affichés dans l'onglet Sorts
  let syncing = false;

  // Icône « livre » au même trait que celles du site.
  const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5Z"></path>
    <path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20M9 8h6M9 12h4"></path></svg>`;

  const panel = document.createElement("div");
  panel.id = "dmx-panel";
  panel.innerHTML = `
    <div class="dmx-header">
      <span class="dmx-header-icon">${ICON}</span>
      <div class="dmx-header-text">
        <div class="dmx-kicker">Dofus Masters Helper</div>
        <div class="dmx-title">Conseiller</div>
      </div>
      <button class="dmx-close" title="Masquer" aria-label="Masquer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </div>
    <div class="dmx-controls">
      <label>Classe <select class="dmx-class"></select></label>
      <label>Élément <select class="dmx-element"></select></label>
    </div>
    <nav class="dmx-tabs">
      <button data-tab="conseils">Conseils</button>
      <button data-tab="sorts">Sorts</button>
      <button data-tab="bestiaire">Bestiaire</button>
    </nav>
    <div class="dmx-search" hidden>
      <input type="search" placeholder="Monstre ou objet…" aria-label="Rechercher dans le bestiaire">
    </div>
    <div class="dmx-body"></div>
    <div class="dmx-footer">
      <span class="dmx-sync-status"></span>
      <button class="dmx-sync">Mettre à jour</button>
      <button class="dmx-export" title="Pour aider au développement de l'extension">Exporter</button>
      <textarea class="dmx-export-out" readonly hidden></textarea>
    </div>
  `;

  // Image introuvable (icône absente du site) : on la masque plutôt qu'une icône cassée.
  panel.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName === "IMG") e.target.style.visibility = "hidden";
    },
    true
  );

  // Petit bouton flottant pour rouvrir le panneau quand il est fermé.
  const launcher = document.createElement("button");
  launcher.id = "dmx-launcher";
  launcher.title = "Ouvrir le conseiller Dofus Masters";
  launcher.innerHTML = ICON;

  const $ = (sel) => panel.querySelector(sel);
  const classSelect = $(".dmx-class");
  const elementSelect = $(".dmx-element");
  const searchBox = $(".dmx-search");
  const searchInput = $(".dmx-search input");
  const body = $(".dmx-body");

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  const normalize = (s) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Tout ce qui se déduit des données lues : niveau, élément, classe, objets possédés...
  function state() {
    const cat = DMX_CATALOG.get();
    const character = cat.character;
    const equipped = (character?.slots || []).map((s) => s.item).filter(Boolean);
    const detectedElement = DMX_ADVISOR.detectElement(equipped);

    // Objets possédés : inventaire de la fiche perso, objets portés, et collection si ouverte.
    const ownedIds = new Set([...(character?.inventoryIds || []), ...cat.ownedItemIds]);
    for (const item of equipped) ownedIds.add(item.id);
    const ownedNames = new Set(
      Object.values(profile.items).filter((i) => i.owned).map((i) => i.name)
    );
    if (ownedNames.size) {
      for (const item of Object.values(cat.items)) if (ownedNames.has(item.n)) ownedIds.add(item.id);
    }

    const detectedClass = character?.classId ?? null;
    return {
      cat,
      character,
      level: character?.level ?? DMX_GAME.readHeaderLevel(document) ?? profile.level,
      prestige: character?.prestige ?? null,
      items: Object.values(cat.items),
      detectedElement,
      elementKey: settings.elementKey || detectedElement || "terre",
      detectedClass,
      classId: settings.classId ?? detectedClass,
      ownedIds,
      ownedCardIds: cat.ownedCardIds.length ? new Set(cat.ownedCardIds) : null,
    };
  }

  function fillSelects(s) {
    const classes = s.cat.classes;
    const className = (id) => classes.find((c) => c.id === id)?.n;
    classSelect.innerHTML = "";
    const autoClass = className(s.detectedClass);
    classSelect.add(new Option(autoClass ? `Auto (${autoClass})` : classes.length ? "— choisis —" : "…", ""));
    for (const cls of classes) classSelect.add(new Option(cls.n, cls.id));
    classSelect.value = settings.classId ?? "";

    elementSelect.innerHTML = "";
    const auto = s.detectedElement ? `Auto (${ELEMENTS[s.detectedElement].label})` : "Auto";
    elementSelect.add(new Option(auto, ""));
    for (const [key, el] of Object.entries(ELEMENTS)) elementSelect.add(new Option(el.label, key));
    elementSelect.value = settings.elementKey || "";
  }

  // ---------- Onglet Conseils ----------

  // Libellés lisibles des stats du jeu (les autres gardent leur nom technique).
  const STAT_LABELS = {
    vitalite: "Vitalité", sagesse: "Sagesse", force: "Force", intelligence: "Intelligence",
    chance: "Chance", agilite: "Agilité", puissance: "Puissance", pa: "PA", pm: "PM", po: "Portée",
    critique: "% Critique", dommages: "Dommages", soins: "Soins", invocations: "Invocations",
    initiative: "Initiative", prospection: "Prospection", tacle: "Tacle", fuite: "Fuite",
    dommagesTerre: "Dommages Terre", dommagesFeu: "Dommages Feu", dommagesEau: "Dommages Eau",
    dommagesAir: "Dommages Air", dommagesNeutre: "Dommages Neutre",
    resPctTerre: "% Rés. Terre", resPctFeu: "% Rés. Feu", resPctEau: "% Rés. Eau",
    resPctAir: "% Rés. Air", resPctNeutre: "% Rés. Neutre",
  };

  function statsText(st = {}) {
    return Object.entries(st)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${STAT_LABELS[k] || k}`)
      .join(" · ");
  }

  // Objet avec son icône encadrée de la couleur de sa rareté, comme dans « Ma collection ».
  function itemHtml(item, detail) {
    const icon = item.icon != null
      ? `<img src="/img/items/${encodeURIComponent(item.icon)}.png" alt="" loading="lazy">` : "";
    return `<div class="dmx-item dmx-r${Number(item.r) || 0}" title="${escapeHtml(statsText(item.st))}">
      <span class="dmx-icon">${icon}</span>
      <span class="dmx-item-text">
        <span class="dmx-item-name">${escapeHtml(item.n)}</span>
        <span class="dmx-dim">${detail}</span>
      </span></div>`;
  }

  const scored = ({ item, score }) => itemHtml(item, `niv. ${item.lvl} · ${score} pts`);

  // ---------- Onglet Conseils ----------

  const POINT_MODES = [
    ["optimal", "Recommandé"],
    ["element", "Tout élément"],
    ["vitalite", "Tout Vitalité"],
    ["libre", "Libre"],
  ];

  function renderPoints(s) {
    const c = s.character;
    if (!c || !c.rows.length || c.pointsFree == null) {
      return `<p class="dmx-empty">Fiche personnage pas encore lue.</p>`;
    }
    if (c.pointsFree === 0) return `<p>Aucun point libre : tout est déjà placé.</p>`;
    const el = ELEMENTS[s.elementKey];
    const mode = settings.pointsMode;
    const plan = DMX_ADVISOR.planPoints(c.rows, c.pointsFree, mode, s.elementKey, settings.customPoints);

    const modes = POINT_MODES.map(
      ([key, label]) => `<button class="dmx-chip dmx-mode${key === mode ? " active" : ""}" data-mode="${key}">
        ${key === "element" ? `Tout ${el.statLabel}` : label}</button>`
    ).join("");

    const why = {
      optimal: `Chaque point va là où il rapporte le plus : ${el.statLabel} tant qu'elle coûte peu,
        puis Vitalité quand ${el.statLabel} devient trop chère (paliers de coût du jeu).`,
      element: `Maximum de dégâts ${el.label}, au détriment de la vie.`,
      vitalite: "Maximum de points de vie, pour encaisser.",
      libre: "Choisis toi-même combien de points mettre dans chaque caractéristique.",
    }[mode];

    let result;
    if (mode === "libre") {
      const requested = Object.values(settings.customPoints).reduce((sum, v) => sum + (Number(v) || 0), 0);
      result = `<div class="dmx-free">${c.rows
        .map((row) => {
          const a = plan.alloc.find((x) => x.row.key === row.key);
          return `<label class="dmx-free-row"><span>${escapeHtml(row.label)}</span>
            <input type="number" min="0" step="1" data-stat="${escapeHtml(row.key)}"
              value="${Number(settings.customPoints[row.key]) || ""}" placeholder="0">
            <span class="dmx-dim">${a ? `+${a.gain} (→ ${a.newBase})` : ""}</span></label>`;
        })
        .join("")}</div>
        <p class="${requested > c.pointsFree ? "dmx-warn" : "dmx-dim"}">
          ${requested > c.pointsFree ? `⚠ Tu demandes ${requested} points, tu n'en as que ${c.pointsFree}.`
            : `Reste ${plan.left} point${plan.left > 1 ? "s" : ""} à placer.`}</p>`;
    } else {
      result = `<div class="dmx-callout">${
        plan.alloc.length
          ? plan.alloc
              .map((a) => `<strong>${escapeHtml(a.row.label)}</strong> : ${a.spent} point${a.spent > 1 ? "s" : ""} →
                <strong>+${a.gain}</strong> <span class="dmx-dim">(${a.row.base} → ${a.newBase})</span>`)
              .join("<br>")
          : "Rien à placer avec ces paliers."
      }${plan.left ? `<br><span class="dmx-dim">Reste ${plan.left} point${plan.left > 1 ? "s" : ""}.</span>` : ""}</div>`;
    }

    const wasted = plan.wasted
      .map((row) => `<p class="dmx-warn">⚠ ${row.base} points en ${escapeHtml(row.label)} ne servent pas un
        build ${el.label}.</p>`)
      .join("");
    return `<p>Tu as <strong>${c.pointsFree}</strong> points à placer.</p>
      <div class="dmx-modes">${modes}</div>
      <p class="dmx-dim">${why}</p>${result}${wasted}`;
  }

  function renderGear(s) {
    if (!s.character?.slots.length) return `<p class="dmx-empty">Fiche personnage pas encore lue.</p>`;
    const upgrades = DMX_ADVISOR.gearUpgrades({
      items: s.items,
      slots: s.character.slots,
      ownedIds: s.ownedIds,
      level: s.level,
      elementKey: s.elementKey,
    });
    if (!upgrades.length) {
      return `<div class="dmx-callout">✔ Tu portes déjà ce que tu as de mieux pour un build
        ${ELEMENTS[s.elementKey].label}.</div>`;
    }
    return upgrades
      .map((u) => `<div class="dmx-slot"><div class="dmx-slot-label">${escapeHtml(u.label)}
          <span class="dmx-chip dmx-chip-up">+${u.gain} pts</span></div>
        ${u.from ? itemHtml(u.from, `retire · niv. ${u.from.lvl}`) : `<p class="dmx-dim">Emplacement vide</p>`}
        <div class="dmx-arrow">↓ équipe</div>
        ${itemHtml(u.to, `dans ton inventaire · niv. ${u.to.lvl}`)}</div>`)
      .join("") + `<p class="dmx-dim">Comparaison des stats pour un build ${ELEMENTS[s.elementKey].label}.
        Survole un objet pour voir ses stats.</p>`;
  }

  function renderAdvice(s) {
    const el = ELEMENTS[s.elementKey];
    const how = settings.elementKey ? "choisi" : s.detectedElement ? "auto" : "défaut";
    return `
      <p class="dmx-intro">Ce que tu peux améliorer tout de suite : tes points et ton équipement.</p>
      <div class="dmx-stats">
        <div class="dmx-stat"><div class="dmx-stat-label">Niveau</div>
          <div class="dmx-stat-value">${s.level ?? "?"}</div></div>
        <div class="dmx-stat"><div class="dmx-stat-label">Prestige</div>
          <div class="dmx-stat-value">${s.prestige ?? "?"}</div></div>
        <div class="dmx-stat dmx-el-${s.elementKey}"><div class="dmx-stat-label">Élément · ${how}</div>
          <div class="dmx-stat-value dmx-el-${s.elementKey}">${el.label}</div></div>
      </div>
      <section><h4>Points de caractéristique</h4>${renderPoints(s)}</section>
      <section><h4>Équipement à changer</h4>${renderGear(s)}</section>`;
  }

  // ---------- Onglet Sorts ----------

  const spellIcon = (card) =>
    card.icon != null ? `<img src="/img/spells/sort_${encodeURIComponent(card.icon)}.png" alt="" loading="lazy">` : "";

  function cardHtml({ card, owned, perAp }, elementKey) {
    const chips = [`<span class="dmx-chip">${card.ap} PA</span>`];
    if (perAp != null) {
      chips.push(`<span class="dmx-chip dmx-chip-el dmx-el-${elementKey}">~${Math.round(perAp)} dégâts/PA</span>`);
    }
    if (owned === false) chips.push(`<span class="dmx-chip">non obtenu</span>`);
    return `<li class="dmx-row dmx-spell${owned === false ? " dmx-locked" : ""}">
      <span class="dmx-spell-icon">${spellIcon(card)}</span>
      <div class="dmx-spell-text">
        <div class="dmx-row-head"><span class="dmx-row-title">${escapeHtml(card.n)}</span>${chips.join("")}</div>
        ${card.d ? `<div class="dmx-dim">${escapeHtml(card.d)}</div>` : ""}
      </div></li>`;
  }

  // Un deck : ses 10 sorts en images, et le code à importer dans la page Deck du jeu.
  function deckHtml(deck, s, index) {
    const missing = deck.cards.filter((x) => x.owned === false).length;
    const tiles = deck.cards
      .map(({ card, owned }) => `<span class="dmx-deck-card${owned === false ? " dmx-locked" : ""}"
        title="${escapeHtml(`${card.n} · ${card.ap} PA${card.d ? `\n${card.d}` : ""}`)}">${spellIcon(card)}</span>`)
      .join("");
    const names = deck.cards.map(({ card }) => escapeHtml(card.n)).join(" · ");
    return `<div class="dmx-row dmx-deck">
      <div class="dmx-row-head"><span class="dmx-row-title">${escapeHtml(deck.name)}</span>
        <span class="dmx-chip">${deck.cards.length}/${DMX_ADVISOR.DECK_SIZE}</span>
        ${missing ? `<span class="dmx-chip">${missing} non obtenu${missing > 1 ? "s" : ""}</span>` : ""}</div>
      <div class="dmx-dim">${escapeHtml(deck.desc)}</div>
      <div class="dmx-deck-grid">${tiles}</div>
      <div class="dmx-dim dmx-deck-names">${names}</div>
      <div class="dmx-deck-actions">
        <button class="dmx-btn-primary" data-deck="${index}">Copier le code du deck</button>
        <a class="dmx-btn-ghost" href="/deck">Ouvrir Deck</a>
      </div>
    </div>`;
  }

  function renderSpells(s) {
    const intro = `<p class="dmx-intro">Des decks de 10 sorts prêts à l'emploi pour ta classe et ton élément.
      Clique sur « Copier le code », puis dans <strong>Deck</strong> → <strong>Importer un code</strong>, colle-le.</p>`;
    if (s.classId == null) return `${intro}<p class="dmx-empty">Choisis ta classe en haut du panneau.</p>`;
    const cls = s.cat.classes.find((c) => c.id === s.classId);
    const args = {
      cards: Object.values(s.cat.cards),
      classId: s.classId,
      level: s.level,
      elementKey: s.elementKey,
      ownedCardIds: s.ownedCardIds,
    };
    currentDecks = DMX_ADVISOR.buildDecks(args);
    const { damage, support } = DMX_ADVISOR.spellAdvice(args);
    const el = ELEMENTS[s.elementKey];
    return `${intro}
      ${cls ? `<section><h4>${escapeHtml(cls.n)} · ${escapeHtml(cls.role || "")}</h4>
        ${cls.passive ? `<div class="dmx-callout"><strong>${escapeHtml(cls.passive.name)}</strong> —
          ${escapeHtml(cls.passive.desc)}</div>` : ""}</section>` : ""}
      <section><h4>Decks proposés</h4>
        ${currentDecks.length ? currentDecks.map((d, i) => deckHtml(d, s, i)).join("")
          : `<p class="dmx-empty">Aucun sort connu pour cette classe : clique sur « Mettre à jour ».</p>`}</section>
      <section><h4>Meilleurs sorts de dégâts ${el.label}</h4>
        ${damage.length ? `<ul>${damage.slice(0, 8).map((d) => cardHtml(d, s.elementKey)).join("")}</ul>`
          : `<p class="dmx-empty">Aucun sort de dégâts ${el.label} connu pour cette classe.</p>`}</section>
      <section><h4>Soutien · boucliers, soins, buffs</h4>
        ${support.length ? `<ul>${support.slice(0, 5).map((d) => cardHtml(d, s.elementKey)).join("")}</ul>`
          : `<p class="dmx-empty">Aucun.</p>`}</section>`;
  }

  // ---------- Onglet Bestiaire ----------

  function renderBestiary(s) {
    const q = normalize(searchInput.value.trim());
    if (!s.cat.monsters.length) return `<p class="dmx-empty">Bestiaire pas encore synchronisé.</p>`;
    if (q.length < 2) {
      const lvl = s.level;
      const near = lvl == null ? [] : s.cat.monsters
        .filter((m) => m.lo <= lvl + 5 && m.hi >= lvl - 10 && (m.d || []).length)
        .sort((a, b) => Math.abs(a.hi - lvl) - Math.abs(b.hi - lvl))
        .slice(0, 6);
      return `<p class="dmx-intro">Cherche un monstre (zones, butin) ou un objet (stats, qui le lâche).</p>
        ${near.length ? `<section><h4>Monstres de ton niveau</h4><ul>${near.map(monsterHtml).join("")}</ul></section>` : ""}
        <div class="dmx-stats">
          <div class="dmx-stat"><div class="dmx-stat-label">Monstres</div>
            <div class="dmx-stat-value">${s.cat.monsters.length}</div></div>
          <div class="dmx-stat"><div class="dmx-stat-label">Objets</div>
            <div class="dmx-stat-value">${s.items.length}</div></div>
          <div class="dmx-stat"><div class="dmx-stat-label">Zones</div>
            <div class="dmx-stat-value">${Object.keys(s.cat.zones).length}</div></div>
        </div>
        <p class="dmx-dim" style="margin-top:10px">Tape au moins 2 lettres pour chercher.</p>`;
    }
    const monsters = s.cat.monsters.filter((m) => normalize(m.n).includes(q)).slice(0, 6);
    const items = s.items.filter((i) => normalize(i.n).includes(q)).slice(0, 6);
    const monsterList = monsters.map(monsterHtml).join("");
    const itemList = items
      .map((i) => {
        const droppers = s.cat.monsters.filter((m) => (m.d || []).some(([id]) => id === i.id));
        return `<li class="dmx-row">${itemHtml(i, `${escapeHtml(i.s || "")} · niv. ${i.lvl}`)}
          <div class="dmx-dim">${escapeHtml(statsText(i.st))}</div>
          ${droppers.length ? `<div class="dmx-dim">Lâché par : ${droppers.slice(0, 5).map((m) => escapeHtml(m.n)).join(", ")}</div>` : ""}</li>`;
      })
      .join("");
    return `
      <section><h4>Monstres</h4>${monsterList ? `<ul>${monsterList}</ul>` : `<p class="dmx-empty">Aucun.</p>`}</section>
      <section><h4>Objets</h4>${itemList ? `<ul>${itemList}</ul>` : `<p class="dmx-empty">Aucun.</p>`}</section>`;

    // Monstre : niveaux, race, zones et butin (avec icônes).
    function monsterHtml(m) {
      const zoneName = (id) => {
        const z = s.cat.zones[id];
        return z ? `${z.n} (${z.area})` : `zone ${id}`;
      };
      const drops = (m.d || [])
        .map(([id, min]) => {
          const item = s.cat.items[id];
          return item ? itemHtml(item, `${min} % · niv. ${item.lvl}`) : `<p class="dmx-dim">Objet ${id} (${min} %)</p>`;
        })
        .join("");
      const zones = (m.z || []).map((id) => escapeHtml(zoneName(id))).join(", ") || "?";
      const img = m.gfx != null
        ? `<img src="/img/monsters/${encodeURIComponent(m.gfx)}.png" alt="" loading="lazy">` : "";
      return `<li class="dmx-row">
        <div class="dmx-monster"><span class="dmx-monster-img">${img}</span>
          <div class="dmx-spell-text">
            <div class="dmx-row-head"><span class="dmx-row-title">${escapeHtml(m.n)}</span>
              <span class="dmx-chip">niv. ${m.lo}–${m.hi}</span></div>
            <div class="dmx-dim">${escapeHtml(m.race)} · ${zones}</div>
          </div></div>${drops}</li>`;
    }
  }

  // ---------- Rendu général ----------

  function renderStatus(s) {
    const status = $(".dmx-sync-status");
    if (syncing) status.textContent = "Synchronisation…";
    else if (syncError) status.textContent = `⚠ ${syncError}`;
    else if (s.cat.syncErrors?.length) {
      status.textContent = `⚠ Pages non lues : ${s.cat.syncErrors.join(", ")} (réessaie « Mettre à jour »)`;
    }
    else if (s.cat.syncedAt) {
      const minutes = Math.round((Date.now() - s.cat.syncedAt) / 60000);
      status.textContent = `${s.items.length} objets · ${Object.keys(s.cat.cards).length} sorts · ${
        minutes < 60 ? `il y a ${minutes} min` : `il y a ${Math.round(minutes / 60)} h`
      }`;
    } else status.textContent = "Pas encore synchronisé";
    $(".dmx-sync").disabled = syncing;
  }

  function render() {
    const s = state();
    fillSelects(s);
    for (const b of panel.querySelectorAll(".dmx-tabs button")) {
      b.classList.toggle("active", b.dataset.tab === settings.tab);
    }
    searchBox.hidden = settings.tab !== "bestiaire";
    if (settings.tab === "sorts") body.innerHTML = renderSpells(s);
    else if (settings.tab === "bestiaire") body.innerHTML = renderBestiary(s);
    else body.innerHTML = renderAdvice(s);
    renderStatus(s);
  }

  function applyVisibility() {
    panel.style.display = settings.visible ? "" : "none";
    launcher.style.display = settings.visible ? "none" : "";
  }

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  async function sync(force) {
    syncing = true;
    syncError = null;
    render();
    try {
      await DMX_CATALOG.refresh({ force });
    } catch (err) {
      syncError = err.message === "non connecté" ? "connecte-toi au jeu" : `erreur : ${err.message}`;
    }
    syncing = false;
    render();
  }

  // ---------- Événements ----------

  classSelect.addEventListener("change", () => {
    settings.classId = classSelect.value === "" ? null : Number(classSelect.value);
    save();
    render();
  });

  elementSelect.addEventListener("change", () => {
    settings.elementKey = elementSelect.value || null;
    save();
    render();
  });

  for (const b of panel.querySelectorAll(".dmx-tabs button")) {
    b.addEventListener("click", () => {
      settings.tab = b.dataset.tab;
      save();
      render();
      if (settings.tab === "bestiaire") searchInput.focus();
    });
  }

  // Boutons de stratégie des points et champs du mode libre (contenu redessiné à chaque rendu).
  body.addEventListener("click", async (e) => {
    const deckButton = e.target.closest("[data-deck]");
    if (deckButton) {
      const deck = currentDecks[Number(deckButton.dataset.deck)];
      const code = DMX_GAME.deckCode(state().classId, deck.cards.map((x) => x.card.id));
      try {
        await navigator.clipboard.writeText(code);
        deckButton.textContent = "Code copié ✓";
      } catch {
        window.prompt("Copie ce code puis colle-le dans Deck → Importer un code :", code);
      }
      return;
    }
    const mode = e.target.closest("[data-mode]")?.dataset.mode;
    if (!mode) return;
    settings.pointsMode = mode;
    save();
    render();
  });

  body.addEventListener("input", (e) => {
    const stat = e.target.dataset?.stat;
    if (!stat) return;
    settings.customPoints = { ...settings.customPoints, [stat]: e.target.value };
    save();
    const caret = e.target.selectionStart;
    render();
    const input = body.querySelector(`input[data-stat="${CSS.escape(stat)}"]`);
    input?.focus();
    try {
      input?.setSelectionRange(caret, caret);
    } catch {
      // Les champs numériques ne gèrent pas toujours la position du curseur.
    }
  });

  searchInput.addEventListener("input", () => {
    body.innerHTML = renderBestiary(state());
  });

  $(".dmx-sync").addEventListener("click", () => sync(true));

  launcher.addEventListener("click", () => {
    settings.visible = true;
    applyVisibility();
    save();
  });

  $(".dmx-close").addEventListener("click", () => {
    settings.visible = false;
    applyVisibility();
    save();
  });

  // Export d'un échantillon des données de chaque page, pour faire évoluer l'extension.
  const EXPORT_PAGES = ["/bestiaire", "/bestiaire?onglet=objets", "/collection?onglet=sorts", "/personnage"];
  const EXPORT_FIELDS = ["rows", "pointsFree", "slots", "inventory", "current", "prestige", "presets", "zones"];
  const truncate = (value) => {
    const json = JSON.stringify(Array.isArray(value) ? value.slice(0, 3) : value);
    return json.length > 3000 ? json.slice(0, 3000) + "…" : JSON.parse(json);
  };

  $(".dmx-export").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const out = $(".dmx-export-out");
    button.disabled = true;
    const report = {};
    for (const url of EXPORT_PAGES) {
      try {
        const values = await DMX_GAME.fetchPageData(url);
        const records = {};
        for (const [key, group] of Object.entries(DMX_GAME.findRecords(values))) {
          records[key] = { count: group.size, sample: truncate([...group.values()]) };
        }
        const fields = {};
        for (const [key, value] of Object.entries(DMX_GAME.findFields(values, EXPORT_FIELDS))) {
          fields[key] = truncate(value);
        }
        report[url] = { records, fields };
      } catch (err) {
        report[url] = `erreur : ${err.message}`;
      }
    }
    out.value = JSON.stringify(report, null, 1);
    out.hidden = false;
    out.select();
    try {
      await navigator.clipboard.writeText(out.value);
      button.textContent = "Copié !";
    } catch {
      button.textContent = "Copie (Ctrl+C)";
    }
    button.disabled = false;
  });

  // Déplacement du panneau en le tirant par son en-tête.
  $(".dmx-header").addEventListener("mousedown", (e) => {
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

  // Relit la page "Ma collection" (niveau, objets obtenus) quand elle change.
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
    if (mutations.every((m) => panel.contains(m.target) || m.target === launcher)) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });

  (async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY, PROFILE_KEY]);
    settings = { ...settings, ...stored[STORAGE_KEY] };
    if (stored[PROFILE_KEY]) profile = { ...profile, ...stored[PROFILE_KEY] };
    await DMX_CATALOG.load();
    render();
    applyVisibility();
    document.body.append(panel, launcher);
    scan();
    sync(false);
  })();
})();
