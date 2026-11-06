// The title screen showcases Pumpkin Patch. The chooser previews the selected map.
(() => {
  const menu = document.getElementById('scrMenu');
  const baseApplyMap = applyMap;
  const baseShowScreen = showScreen;

  function showingTitle() {
    return Game.mode === 'menu' && menu.classList.contains('on');
  }

  applyMap = function(id) {
    baseApplyMap(showingTitle() ? 'pumpkin' : id);
  };

  function refreshPreview() {
    if (Game.mode !== 'menu') return;
    const previous = PumpkinPatch.state.enabled;
    applyMap(Game.map);
    if (showingTitle()) PumpkinPatch.previewHarvest();
    if (previous === PumpkinPatch.state.enabled) return;
    // A map switch changes the demo's floor and spawn points as well as its rigs.
    assignActiveFighters(Game.selectedChar, false);
    fighters.forEach((fighter, i) => {
      fighter.reset(spawnPoints[i][0], spawnPoints[i][2]);
      fighter.isPlayer = false;
      fighter.invuln = 0;
    });
  }

  showScreen = function(id) {
    baseShowScreen(id);
    refreshPreview();
  };
  refreshPreview();
})();
