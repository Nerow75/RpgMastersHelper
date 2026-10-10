# Dofus Masters Helper

Extension navigateur (Chrome / Edge / Brave, Manifest V3) qui affiche un panneau de
recommandations par-dessus [Dofus Masters](https://rpgmasters.houk.fr/) :

- répartition des points de caractéristique
- priorités d'équipement
- points forts du build
- decks de sorts conseillés

Tu choisis ta classe et ton élément dans le panneau ; ton choix est mémorisé.

L'extension lit aussi (sans rien modifier) la page **Ma collection** :

- ton niveau (« Équipables par moi (niv. 112 ou moins) ») ;
- les objets affichés, obtenus ou non.

Elle en déduit ton meilleur équipement possédé par emplacement et les objets à viser
à ton niveau. Les objets ne sont connus qu'une fois affichés : utilise le filtre
« Niv. … à … » de la collection pour charger ceux de ton niveau.

## Installer (mode développeur)

1. Télécharge ce dépôt (bouton **Code → Download ZIP**, puis dézippe-le) ou clone-le.
2. Ouvre `chrome://extensions` (ou `edge://extensions`).
3. Active **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier du projet
   (celui qui contient `manifest.json`).
5. Va sur https://rpgmasters.houk.fr/ : le panneau apparaît à droite.
   Clique sur l'icône de l'extension pour l'afficher / le masquer. Tu peux le déplacer
   en tirant son en-tête.

Après chaque modification des fichiers, clique sur ↻ (recharger) sur la carte de
l'extension dans `chrome://extensions`, puis recharge la page du jeu.

## Structure

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension (nom, permissions, site ciblé) |
| `src/game.js` | Lit les infos affichées par le jeu (niveau, objets) |
| `data/builds.js` | **Toutes les recommandations** (classes, éléments, decks) |
| `src/overlay.js` | Construit et affiche le panneau dans la page |
| `src/overlay.css` | Style du panneau |
| `src/background.js` | Gère le clic sur l'icône de l'extension |

## Ajouter des recommandations

Tout se passe dans `data/builds.js`. Les textes actuels sont des exemples génériques
inspirés de Dofus : remplace-les par les vraies règles de Dofus Masters. Pour un deck :

```js
iop: {
  label: "Iop",
  role: "Dégâts au corps à corps",
  elements: ["terre", "feu", "air", "eau"],
  decks: {
    terre: [
      { name: "Burst mono-cible", spells: ["Sort A", "Sort B"], tip: "Ouvre avec le buff." },
    ],
  },
},
```
