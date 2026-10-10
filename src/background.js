// Clic sur l'icône de l'extension : affiche / masque le panneau sur l'onglet du jeu.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "dmx-toggle" }).catch(() => {
    // Pas de content script : on n'est pas sur https://rpgmasters.houk.fr/
  });
});
