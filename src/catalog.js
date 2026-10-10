// Synchronisation des données du jeu : l'extension télécharge les pages (avec la session du
// joueur), en extrait objets, monstres, zones, sorts, classes et personnage, et les garde en
// mémoire. Si le jeu change une valeur, la prochaine synchronisation la récupère.
var DMX_CATALOG = (() => {
  const KEY = "dmx-catalog";
  const CATALOG_MAX_AGE = 24 * 60 * 60 * 1000; // objets, monstres, sorts : une fois par jour
  const CHARACTER_MAX_AGE = 10 * 60 * 1000; // personnage : toutes les 10 minutes

  // `n` demande au site d'afficher plus d'objets d'un coup (comme le bouton « Voir plus »).
  const PAGES = {
    bestiary: "/bestiaire",
    bestiaryItems: "/bestiaire?onglet=objets&n=5000",
    collectionItems: "/collection?onglet=objets&n=5000",
    spells: "/collection?onglet=sorts",
    character: "/personnage",
  };

  const empty = () => ({
    syncedAt: 0,
    characterAt: 0,
    items: {},
    monsters: [],
    zones: {},
    cards: {},
    classes: [],
    ownedItemIds: [],
    ownedCardIds: [],
    character: null,
    syncErrors: [],
  });

  let catalog = empty();

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    catalog = { ...empty(), ...stored[KEY] };
    return catalog;
  }

  function save() {
    return chrome.storage.local.set({ [KEY]: catalog });
  }

  function addItems(list) {
    for (const item of list) if (item.id != null) catalog.items[item.id] = item;
  }

  // Objets marqués comme possédés par la page : `{ item | card, own: true }`.
  function ownedIds(values, key) {
    const ids = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if (v[key]?.id != null && v.own === true) ids.add(v[key].id);
        if (v.id != null && v.own === true && v.n) ids.add(v.id);
        Object.values(v).forEach(walk);
      }
    };
    values.forEach(walk);
    return ids;
  }

  function records(values, ...keys) {
    const groups = DMX_GAME.findRecords(values);
    return keys.flatMap((k) => [...(groups[k]?.values() || [])]);
  }

  async function syncCharacter() {
    const values = await DMX_GAME.fetchPageData(PAGES.character);
    const fields = DMX_GAME.findFields(values, ["slots", "rows", "pointsFree", "inventory", "prestige"]);
    // Menu profil de la barre de navigation : { name, level, kamas, energy, ... }.
    const profile = DMX_GAME.findObject(values, ["level", "kamas"]);
    // Bloc de changement de classe : { classes, current, cost, ... } -> classe actuelle.
    const classBlock = DMX_GAME.findObject(values, ["classes", "current"]);
    const current = classBlock?.current;

    const inventory = [...Object.values(DMX_GAME.findRecords(fields.inventory ?? []))]
      .flatMap((group) => [...group.values()]);
    addItems(inventory);

    catalog.character = {
      slots: Array.isArray(fields.slots) ? fields.slots : [],
      rows: Array.isArray(fields.rows) ? fields.rows : [],
      pointsFree: typeof fields.pointsFree === "number" ? fields.pointsFree : null,
      level: typeof profile?.level === "number" ? profile.level : null,
      prestige: typeof fields.prestige === "number" ? fields.prestige : null,
      classId: typeof current === "number" ? current : current?.id ?? null,
      inventoryIds: inventory.map((i) => i.id),
    };
    const classes = classBlock?.classes ?? DMX_GAME.findFields(values, ["classes"]).classes;
    if (Array.isArray(classes)) {
      catalog.classes = classes.map(({ id, n, img, role, passive }) => ({ id, n, img, role, passive }));
      for (const cls of classes) for (const card of cls.cards || []) catalog.cards[card.id] = card;
    }
    addItems(catalog.character.slots.map((s) => s.item).filter(Boolean));
    catalog.characterAt = Date.now();
  }

  // Chaque page est lue indépendamment : si l'une échoue, les autres sont gardées.
  async function syncCatalog() {
    const errors = [];
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (err) {
        if (err.message === "non connecté") throw err;
        errors.push(name);
      }
    };

    await step("bestiaire", async () => {
      const bestiary = await DMX_GAME.fetchPageData(PAGES.bestiary);
      catalog.monsters = records(bestiary, "monsters");
      addItems(records(bestiary, "items", "item"));
      const zones = DMX_GAME.findFields(bestiary, ["zones"]).zones;
      if (Array.isArray(zones)) catalog.zones = Object.fromEntries(zones.map((z) => [z.id, z]));
    });
    await step("objets", async () => {
      addItems(records(await DMX_GAME.fetchPageData(PAGES.bestiaryItems), "item", "items"));
    });
    await step("collection", async () => {
      const values = await DMX_GAME.fetchPageData(PAGES.collectionItems);
      addItems(records(values, "item", "items"));
      const owned = ownedIds(values, "item");
      if (owned.size) catalog.ownedItemIds = [...owned];
    });
    await step("sorts", async () => {
      const spells = await DMX_GAME.fetchPageData(PAGES.spells);
      for (const card of records(spells, "card", "cards")) catalog.cards[card.id] = card;
      const ownedCards = ownedIds(spells, "card");
      if (ownedCards.size) catalog.ownedCardIds = [...ownedCards];
    });

    catalog.syncErrors = errors;
    catalog.syncedAt = Date.now();
  }

  // Met à jour ce qui est trop ancien (ou tout, si `force`).
  async function refresh({ force = false } = {}) {
    const now = Date.now();
    if (force || now - catalog.syncedAt > CATALOG_MAX_AGE) await syncCatalog();
    if (force || now - catalog.characterAt > CHARACTER_MAX_AGE) await syncCharacter();
    await save();
    return catalog;
  }

  return { load, refresh, get: () => catalog };
})();
