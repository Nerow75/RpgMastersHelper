// Base de données des recommandations.
// ⚠️ Ces valeurs sont des EXEMPLES génériques inspirés de Dofus : adapte-les aux règles réelles
// de Dofus Masters (coûts des points, équipements disponibles, sorts, decks...).
// Tout le panneau est généré à partir de ce fichier : pour enrichir l'extension, il suffit de l'éditer.

var DMX_DATA = {
  elements: {
    terre: {
      label: "Terre (Force)",
      stat: "Force",
      points: [
        "Tous les points de caractéristique en Force.",
        "Si le jeu autorise la Vitalité 1 pour 1, garde-la pour plus tard une fois la Force à un palier confortable.",
      ],
      gear: [
        "Priorité : PA / PM, puis Force et dommages terre.",
        "Cherche des résistances fixes et % pour ne pas être fragile.",
        "Le Tacle est souvent un bon bonus pour un build terre au corps à corps.",
      ],
      strengths: ["Dégâts stables", "Bonne tenue au corps à corps", "Souvent bon en Tacle / Pods"],
    },
    feu: {
      label: "Feu (Intelligence)",
      stat: "Intelligence",
      points: [
        "Tous les points de caractéristique en Intelligence.",
        "L'Intelligence augmente aussi les soins : intéressant pour les classes soigneuses.",
      ],
      gear: [
        "Priorité : PA / PM / Portée, puis Intelligence et dommages feu.",
        "Les bonus Soins sont un plus si ta classe soigne.",
      ],
      strengths: ["Gros dégâts", "Bonus aux soins", "Polyvalent distance / mêlée"],
    },
    eau: {
      label: "Eau (Chance)",
      stat: "Chance",
      points: ["Tous les points de caractéristique en Chance."],
      gear: [
        "Priorité : PA / PM, puis Chance et dommages eau.",
        "La Prospection est un bonus pour farmer.",
      ],
      strengths: ["Souvent du vol de vie / retrait PM selon la classe", "Prospection (farm)"],
    },
    air: {
      label: "Air (Agilité)",
      stat: "Agilité",
      points: ["Tous les points de caractéristique en Agilité."],
      gear: [
        "Priorité : PA / PM, puis Agilité et dommages air.",
        "Esquive et Fuite pour sortir des corps à corps.",
      ],
      strengths: ["Mobilité", "Fuite / Esquive", "Bons coups critiques"],
    },
  },

  // Le rôle de chaque classe et des exemples de decks de sorts.
  // `decks` : clé = élément, valeur = liste de decks { name, spells: [...], tip }.
  // Les sorts sont laissés vides : remplis-les avec les vrais noms des sorts de Dofus Masters.
  classes: {
    iop: { label: "Iop", role: "Dégâts au corps à corps", elements: ["terre", "feu", "air", "eau"], decks: {} },
    cra: { label: "Cra", role: "Dégâts à distance", elements: ["feu", "air", "eau", "terre"], decks: {} },
    eniripsa: { label: "Eniripsa", role: "Soin / soutien", elements: ["feu", "eau", "air"], decks: {} },
    feca: { label: "Féca", role: "Protection / boucliers", elements: ["feu", "terre", "eau"], decks: {} },
    sacrieur: { label: "Sacrieur", role: "Tank / dégâts qui montent avec les PV perdus", elements: ["terre", "feu", "air"], decks: {} },
    osamodas: { label: "Osamodas", role: "Invocations", elements: ["feu", "terre", "eau", "air"], decks: {} },
    enutrof: { label: "Enutrof", role: "Retrait de PM / prospection", elements: ["eau", "terre", "feu"], decks: {} },
    sram: { label: "Sram", role: "Pièges / invisibilité", elements: ["air", "terre", "eau"], decks: {} },
    xelor: { label: "Xélor", role: "Retrait de PA / manipulation du temps", elements: ["feu", "eau", "air"], decks: {} },
    ecaflip: { label: "Ecaflip", role: "Dégâts aléatoires / critiques", elements: ["terre", "feu", "air", "eau"], decks: {} },
    sadida: { label: "Sadida", role: "Poupées / états", elements: ["terre", "eau", "air"], decks: {} },
    pandawa: { label: "Pandawa", role: "Placement (porter / lancer)", elements: ["terre", "feu", "eau"], decks: {} },
    roublard: { label: "Roublard", role: "Bombes / zone", elements: ["feu", "air", "terre"], decks: {} },
    zobal: { label: "Zobal", role: "Masques / soutien", elements: ["air", "terre", "eau"], decks: {} },
    steamer: { label: "Steamer", role: "Tourelles / boucliers", elements: ["eau", "terre", "feu"], decks: {} },
    eliotrope: { label: "Eliotrope", role: "Portails / dégâts à distance", elements: ["eau", "feu", "air"], decks: {} },
    huppermage: { label: "Huppermage", role: "Combinaisons de runes élémentaires", elements: ["feu", "eau", "air", "terre"], decks: {} },
    ouginak: { label: "Ouginak", role: "Traque de proie / mêlée", elements: ["terre", "eau", "air"], decks: {} },
    forgelance: { label: "Forgelance", role: "Lance / zone", elements: ["terre", "feu", "air"], decks: {} },
  },

  // Exemple de deck rempli, pour montrer le format attendu.
  // (Supprime-le ou remplace-le par de vrais sorts.)
  _exampleDeck: {
    name: "Exemple : deck dégâts mono-cible",
    spells: ["Sort A", "Sort B", "Sort C"],
    tip: "Ouvre avec le buff, puis enchaîne les sorts à fort ratio dégâts / PA.",
  },
};
