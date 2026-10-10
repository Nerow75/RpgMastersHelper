# Dofus Masters Helper

Extension navigateur (Chrome / Edge / Brave, Manifest V3) pour
[Dofus Masters](https://rpgmasters.houk.fr/). Elle affiche un panneau de conseils par-dessus
le jeu, calculés à partir des **vraies données du jeu**, relues automatiquement : si un objet,
un monstre ou un sort change, l'extension le voit à la synchronisation suivante.

L'extension ne fait que **lire** : elle ne clique, n'équipe et ne modifie rien dans le jeu.

## Ce que fait le panneau

- **Conseils**
  - élément de ton build, détecté d'après ton équipement (ou choisi à la main) ;
  - où mettre tes points libres, avec les vrais coûts par palier du jeu ;
  - pour chaque emplacement : ce que tu portes, un meilleur objet que tu possèdes déjà,
    et le meilleur objet à viser à ton niveau.
- **Sorts** : passif de ta classe, sorts de dégâts de ton élément classés par dégâts/PA,
  sorts de soutien, avec ceux que tu n'as pas encore.
- **Bestiaire** : recherche d'un monstre (niveaux, zones, butin) ou d'un objet
  (stats, monstres qui le lâchent).

## D'où viennent les données

Le site (Next.js) envoie les données de chaque page en JSON dans le HTML. L'extension
télécharge ces pages avec ta session (il faut être connecté) :

| Page | Données | Rafraîchie |
| --- | --- | --- |
| `/bestiaire` | monstres, zones, butin | 1 fois par jour |
| `/bestiaire?onglet=objets`, `/collection?onglet=objets` | objets et leurs stats | 1 fois par jour |
| `/collection?onglet=sorts` | sorts | 1 fois par jour |
| `/personnage` | équipement porté, caractéristiques, points libres, classes | toutes les 10 min |

Le bouton **Mettre à jour** force une synchronisation complète. Ton niveau et tes objets
obtenus sont aussi lus quand tu ouvres **Ma collection**.

## Installer (mode développeur)

1. Télécharge ce dépôt (bouton **Code → Download ZIP**, puis dézippe-le) ou clone-le.
2. Ouvre `chrome://extensions` (ou `edge://extensions`).
3. Active **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier du projet
   (celui qui contient `manifest.json`).
5. Va sur https://rpgmasters.houk.fr/, connecte-toi : le panneau apparaît à droite.
   Clique sur l'icône de l'extension pour l'afficher / le masquer, tire son en-tête pour
   le déplacer.

Après chaque mise à jour des fichiers, clique sur ↻ sur la carte de l'extension dans
`chrome://extensions`, puis recharge la page du jeu.

## Structure

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension (nom, permissions, site ciblé) |
| `src/game.js` | Lecture des pages du jeu (données Next.js, page Ma collection) |
| `src/catalog.js` | Synchronisation et mise en cache des données du jeu |
| `src/advisor.js` | Calcul des conseils (points, équipement, sorts) |
| `src/overlay.js` | Panneau affiché dans la page |
| `src/overlay.css` | Style du panneau |
| `src/background.js` | Clic sur l'icône de l'extension |

Le « score » d'un objet est une estimation : chaque stat a un poids dans `WEIGHTS`
(`src/advisor.js`), par exemple 1 PA = 100 points de stat principale. Ajuste ces poids si
les conseils ne te semblent pas justes.
