// Synchronisation des données du jeu : l'extension télécharge les pages (avec la session du
// joueur), en extrait objets, monstres, zones, sorts, classes et personnage, et les garde en
// mémoire. Si le jeu change une valeur, la prochaine synchronisation la récupère.
var DMX_CATALOG = (() => {
  const KEY = "dmx-catalog";
  const CATALOG_MAX_AGE = 24 * 60 * 60 * 1000; // objets, monstres, sorts : une fois par jour
  // Personnage et deck : relus quand le joueur agit (voir overlay.js), au plus toutes les 3 s,
  // et au moins toutes les 10 min.
  const CHARACTER_MIN_INTERVAL = 3 * 1000;
  const CHARACTER_MAX_AGE = 10 * 60 * 1000;

  // `n` demande au site d'afficher plus d'objets d'un coup (comme le bouton « Voir plus »).
  const PAGES = {
    bestiary: "/bestiaire",
    bestiaryItems: "/bestiaire?onglet=objets&n=5000",
    collectionItems: "/collection?onglet=objets&n=5000",
    spells: "/collection?onglet=sorts",
    character: "/personnage",
    deck: "/deck",
    inventory: "/inventaire",
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
    // (le champ `inventory` de cette page n'est qu'un compteur : l'inventaire vient de /inventaire)
    const fields = DMX_GAME.findFields(values, ["slots", "rows", "pointsFree", "prestige", "choices"]);
    // Menu profil de la barre de navigation : { name, level, kamas, energy, ... }.
    const profile = DMX_GAME.findObject(values, ["level", "kamas"]);
    // Bloc de changement de classe : { classes, current, cost, ... } -> classe actuelle.
    const classBlock = DMX_GAME.findObject(values, ["classes", "current"]);
    const current = classBlock?.current;


    catalog.character = {
      slots: Array.isArray(fields.slots) ? fields.slots : [],
      rows: Array.isArray(fields.rows) ? fields.rows : [],
      pointsFree: typeof fields.pointsFree === "number" ? fields.pointsFree : null,
      level: typeof profile?.level === "number" ? profile.level : null,
      name: typeof profile?.name === "string" ? profile.name : null,
      kamas: typeof profile?.kamas === "number" ? profile.kamas : null,
      energy: readEnergy(profile?.energy),
      prestige: typeof fields.prestige === "number" ? fields.prestige : null,
      classId: typeof current === "number" ? current : current?.id ?? null,
      // Codes d'équipement proposés par le site (« Équipement à partager ») : { key, label, count, code }.
      gearCodes: Array.isArray(fields.choices)
        ? fields.choices.filter((c) => typeof c?.code === "string").map(({ key, label, count, code }) => ({ key, label, count, code }))
        : [],
    };
    const classes = classBlock?.classes ?? DMX_GAME.findFields(values, ["classes"]).classes;
    if (Array.isArray(classes)) {
      catalog.classes = classes.map(({ id, n, img, role, passive }) => ({ id, n, img, role, passive }));
      for (const cls of classes) for (const card of cls.cards || []) catalog.cards[card.id] = card;
    }
    addItems(catalog.character.slots.map((s) => s.item).filter(Boolean));
    catalog.character.deck = await syncDeck();
    Object.assign(catalog.character, await syncInventory());
    // La page Deck donne la classe de façon sûre (breedId) ; sinon, celle de la fiche.
    catalog.character.classId = catalog.character.deck?.classId ?? catalog.character.classId;
    catalog.characterAt = Date.now();
  }

  // Page Inventaire : props du composant InventoryView { entries, slots, sets, ... }.
  // entries = [{ item, fusion, qty, locked }] (objets portés non compris) ;
  // sets = panoplies [{ id, n, pieces: [objets], bonuses: [{ pieces, stats }] }].
  async function syncInventory() {
    try {
      const values = await DMX_GAME.fetchPageData(PAGES.inventory);
      const props = DMX_GAME.findObject(values, ["entries", "sets"]) ?? DMX_GAME.findObject(values, ["entries"]);
      if (!props || !Array.isArray(props.entries)) return { inventory: null, sets: [] };
      const inventory = [];
      for (const entry of props.entries) {
        const item = entry?.item;
        if (item?.id == null) continue;
        catalog.items[item.id] = item;
        inventory.push({
          id: item.id,
          fusion: Number(entry.fusion) || 0,
          qty: Number(entry.qty) || 1,
          locked: !!entry.locked,
        });
      }
      const sets = (Array.isArray(props.sets) ? props.sets : []).map((set) => {
        const pieces = (set.pieces || []).map((p) => (typeof p === "number" ? p : p?.id)).filter(Number.isInteger);
        for (const p of set.pieces || []) if (p?.id != null && p.n) catalog.items[p.id] ??= p;
        return {
          id: set.id,
          n: set.n,
          pieces,
          bonuses: (set.bonuses || []).map((b) => ({ pieces: b.pieces, stats: b.stats || b.st || {} })),
        };
      });
      return { inventory, sets };
    } catch (err) {
      if (err.message === "non connecté") throw err;
      return { inventory: null, sets: [] }; // page Inventaire illisible : on garde le reste
    }
  }

  // Énergie du menu profil : { value, max, nextAt, periodSec }. `nextAt` = moment du prochain
  // point d'énergie (date ISO ou horodatage) ; `periodSec` = secondes entre deux points.
  function readEnergy(energy) {
    if (!energy || typeof energy.value !== "number") return null;
    let nextAt = null;
    if (typeof energy.nextAt === "number") nextAt = energy.nextAt < 1e12 ? energy.nextAt * 1000 : energy.nextAt;
    else if (typeof energy.nextAt === "string") nextAt = Date.parse(energy.nextAt) || null;
    return {
      value: energy.value,
      max: typeof energy.max === "number" ? energy.max : null,
      nextAt,
      periodMs: typeof energy.periodSec === "number" ? energy.periodSec * 1000 : null,
    };
  }

  // Page Deck : props du composant DeckBuilder { collection, initialDecks, initialActive,
  // breedId, deckSize }. `collection` = les sorts que le personnage peut mettre dans un deck,
  // sous la forme { key: "id:…", card }. Les decks sont des listes de ces clés.
  async function syncDeck() {
    try {
      const values = await DMX_GAME.fetchPageData(PAGES.deck);
      const props = DMX_GAME.findObject(values, ["collection", "initialDecks"]);
      if (!props || !Array.isArray(props.collection)) return null;
      const idOf = (key) => Number(String(key).split(":")[0]);
      const usableCardIds = [];
      for (const entry of props.collection) {
        const card = entry?.card;
        if (card?.id != null) catalog.cards[card.id] = card;
        const id = card?.id ?? idOf(entry?.key);
        if (Number.isInteger(id)) usableCardIds.push(id);
      }
      const decks = Array.isArray(props.initialDecks) ? props.initialDecks : [];
      const active = Number.isInteger(props.initialActive) ? props.initialActive : 0;
      return {
        usableCardIds,
        activeDeckIds: (decks[active] || []).map(idOf).filter(Number.isInteger),
        activeIndex: active,
        size: Number.isInteger(props.deckSize) ? props.deckSize : null,
        classId: Number.isInteger(props.breedId) ? props.breedId : null,
      };
    } catch (err) {
      if (err.message === "non connecté") throw err;
      return null; // page Deck illisible : on garde le reste de la fiche
    }
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

  // Relit seulement le personnage et le deck (après une action du joueur).
  // Retourne false si la dernière lecture est trop récente.
  async function refreshCharacter() {
    if (Date.now() - catalog.characterAt < CHARACTER_MIN_INTERVAL) return false;
    await syncCharacter();
    await save();
    return true;
  }

  return { load, refresh, refreshCharacter, get: () => catalog };
})();
