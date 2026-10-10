// Calculs des recommandations, à partir des données lues dans le jeu (voir catalog.js).
// Aucune donnée de jeu n'est écrite en dur ici : seulement la façon de les interpréter.
var DMX_ADVISOR = (() => {
  // Codes d'élément utilisés par le jeu dans les effets de sorts (`el`) et lignes d'armes.
  const ELEMENTS = {
    terre: { label: "Terre", stat: "force", statLabel: "Force", dmg: "dommagesTerre", code: 1 },
    feu: { label: "Feu", stat: "intelligence", statLabel: "Intelligence", dmg: "dommagesFeu", code: 2 },
    eau: { label: "Eau", stat: "chance", statLabel: "Chance", dmg: "dommagesEau", code: 3 },
    air: { label: "Air", stat: "agilite", statLabel: "Agilité", dmg: "dommagesAir", code: 4 },
  };

  // Valeur d'un point de chaque stat, en "points de stat principale".
  // C'est une estimation à ajuster : 1 PA vaut beaucoup plus que 1 point de Vitalité.
  const WEIGHTS = {
    puissance: 1, dommages: 5, vitalite: 0.25, sagesse: 0.3,
    pa: 100, pm: 90, po: 30, critique: 8, dommagesCritiques: 3, invocations: 20,
    initiative: 0.05, prospection: 0.1, soins: 1, tacle: 4, fuite: 4,
    retraitPA: 3, retraitPM: 3, esquivePA: 2, esquivePM: 2, renvoi: 2, dommagesPoussee: 1,
    resPctNeutre: 6, resPctTerre: 6, resPctFeu: 6, resPctEau: 6, resPctAir: 6,
    resPctMelee: 6, resPctDistance: 6,
    resNeutre: 1, resTerre: 1, resFeu: 1, resEau: 1, resAir: 1, resCritiques: 1, resPoussee: 0.5,
  };

  function itemScore(item, elementKey) {
    const el = ELEMENTS[elementKey];
    const st = item.st || {};
    let score = 0;
    for (const [key, value] of Object.entries(st)) {
      if (key === el.stat) score += value;
      else if (key === el.dmg) score += value * 5;
      else score += value * (WEIGHTS[key] || 0);
    }
    // Armes : dégâts moyens des lignes dans l'élément.
    for (const line of item.w?.lines || []) {
      if (line.el === el.code) score += ((line.min + line.max) / 2) * 2;
    }
    return Math.round(score);
  }

  // Élément vers lequel l'équipement porté est orienté (stat principale + dommages de l'élément).
  function detectElement(equippedItems) {
    let best = null;
    let bestScore = 0;
    for (const [key, el] of Object.entries(ELEMENTS)) {
      const score = equippedItems.reduce(
        (sum, item) => sum + (item.st?.[el.stat] || 0) + 5 * (item.st?.[el.dmg] || 0),
        0
      );
      if (score > bestScore) {
        best = key;
        bestScore = score;
      }
    }
    return best;
  }

  // Coût du prochain point quand la stat (base) vaut `value` : `tiers` = [[à partir de, coût], ...].
  function pointCost(tiers, value) {
    let cost = tiers[0][1];
    for (const [from, c] of tiers) if (value >= from) cost = c;
    return cost;
  }

  // Combien de points de stat on obtient en dépensant `points` points de caractéristique.
  function buyPoints(row, points) {
    let value = row.base;
    let left = points;
    for (;;) {
      const cost = pointCost(row.tiers, value);
      if (cost > left) break;
      left -= cost;
      value += 1;
    }
    return { gain: value - row.base, newBase: value, left };
  }

  // Valeur d'un point de stat gagné, pour comparer les stats entre elles :
  // 1 point de stat principale (≈ +1 % de dégâts) vaut environ 2 PV.
  const POINT_VALUE = { main: 1, vitalite: 0.5 };

  // Répartit `points` points de caractéristique selon une stratégie :
  // - "optimal" : chaque point va là où il rapporte le plus (stat principale tant que son
  //   coût reste bas, puis Vitalité quand la stat principale devient trop chère) ;
  // - "element" : tout dans la stat de l'élément ; "vitalite" : tout en Vitalité ;
  // - "libre" : `custom` = { clé de stat: points à dépenser }.
  function planPoints(rows, points, strategy, elementKey, custom = {}) {
    const mainKey = ELEMENTS[elementKey].stat;
    const state = new Map(rows.map((r) => [r.key, { row: r, value: r.base, spent: 0 }]));
    let left = points;
    const buyOne = (key) => {
      const st = state.get(key);
      const cost = pointCost(st.row.tiers, st.value);
      if (cost > left) return false;
      left -= cost;
      st.spent += cost;
      st.value += 1;
      return true;
    };

    if (strategy === "libre") {
      for (const [key, wanted] of Object.entries(custom)) {
        const st = state.get(key);
        if (!st) continue;
        let budget = Math.max(0, Math.floor(Number(wanted) || 0));
        for (;;) {
          const cost = pointCost(st.row.tiers, st.value);
          if (cost > budget || !buyOne(key)) break;
          budget -= cost;
        }
      }
    } else if (strategy === "element" || strategy === "vitalite") {
      const key = strategy === "vitalite" ? "vitalite" : mainKey;
      if (state.has(key)) while (buyOne(key));
    } else {
      const candidates = [mainKey, "vitalite"].filter((k) => state.has(k));
      for (;;) {
        let best = null;
        let bestRatio = 0;
        for (const key of candidates) {
          const st = state.get(key);
          const cost = pointCost(st.row.tiers, st.value);
          if (cost > left) continue;
          const ratio = (key === mainKey ? POINT_VALUE.main : POINT_VALUE.vitalite) / cost;
          if (ratio > bestRatio) {
            best = key;
            bestRatio = ratio;
          }
        }
        if (!best) break;
        buyOne(best);
      }
    }

    const alloc = [...state.values()]
      .filter((st) => st.spent > 0)
      .map((st) => ({ row: st.row, spent: st.spent, gain: st.value - st.row.base, newBase: st.value }))
      .sort((a, b) => b.spent - a.spent);
    // Points déjà placés dans les stats des autres éléments : inutiles pour ce build.
    const wasted = Object.entries(ELEMENTS)
      .filter(([key, el]) => key !== elementKey && state.get(el.stat)?.row.base > 0)
      .map(([, el]) => state.get(el.stat).row);
    return { alloc, left, wasted };
  }

  // Objets possédés qui feraient mieux que ce qui est porté, emplacement par emplacement.
  // Retourne une liste de { label, from (objet remplacé ou null si vide), to, gain }.
  function gearUpgrades({ items, slots, ownedIds, level, elementKey }) {
    const groups = new Map();
    for (const s of slots) {
      // Emplacements numérotés (anneau1, anneau2...) : même type d'objet.
      const type = s.item?.s || s.slot.replace(/\d+$/, "");
      if (!groups.has(type)) groups.set(type, { label: s.label, worn: [], count: 0 });
      const g = groups.get(type);
      g.count += 1;
      if (s.item) g.worn.push(s.item);
    }
    const score = (item) => itemScore(item, elementKey);
    const upgrades = [];
    for (const [type, g] of groups) {
      const wornIds = new Set(g.worn.map((i) => i.id));
      const candidates = items
        .filter((i) => i.s === type && ownedIds.has(i.id) && !wornIds.has(i.id))
        .filter((i) => level == null || i.lvl <= level)
        .map((i) => ({ item: i, score: score(i) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
      // Emplacements vides d'abord, puis les objets portés du plus faible au plus fort.
      const places = [
        ...Array(g.count - g.worn.length).fill(null),
        ...g.worn.map((i) => ({ item: i, score: score(i) })).sort((a, b) => a.score - b.score),
      ];
      for (const place of places) {
        const best = candidates[0];
        if (!best || (place && best.score <= place.score)) break;
        candidates.shift();
        upgrades.push({
          label: g.label || type,
          from: place?.item || null,
          to: best.item,
          gain: best.score - (place?.score || 0),
        });
      }
    }
    return upgrades.sort((a, b) => b.gain - a.gain);
  }

  // Effets qui infligent des dégâts (même liste que le jeu), et effets de soutien.
  const DAMAGE_KINDS = ["dmg", "steal", "dmgCasterHp", "dmgLostHp", "detonate", "trap", "bomb", "poison", "summon"];
  const DECK_SIZE = 10;

  // Classe chaque sort de la classe : dégâts dans l'élément (dégâts moyens par PA),
  // soutien (sur soi / un allié) ou autre.
  // `usableCardIds` (page Deck du jeu) : si connu, seuls ces sorts sont proposés, car le jeu
  // refuse les autres à l'import d'un code de deck.
  function classifySpells({ cards, classId, level, elementKey, ownedCardIds, usableCardIds }) {
    const el = ELEMENTS[elementKey];
    const damage = [];
    const support = [];
    const other = [];
    for (const card of cards) {
      if (usableCardIds) {
        if (!usableCardIds.has(card.id)) continue;
      } else if (card.cls !== classId || (level != null && card.lvl > level)) {
        continue;
      }
      const owned = usableCardIds ? true : ownedCardIds ? ownedCardIds.has(card.id) : null;
      const eff = card.eff || [];
      const dmg = eff.filter(
        (e) => DAMAGE_KINDS.includes(e.k) && (e.el == null || e.el === el.code || e.el === "best")
      );
      if (dmg.length) {
        const avg = dmg.reduce((sum, e) => sum + ((e.min || 0) + (e.max ?? e.min ?? 0)) / 2, 0);
        damage.push({ card, owned, perAp: avg / Math.max(1, card.ap) });
      } else if (eff.some((e) => e.tgt === "self" || e.tgt === "ally")) {
        support.push({ card, owned });
      } else {
        other.push({ card, owned });
      }
    }
    // Sorts possédés d'abord, puis les plus rentables.
    const byValue = (a, b) => (b.owned !== false) - (a.owned !== false) || (b.perAp || 0) - (a.perAp || 0);
    damage.sort(byValue);
    support.sort(byValue);
    other.sort(byValue);
    return { damage, support, other };
  }

  function spellAdvice(args) {
    const { damage, support } = classifySpells(args);
    return { damage, support };
  }

  // Decks selon trois styles de jeu (taille donnée par le jeu, 10 par défaut).
  function buildDecks(args) {
    const size = args.deckSize || DECK_SIZE;
    const { damage, support, other } = classifySpells(args);
    const el = ELEMENTS[args.elementKey];
    const recipes = [
      { key: "degats", name: `Dégâts ${el.label}`, desc: "Le maximum de dégâts, un peu de soutien.", dmg: 7, sup: 3 },
      { key: "equilibre", name: "Équilibré", desc: "Dégâts, protection et sorts utilitaires.", dmg: 5, sup: 3, oth: 2 },
      { key: "survie", name: "Survie", desc: "Boucliers, soins et buffs pour tenir longtemps.", dmg: 4, sup: 6 },
    ];
    const decks = [];
    for (const r of recipes) {
      const picked = [
        ...damage.slice(0, r.dmg),
        ...support.slice(0, r.sup),
        ...other.slice(0, r.oth || 0),
      ];
      // Complète jusqu'à 10 avec les meilleurs sorts restants.
      const rest = [...damage, ...support, ...other].filter((x) => !picked.includes(x));
      while (picked.length < size && rest.length) picked.push(rest.shift());
      picked.splice(size);
      if (!picked.length) continue;
      const ids = picked.map((x) => x.card.id).join(",");
      if (decks.some((d) => d.cards.map((x) => x.card.id).join(",") === ids)) continue;
      decks.push({ ...r, cards: picked, size });
    }
    return decks;
  }

  // Vrai si le deck actif du joueur contient déjà tous les sorts de ce deck.
  function deckIsActive(deck, activeDeckIds) {
    if (!activeDeckIds?.length) return false;
    const active = new Set(activeDeckIds);
    return deck.cards.every((x) => active.has(x.card.id));
  }

  return { ELEMENTS, DECK_SIZE, deckIsActive, itemScore, detectElement, buyPoints, planPoints, gearUpgrades, spellAdvice, buildDecks };
})();
