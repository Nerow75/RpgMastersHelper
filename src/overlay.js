// Panneau de recommandations injecté par-dessus la page du jeu.
// Il ne lit ni ne modifie rien dans le jeu : il affiche seulement des conseils
// à partir de la classe et de l'élément choisis par le joueur (données dans data/builds.js).
(() => {
  if (window.__dmxLoaded) return;
  window.__dmxLoaded = true;

  const data = DMX_DATA;
  const STORAGE_KEY = "dmx-settings";
  let settings = { classKey: "iop", elementKey: "terre", visible: true };

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

  chrome.storage.local.get(STORAGE_KEY, (stored) => {
    const saved = stored[STORAGE_KEY];
    if (saved && data.classes[saved.classKey]) settings = { ...settings, ...saved };
    classSelect.value = settings.classKey;
    fillElements();
    render();
    applyVisibility();
    document.body.appendChild(panel);
  });
})();
