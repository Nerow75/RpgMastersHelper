// Menu déroulant aux couleurs du site (les <select> natifs ne se stylisent pas vraiment).
// Utilisation : const dd = DMX_DROPDOWN.create(élément, (valeur) => ...);
//               dd.set([{ value, label, icon?, color? }, ...], valeurSélectionnée);
var DMX_DROPDOWN = (() => {
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Icône (image) ou pastille de couleur devant le libellé.
  function decoration(option) {
    if (option.icon) return `<img class="dmx-dd-icon" src="${escapeHtml(option.icon)}" alt="">`;
    if (option.color) return `<span class="dmx-dd-dot" style="--dot:${escapeHtml(option.color)}"></span>`;
    return "";
  }

  function create(root, onChange) {
    root.classList.add("dmx-dd");
    root.innerHTML = `
      <button type="button" class="dmx-dd-button" aria-haspopup="listbox" aria-expanded="false"></button>
      <ul class="dmx-dd-list" role="listbox" tabindex="-1" hidden></ul>`;
    const button = root.querySelector(".dmx-dd-button");
    const list = root.querySelector(".dmx-dd-list");
    let options = [];
    let value = null;
    let active = 0; // option survolée au clavier

    const isOpen = () => !list.hidden;

    function paintActive() {
      list.querySelectorAll("[role=option]").forEach((li, i) => li.classList.toggle("active", i === active));
      list.children[active]?.scrollIntoView({ block: "nearest" });
    }

    function open() {
      list.hidden = false;
      button.setAttribute("aria-expanded", "true");
      active = Math.max(0, options.findIndex((o) => o.value === value));
      paintActive();
      list.focus();
    }

    function close(focusButton = false) {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (focusButton) button.focus();
    }

    function choose(index) {
      const option = options[index];
      close(true);
      if (option && option.value !== value) onChange(option.value);
    }

    button.addEventListener("click", () => (isOpen() ? close() : open()));
    list.addEventListener("click", (e) => {
      const li = e.target.closest("[role=option]");
      if (li) choose(Number(li.dataset.index));
    });
    list.addEventListener("mousemove", (e) => {
      const li = e.target.closest("[role=option]");
      if (li && Number(li.dataset.index) !== active) {
        active = Number(li.dataset.index);
        paintActive();
      }
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") active = Math.min(options.length - 1, active + 1);
      else if (e.key === "ArrowUp") active = Math.max(0, active - 1);
      else if (e.key === "Home") active = 0;
      else if (e.key === "End") active = options.length - 1;
      else if (e.key === "Enter" || e.key === " ") return e.preventDefault(), choose(active);
      else if (e.key === "Escape" || e.key === "Tab") return close(e.key === "Escape");
      else return;
      e.preventDefault();
      paintActive();
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        open();
      }
    });
    // Clic ailleurs : on ferme.
    document.addEventListener("mousedown", (e) => {
      if (isOpen() && !root.contains(e.target)) close();
    });

    return {
      set(newOptions, newValue) {
        options = newOptions;
        value = newValue;
        const current = options.find((o) => o.value === value) || options[0];
        button.innerHTML = `${current ? decoration(current) : ""}
          <span class="dmx-dd-label">${current ? escapeHtml(current.label) : ""}</span>
          <svg class="dmx-dd-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"></path></svg>`;
        list.innerHTML = options
          .map((o, i) => `<li role="option" data-index="${i}" aria-selected="${o.value === value}"
              class="${o.separator ? "dmx-dd-sep" : ""}">
              ${decoration(o)}<span>${escapeHtml(o.label)}</span>
              ${o.hint ? `<span class="dmx-dd-hint">${escapeHtml(o.hint)}</span>` : ""}</li>`)
          .join("");
        if (isOpen()) paintActive();
      },
    };
  }

  return { create };
})();
