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
    welcomed: false, // message d'accueil déjà fermé
    collapsed: false, // panneau replié sur son en-tête
    doneToday: {}, // étapes cochées à la main : { clé: "AAAA-MM-JJ" }
    pos: null, // { left, top } si le joueur l'a déplacé
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
      <button class="dmx-collapse dmx-icon-btn" title="Replier" aria-label="Replier" aria-expanded="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"></path></svg>
      </button>
      <button class="dmx-close dmx-icon-btn" title="Fermer" aria-label="Fermer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </div>
    <div class="dmx-controls">
      <div class="dmx-field"><span class="dmx-field-label">Classe</span><div class="dmx-class"></div></div>
      <div class="dmx-field"><span class="dmx-field-label">Élément
        <span class="dmx-help" tabindex="0" data-tip="Le type de dégâts de ton build : Terre (Force),
          Feu (Intelligence), Eau (Chance) ou Air (Agilité). Détecté d'après ton équipement.">?</span></span>
        <div class="dmx-element"></div></div>
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
    <div class="dmx-tooltip" role="tooltip" hidden></div>
    <div class="dmx-footer">
      <span class="dmx-sync-status"></span>
      <button class="dmx-sync" title="Relire maintenant toutes les données du jeu">↻ Tout relire</button>
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

  const tooltip = panel.querySelector(".dmx-tooltip");
  function showTip(target) {
    tooltip.textContent = target.dataset.tip;
    tooltip.hidden = false;
    const p = panel.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const left = Math.min(Math.max(8, t.left - p.left - tooltip.offsetWidth / 2), p.width - tooltip.offsetWidth - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${t.bottom - p.top + 6}px`;
  }
  panel.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tip]");
    if (target) showTip(target);
  });
  panel.addEventListener("mouseout", (e) => {
    if (e.target.closest("[data-tip]")) tooltip.hidden = true;
  });
  panel.addEventListener("focusin", (e) => {
    const target = e.target.closest("[data-tip]");
    if (target) showTip(target);
  });
  panel.addEventListener("focusout", () => (tooltip.hidden = true));

  // Petit bouton flottant pour rouvrir le panneau quand il est fermé.
  const launcher = document.createElement("button");
  launcher.id = "dmx-launcher";
  launcher.title = "Ouvrir le conseiller Dofus Masters";
  launcher.innerHTML = ICON;

  const $ = (sel) => panel.querySelector(sel);
  const classDropdown = DMX_DROPDOWN.create($(".dmx-class"), (value) => {
    settings.classId = value;
    save();
    render();
  });
  const elementDropdown = DMX_DROPDOWN.create($(".dmx-element"), (value) => {
    settings.elementKey = value;
    save();
    render();
  });
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
      // Page Deck du jeu : sorts utilisables, deck actif, taille d'un deck.
      usableCardIds: character?.deck?.usableCardIds?.length ? new Set(character.deck.usableCardIds) : null,
      activeDeckIds: character?.deck?.activeDeckIds || [],
      deckSize: character?.deck?.size || DMX_ADVISOR.DECK_SIZE,
    };
  }

  // Couleurs des éléments, reprises des parchemins du jeu.
  const ELEMENT_COLORS = { terre: "#b98a4a", feu: "#d9665f", eau: "#5f8fd6", air: "#5fb07a" };

  function fillSelects(s) {
    const classes = s.cat.classes;
    const classIcon = (cls) => cls?.img || (cls ? `/img/breeds/symbol_${cls.id}.png` : null);
    const detected = classes.find((c) => c.id === s.detectedClass);
    classDropdown.set(
      [
        {
          value: null,
          label: detected ? `${detected.n} (auto)` : classes.length ? "Choisis ta classe" : "Chargement…",
          icon: classIcon(detected),
          hint: detected ? "détectée" : "",
        },
        ...classes.map((c) => ({ value: c.id, label: c.n, icon: classIcon(c), hint: c.role || "" })),
      ],
      settings.classId
    );

    const auto = s.detectedElement;
    elementDropdown.set(
      [
        {
          value: null,
          label: auto ? `${ELEMENTS[auto].label} (auto)` : "Auto",
          color: auto ? ELEMENT_COLORS[auto] : null,
          hint: auto ? "d'après ton équipement" : "",
        },
        ...Object.entries(ELEMENTS).map(([key, el]) => ({
          value: key,
          label: el.label,
          color: ELEMENT_COLORS[key],
          hint: el.statLabel,
        })),
      ],
      settings.elementKey
    );
  }

  // Petite aide « ? » : son texte s'affiche au survol (voir l'infobulle plus bas).
  const help = (text) => `<span class="dmx-help" tabindex="0" data-tip="${escapeHtml(text)}">?</span>`;

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

  // Liste d'actions concrètes, dans l'ordre, avec un bouton vers la bonne page.
  function deckArgs(s) {
    return {
      cards: Object.values(s.cat.cards),
      classId: s.classId,
      level: s.level,
      elementKey: s.elementKey,
      ownedCardIds: s.ownedCardIds,
      usableCardIds: s.usableCardIds,
      deckSize: s.deckSize,
    };
  }

  // Jour courant (AAAA-MM-JJ), pour les étapes « faites aujourd'hui ».
  const today = () => new Date().toISOString().slice(0, 10);

  // Liste d'actions concrètes, dans l'ordre. Chaque étape a une clé stable : quand une étape
  // disparaît après une relecture du personnage, c'est qu'elle a été faite (voir renderTodo).
  function todoSteps(s) {
    const steps = [];
    const c = s.character;
    if (!c) {
      steps.push({
        key: "login",
        title: "Connecte-toi au jeu",
        text: "Le conseiller lit ton personnage : connecte-toi, il se met à jour tout seul.",
      });
      return steps;
    }
    if (c.pointsFree > 0 && c.rows.length) {
      const plan = DMX_ADVISOR.planPoints(c.rows, c.pointsFree, settings.pointsMode, s.elementKey, settings.customPoints);
      const summary = plan.alloc.map((a) => `+${a.gain} ${a.row.label}`).join(", ");
      steps.push({
        key: "points",
        title: `Place tes ${c.pointsFree} points de caractéristique`,
        text: summary ? `Conseillé : ${summary}. Sur la page Personnage, clique sur « + » à côté de chaque
          caractéristique.` : "Choisis une répartition plus bas.",
        doneTitle: "Points de caractéristique placés",
        link: ["/personnage", "Ouvrir Personnage"],
      });
    }
    const upgrades = DMX_ADVISOR.gearUpgrades({
      items: s.items,
      slots: c.slots,
      ownedIds: s.ownedIds,
      level: s.level,
      elementKey: s.elementKey,
    });
    for (const u of upgrades.slice(0, 3)) {
      steps.push({
        key: `equip:${u.to.id}`,
        title: `Équipe ${u.to.n}`,
        text: `${u.label} : ${u.from ? `à la place de ${u.from.n}` : "emplacement vide"}. Tu l'as déjà
          dans ton inventaire (+${u.gain} pts).`,
        doneTitle: `${u.to.n} équipé`,
        link: ["/personnage", "Ouvrir Personnage"],
      });
    }
    if (s.classId == null) {
      steps.push({ key: "class", title: "Choisis ta classe", text: "En haut du panneau, pour recevoir des decks de sorts." });
    } else {
      currentDecks = DMX_ADVISOR.buildDecks(deckArgs(s));
      const best = currentDecks[0];
      if (best && !DMX_ADVISOR.deckIsActive(best, s.activeDeckIds)) {
        steps.push({
          key: `deck:${best.cards.map((x) => x.card.id).sort().join(",")}`,
          title: `Mets le deck « ${best.name} »`,
          text: "Copie son code, puis dans Deck clique sur « Importer un code », colle-le et enregistre.",
          doneTitle: `Deck « ${best.name} » en place`,
          deck: 0,
          link: ["/deck", "Ouvrir Deck"],
        });
      }
    }
    // Combat : on ne peut pas le détecter, le joueur le coche lui-même (une fois par jour).
    if (settings.doneToday?.combat !== today()) {
      steps.push({
        key: "combat",
        title: "Combats pour progresser",
        text: `Dans la Chasse, affronte les Recherchés et les Archimages ; ou avance dans l'Aventure
          pour passer des paliers.`,
        doneTitle: "Combats du jour faits",
        links: [["/chasse", "Chasse"], ["/aventure", "Aventure"]],
        manual: true,
      });
    }
    return steps;
  }

  // Étapes faites pendant cette session : affichées cochées en bas de la liste.
  let lastSteps = null;
  const doneSteps = new Map();

  function renderTodo(s) {
    const steps = todoSteps(s);
    const keys = new Set(steps.map((x) => x.key));
    // Une étape qui disparaît alors que la fiche était déjà lue = une étape faite.
    if (lastSteps && s.character) {
      for (const prev of lastSteps) if (!keys.has(prev.key) && prev.key !== "login") doneSteps.set(prev.key, prev);
    }
    for (const key of keys) doneSteps.delete(key);
    lastSteps = s.character ? steps : null;

    const active = steps
      .map((step, i) => `<li><span class="dmx-todo-num">${i + 1}</span><div>
        <div class="dmx-todo-title">${escapeHtml(step.title)}</div>
        <div class="dmx-dim">${escapeHtml(step.text)}</div>
        <div class="dmx-todo-actions">
          ${step.deck != null ? `<button class="dmx-btn-primary" data-deck="${step.deck}">Copier le code</button>` : ""}
          ${step.link ? `<a class="dmx-btn-ghost" href="${step.link[0]}">${step.link[1]} →</a>` : ""}
          ${(step.links || []).map(([href, label]) => `<a class="dmx-btn-ghost" href="${href}">${label} →</a>`).join("")}
          ${step.manual ? `<button class="dmx-btn-ghost" data-done="${step.key}">✓ C'est fait</button>` : ""}
        </div></div></li>`)
      .join("");
    const done = [...doneSteps.values()]
      .map((step) => `<li class="dmx-done"><span class="dmx-todo-num">✓</span><div>
        <div class="dmx-todo-title">${escapeHtml(step.doneTitle || step.title)}</div></div></li>`)
      .join("");
    if (!active && !done) return `<div class="dmx-callout">✔ Rien à faire pour l'instant, bravo !</div>`;
    return `<ol class="dmx-todo">${active}${done}</ol>
      ${!active ? `<div class="dmx-callout">✔ Tout est fait, bravo !</div>` : ""}`;
  }

  function renderWelcome() {
    if (settings.welcomed) return "";
    return `<div class="dmx-welcome">
      <div class="dmx-todo-title">Bienvenue ! 👋</div>
      <p>Ce panneau lit ton personnage et te dit quoi faire pour progresser :</p>
      <ul>
        <li><strong>Conseils</strong> : ce que tu peux améliorer tout de suite (points, équipement).</li>
        <li><strong>Sorts</strong> : des decks de sorts prêts à importer.</li>
        <li><strong>Bestiaire</strong> : les monstres de ton niveau et ce qu'ils lâchent.</li>
      </ul>
      <p class="dmx-dim">Passe la souris sur les <span class="dmx-help">?</span> pour une explication.
      Tu peux déplacer le panneau en tirant son titre.</p>
      <button class="dmx-btn-primary" data-action="welcome">C'est parti</button>
    </div>`;
  }

  function renderAdvice(s) {
    const el = ELEMENTS[s.elementKey];
    const how = settings.elementKey ? "choisi" : s.detectedElement ? "auto" : "défaut";
    return `${renderWelcome()}
      <div class="dmx-stats">
        <div class="dmx-stat"><div class="dmx-stat-label">Niveau</div>
          <div class="dmx-stat-value">${s.level ?? "?"}</div></div>
        <div class="dmx-stat"><div class="dmx-stat-label">Prestige ${help("Chaque prestige donne des bonus permanents en combat (PA, PM, portée).")}</div>
          <div class="dmx-stat-value">${s.prestige ?? "?"}</div></div>
        <div class="dmx-stat dmx-el-${s.elementKey}"><div class="dmx-stat-label">Élément · ${how}</div>
          <div class="dmx-stat-value dmx-el-${s.elementKey}">${el.label}</div></div>
      </div>
      <section><h4>À faire maintenant</h4>${renderTodo(s)}</section>
      <section><h4>Points de caractéristique ${help(`Tu gagnes des points à chaque niveau. Plus une caractéristique est haute, plus un point coûte cher (1, puis 2, 3, 4 points). ${el.statLabel} augmente tes dégâts ${el.label}, Vitalité tes points de vie.`)}</h4>${renderPoints(s)}</section>
      <section><h4>Équipement à changer ${help("Objets de ton inventaire qui sont meilleurs que ce que tu portes pour ton élément. « pts » = note de l'objet : plus c'est haut, mieux c'est.")}</h4>${renderGear(s)}</section>`;
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
    const active = DMX_ADVISOR.deckIsActive(deck, s.activeDeckIds);
    const short = deck.cards.length < deck.size;
    return `<div class="dmx-row dmx-deck${active ? " dmx-deck-active" : ""}">
      <div class="dmx-row-head"><span class="dmx-row-title">${escapeHtml(deck.name)}</span>
        <span class="dmx-chip">${deck.cards.length}/${deck.size}</span>
        ${active ? `<span class="dmx-chip dmx-chip-up">✔ Ton deck actuel</span>` : ""}
        ${missing ? `<span class="dmx-chip">${missing} non obtenu${missing > 1 ? "s" : ""}</span>` : ""}</div>
      <div class="dmx-dim">${escapeHtml(deck.desc)}</div>
      ${short ? `<p class="dmx-warn">Tu n'as que ${deck.cards.length} sorts utilisables : débloque-en d'autres
        pour compléter ce deck.</p>` : ""}
      <div class="dmx-deck-grid">${tiles}</div>
      <div class="dmx-dim dmx-deck-names">${names}</div>
      <div class="dmx-deck-actions">
        <button class="dmx-btn-primary" data-deck="${index}">Copier le code du deck</button>
        <a class="dmx-btn-ghost" href="/deck">Ouvrir Deck</a>
      </div>
    </div>`;
  }

  function renderSpells(s) {
    const intro = `<p class="dmx-intro">Des decks de ${s.deckSize} sorts prêts à l'emploi pour ta classe et ton élément.
      Clique sur « Copier le code », puis dans <strong>Deck</strong> → <strong>Importer un code</strong>, colle-le.</p>`;
    if (s.classId == null) return `${intro}<p class="dmx-empty">Choisis ta classe en haut du panneau.</p>`;
    const cls = s.cat.classes.find((c) => c.id === s.classId);
    const args = deckArgs(s);
    currentDecks = DMX_ADVISOR.buildDecks(args);
    const { damage, support } = DMX_ADVISOR.spellAdvice(args);
    const el = ELEMENTS[s.elementKey];
    return `${intro}
      ${cls ? `<section><h4>${escapeHtml(cls.n)} · ${escapeHtml(cls.role || "")}</h4>
        ${cls.passive ? `<div class="dmx-callout"><strong>${escapeHtml(cls.passive.name)}</strong> —
          ${escapeHtml(cls.passive.desc)}</div>` : ""}</section>` : ""}
      <section><h4>Decks proposés</h4>
        ${currentDecks.length ? currentDecks.map((d, i) => deckHtml(d, s, i)).join("")
          : `<p class="dmx-empty">Aucun sort connu pour cette classe pour l'instant.</p>`}</section>
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
      status.textContent = `⚠ Pages non lues : ${s.cat.syncErrors.join(", ")} (réessaie « Tout relire »)`;
    }
    else if (s.cat.syncedAt) {
      // Le personnage se relit tout seul : on indique juste depuis quand il est à jour.
      const seconds = Math.round((Date.now() - s.cat.characterAt) / 1000);
      const ago = seconds < 60 ? "à l'instant" : seconds < 3600 ? `il y a ${Math.round(seconds / 60)} min`
        : `il y a ${Math.round(seconds / 3600)} h`;
      status.innerHTML = `<span class="dmx-live">●</span> Personnage à jour ${ago} · ${s.items.length} objets ·
        ${Object.keys(s.cat.cards).length} sorts`;
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
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset?.stat : null;
    const caret = focused ? document.activeElement.selectionStart : null;
    // Une erreur dans un onglet ne doit pas figer tout le panneau.
    try {
      if (settings.tab === "sorts") body.innerHTML = renderSpells(s);
      else if (settings.tab === "bestiaire") body.innerHTML = renderBestiary(s);
      else body.innerHTML = renderAdvice(s);
    } catch (err) {
      console.error("[Dofus Masters Helper]", err);
      body.innerHTML = `<p class="dmx-warn">⚠ Erreur d'affichage : ${escapeHtml(err.message)}.
        Essaie « Tout relire » ; si ça persiste, clique sur « Exporter » et envoie le résultat.</p>`;
    }
    if (focused) {
      const input = body.querySelector(`input[data-stat="${CSS.escape(focused)}"]`);
      input?.focus();
      try {
        input?.setSelectionRange(caret, caret);
      } catch {
        // Les champs numériques ne gèrent pas toujours la position du curseur.
      }
    }
    renderStatus(s);
  }

  // ---------- Mise à jour automatique du personnage ----------
  // Pas besoin de bouton : la fiche et le deck sont relus quand le joueur change de page,
  // revient sur l'onglet, ou clique sur un bouton des pages Personnage / Deck / Inventaire.
  let refreshTimer = null;
  let refreshing = false;
  const MIN_REFRESH_GAP = 3000; // même limite que DMX_CATALOG.refreshCharacter
  function refreshCharacterSoon(delay) {
    clearTimeout(refreshTimer);
    // Pas plus d'une lecture toutes les 3 s : on attend juste le temps qu'il manque.
    const sinceLast = Date.now() - DMX_CATALOG.get().characterAt;
    delay = Math.max(delay, MIN_REFRESH_GAP - sinceLast + 50);
    refreshTimer = setTimeout(async () => {
      if (document.hidden || syncing) return;
      if (refreshing) return refreshCharacterSoon(1000);
      refreshing = true;
      try {
        const done = await DMX_CATALOG.refreshCharacter();
        if (done) {
          syncError = null;
          render();
        } else {
          refreshCharacterSoon(0); // lecture trop récente : on réessaie dès que possible
        }
      } catch (err) {
        syncError = err.message === "non connecté" ? "connecte-toi au jeu" : `erreur : ${err.message}`;
        render();
      } finally {
        refreshing = false;
      }
    }, delay);
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    refreshCharacterSoon(800);
  }, 700);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCharacterSoon(300);
  });

  document.addEventListener(
    "click",
    (e) => {
      if (panel.contains(e.target) || launcher.contains(e.target)) return;
      if (!e.target.closest?.("button, [role=button], a")) return;
      if (/^\/(personnage|deck|inventaire)/.test(location.pathname)) refreshCharacterSoon(1500);
    },
    true
  );

  // Rafraîchit le « il y a … » de la barre d'état.
  setInterval(() => {
    if (settings.visible && !document.hidden) renderStatus(state());
  }, 30000);

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
    if (e.target.closest("[data-action=welcome]")) {
      settings.welcomed = true;
      save();
      render();
      return;
    }
    const doneKey = e.target.closest("[data-done]")?.dataset.done;
    if (doneKey) {
      settings.doneToday = { ...settings.doneToday, [doneKey]: today() };
      save();
      render();
      return;
    }
    const goTab = e.target.closest("[data-go-tab]")?.dataset.goTab;
    if (goTab) {
      settings.tab = goTab;
      save();
      render();
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
    render();
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

  // Déplacement : on tire l'en-tête (souris ou doigt). La position est retenue
  // et gardée dans l'écran ; double-clic sur l'en-tête pour revenir à la place d'origine.
  function placePanel() {
    if (!settings.pos) {
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "";
      return;
    }
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - 60);
    panel.style.left = `${Math.min(Math.max(0, settings.pos.left), maxLeft)}px`;
    panel.style.top = `${Math.min(Math.max(0, settings.pos.top), maxTop)}px`;
    panel.style.right = "auto";
  }

  const header = $(".dmx-header");
  header.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    header.setPointerCapture(e.pointerId);
    panel.classList.add("dmx-dragging");
    const move = (ev) => {
      settings.pos = { left: ev.clientX - dx, top: ev.clientY - dy };
      placePanel();
    };
    const up = () => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      panel.classList.remove("dmx-dragging");
      save();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
  });
  header.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    settings.pos = null;
    placePanel();
    save();
  });
  window.addEventListener("resize", placePanel);

  // Replier / déplier : le panneau se réduit à son en-tête.
  function applyCollapsed() {
    panel.classList.toggle("dmx-collapsed", settings.collapsed);
    const button = $(".dmx-collapse");
    button.setAttribute("aria-expanded", String(!settings.collapsed));
    button.title = button.ariaLabel = settings.collapsed ? "Déplier" : "Replier";
  }
  $(".dmx-collapse").addEventListener("click", () => {
    settings.collapsed = !settings.collapsed;
    applyCollapsed();
    save();
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
    applyCollapsed();
    placePanel();
    scan();
    sync(false);
  })();
})();
