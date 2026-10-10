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

  // Fusion (règles du jeu) : 3 copies identiques pour monter d'un niveau ; chaque niveau
  // augmente les stats de l'objet de ce pourcentage, sauf PA, PM, PO et invocations.
  const FUSION = { copies: 3, bonusPct: [0, 10, 20, 25, 30, 35, 40, 45], excluded: ["pa", "pm", "po", "invocations"], max: 7, dofusMax: 4 };

  function fusedStats(item, fusion = 0) {
    const pct = FUSION.bonusPct[fusion] || 0;
    if (!pct) return item.st || {};
    const st = {};
    for (const [k, v] of Object.entries(item.st || {})) {
      st[k] = FUSION.excluded.includes(k) ? v : Math.round(v * (1 + pct / 100));
    }
    return st;
  }

  function statsScore(st, elementKey) {
    const el = ELEMENTS[elementKey];
    let score = 0;
    for (const [key, value] of Object.entries(st || {})) {
      if (key === el.stat) score += value;
      else if (key === el.dmg) score += value * 5;
      else score += value * (WEIGHTS[key] || 0);
    }
    return score;
  }

  function itemScore(item, elementKey, fusion = 0) {
    let score = statsScore(fusedStats(item, fusion), elementKey);
    // Armes : dégâts moyens des lignes dans l'élément.
    for (const line of item.w?.lines || []) {
      if (line.el === ELEMENTS[elementKey].code) score += ((line.min + line.max) / 2) * 2;
    }
    return Math.round(score);
  }

  // Bonus de panoplie actifs pour une liste d'objets portés : pour chaque panoplie, le palier
  // le plus haut atteint (nombre de pièces différentes portées).
  function setBonusScore(sets, wornIds, elementKey) {
    const worn = new Set(wornIds);
    let score = 0;
    for (const set of sets) {
      const count = set.pieces.filter((id) => worn.has(id)).length;
      const active = set.bonuses.filter((b) => b.pieces <= count).sort((a, b) => b.pieces - a.pieces)[0];
      if (active) score += statsScore(active.stats, elementKey);
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

  // Type d'objet d'un emplacement (anneau1, anneau2... -> anneau).
  const slotType = (slot) => slot.item?.s || slot.slot.replace(/\d+$/, "");

  // Objets de l'inventaire qui feraient mieux que ce qui est porté, bonus de panoplie compris.
  // `slots` = emplacements de la fiche ({ slot, label, item, fusion }), dans l'ordre du jeu.
  // Retourne [{ label, slotIndex, from: { item, fusion } | null, to: { item, fusion }, gain }].
  function gearUpgrades({ slots, inventory, itemsById, sets = [], level, elementKey }) {
    if (!inventory) return [];
    const score = (x) => (x ? itemScore(x.item, elementKey, x.fusion) : 0);
    // Équipement de travail : on applique les améliorations au fur et à mesure.
    const current = slots.map((s) => (s.item ? { item: s.item, fusion: s.fusion || 0 } : null));
    const stock = inventory
      .filter((e) => itemsById[e.id] && (level == null || itemsById[e.id].lvl <= level))
      .map((e) => ({ item: itemsById[e.id], fusion: e.fusion, left: e.qty }));
    const wornIds = () => current.filter(Boolean).map((x) => x.item.id);
    const upgrades = [];

    // Emplacements vides d'abord, puis les objets portés du moins bon au meilleur.
    const order = slots
      .map((s, index) => ({ index, type: slotType(s), label: s.label || slotType(s) }))
      .sort((a, b) => (current[a.index] ? 1 : 0) - (current[b.index] ? 1 : 0) || score(current[a.index]) - score(current[b.index]));

    for (const place of order) {
      const before = current[place.index];
      const baseSets = setBonusScore(sets, wornIds(), elementKey);
      let best = null;
      for (const cand of stock) {
        if (cand.left < 1 || cand.item.s !== place.type) continue;
        // Un même objet ne se porte qu'une fois (deux anneaux identiques : non).
        if (current.some((x, i) => x && i !== place.index && x.item.id === cand.item.id)) continue;
        current[place.index] = cand;
        const gain = score(cand) - score(before) + setBonusScore(sets, wornIds(), elementKey) - baseSets;
        current[place.index] = before;
        if (gain > 0 && (!best || gain > best.gain)) best = { cand, gain };
      }
      if (!best) continue;
      current[place.index] = best.cand;
      best.cand.left -= 1;
      if (before) stock.push({ ...before, left: 1 }); // l'objet retiré retourne dans l'inventaire
      upgrades.push({
        label: place.label,
        slotIndex: place.index,
        from: before,
        to: { item: best.cand.item, fusion: best.cand.fusion },
        gain: Math.round(best.gain),
      });
    }
    return upgrades.sort((a, b) => b.gain - a.gain);
  }

  // Équipement obtenu en appliquant des améliorations (pour fabriquer un code d'équipement).
  function applyUpgrades(slots, upgrades) {
    const next = slots.map((s) => ({ item: s.item, fusion: s.fusion || 0 }));
    for (const u of upgrades) next[u.slotIndex] = { item: u.to.item, fusion: u.to.fusion };
    return next;
  }

  // Panoplies dont le joueur porte ou possède des pièces : palier actif, prochain palier,
  // et pièces déjà dans l'inventaire qui permettraient de l'atteindre.
  function setsAdvice({ sets, slots, inventory, itemsById }) {
    const worn = new Set(slots.filter((s) => s.item).map((s) => s.item.id));
    const owned = new Set((inventory || []).map((e) => e.id));
    return sets
      .map((set) => {
        const wornCount = set.pieces.filter((id) => worn.has(id)).length;
        const ownedPieces = set.pieces.filter((id) => owned.has(id) && !worn.has(id));
        const sorted = [...set.bonuses].sort((a, b) => a.pieces - b.pieces);
        return {
          set,
          wornCount,
          active: sorted.filter((b) => b.pieces <= wornCount).pop() || null,
          next: sorted.find((b) => b.pieces > wornCount) || null,
          ownedPieces: ownedPieces.map((id) => itemsById[id]).filter(Boolean),
        };
      })
      .filter((x) => x.wornCount > 0 || x.ownedPieces.length >= 2)
      .sort((a, b) => b.wornCount - a.wornCount || b.ownedPieces.length - a.ownedPieces.length);
  }

  // Ménage de l'inventaire : fusions possibles, et objets qui ne servent pas ce build
  // (moins bons que ce qui est porté, hors panoplie portée, non verrouillés).
  function inventoryCleanup({ inventory, slots, sets = [], itemsById, level, elementKey }) {
    if (!inventory) return { fusable: [], useless: [] };
    const fusable = [];
    const useless = [];
    const wornByType = new Map();
    for (const s of slots) {
      if (!s.item) continue;
      const t = slotType(s);
      const sc = itemScore(s.item, elementKey, s.fusion || 0);
      wornByType.set(t, Math.min(wornByType.get(t) ?? Infinity, sc));
    }
    const worn = new Set(slots.filter((s) => s.item).map((s) => s.item.id));
    const wornSets = new Set(sets.filter((set) => set.pieces.some((id) => worn.has(id))).map((set) => set.id));
    const inWornSet = (id) => sets.some((set) => wornSets.has(set.id) && set.pieces.includes(id));
    for (const e of inventory) {
      const item = itemsById[e.id];
      if (!item || item.s === "parchemin") continue;
      const wornScore = wornByType.get(item.s);
      if (
        !e.locked && wornScore != null && (level == null || item.lvl <= level) &&
        !inWornSet(item.id) && itemScore(item, elementKey, e.fusion) < wornScore
      ) {
        useless.push({ item, fusion: e.fusion, qty: e.qty });
        continue; // pas la peine de fusionner un objet qui ne sert pas ce build
      }
      const cap = item.s === "dofus" ? FUSION.dofusMax : FUSION.max;
      if (e.qty >= FUSION.copies && e.fusion < cap) {
        fusable.push({ item, fusion: e.fusion, qty: e.qty, times: Math.floor(e.qty / FUSION.copies) });
      }
    }
    fusable.sort((a, b) => b.qty - a.qty);
    useless.sort((a, b) => b.qty - a.qty || a.item.lvl - b.item.lvl);
    return { fusable, useless };
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

  return { ELEMENTS, DECK_SIZE, FUSION, deckIsActive, itemScore, fusedStats, setBonusScore, applyUpgrades, setsAdvice, inventoryCleanup, detectElement, buyPoints, planPoints, gearUpgrades, spellAdvice, buildDecks };
})();
