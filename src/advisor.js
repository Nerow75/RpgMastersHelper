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

  function pointsAdvice(rows, pointsFree, elementKey) {
    const el = ELEMENTS[elementKey];
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    const main = byKey[el.stat];
    const advice = { main: null, vitalite: null, wasted: [] };
    if (main && pointsFree > 0) advice.main = { row: main, ...buyPoints(main, pointsFree) };
    if (byKey.vitalite && pointsFree > 0) {
      advice.vitalite = { row: byKey.vitalite, ...buyPoints(byKey.vitalite, pointsFree) };
    }
    // Points déjà placés dans les stats des autres éléments : inutiles pour ce build.
    for (const [key, other] of Object.entries(ELEMENTS)) {
      if (key !== elementKey && byKey[other.stat]?.base > 0) advice.wasted.push(byKey[other.stat]);
    }
    return advice;
  }

  // Pour chaque type d'emplacement : objet porté, meilleur objet possédé, meilleur objet à viser.
  function gearAdvice({ items, slots, ownedIds, level, elementKey }) {
    const usable = items.filter((i) => level == null || i.lvl <= level);
    const bySlot = new Map();
    for (const s of slots) {
      // Emplacements numérotés (anneau1, anneau2...) : même type d'objet.
      const type = s.item?.s || s.slot.replace(/\d+$/, "");
      if (!bySlot.has(type)) bySlot.set(type, { label: s.label, worn: [], count: 0 });
      const entry = bySlot.get(type);
      entry.count += 1;
      if (s.item) entry.worn.push(s.item);
    }
    const rows = [];
    for (const [type, { label, worn, count }] of bySlot) {
      const rank = (list) =>
        list
          .filter((i) => i.s === type)
          .map((i) => ({ item: i, score: itemScore(i, elementKey) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, count);
      const wornScored = worn.map((i) => ({ item: i, score: itemScore(i, elementKey) }));
      const wornIds = new Set(worn.map((i) => i.id));
      const worst = Math.min(...wornScored.map((w) => w.score));
      // Emplacement pas plein : n'importe quel objet utile vaut mieux que rien.
      const threshold = worn.length < count ? 0 : worst;
      const better = (list) => list.filter((c) => !wornIds.has(c.item.id) && c.score > threshold);
      rows.push({
        type,
        label: label || type,
        worn: wornScored,
        owned: ownedIds ? better(rank(usable.filter((i) => ownedIds.has(i.id)))) : [],
        target: better(rank(usable.filter((i) => !ownedIds?.has(i.id)))),
      });
    }
    return rows;
  }

  // Sorts de la classe : dégâts dans l'élément (classés par dégâts moyens par PA) et soutien.
  function spellAdvice({ cards, classId, level, elementKey, ownedCardIds }) {
    const el = ELEMENTS[elementKey];
    const mine = cards.filter((c) => c.cls === classId && (level == null || c.lvl <= level));
    const damage = [];
    const support = [];
    for (const card of mine) {
      const dmg = (card.eff || []).filter(
        (e) => ["dmg", "steal", "summon"].includes(e.k) && (e.el === el.code || e.el === "best")
      );
      const owned = ownedCardIds ? ownedCardIds.has(card.id) : null;
      if (dmg.length) {
        const avg = dmg.reduce((s, e) => s + (e.min + e.max) / 2, 0);
        damage.push({ card, owned, perAp: avg / Math.max(1, card.ap) });
      } else if ((card.eff || []).some((e) => e.tgt === "self" || e.tgt === "ally")) {
        support.push({ card, owned });
      }
    }
    damage.sort((a, b) => b.perAp - a.perAp);
    return { damage, support };
  }

  return { ELEMENTS, itemScore, detectElement, buyPoints, pointsAdvice, gearAdvice, spellAdvice };
})();
