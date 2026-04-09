(function() {
  // 1. Locate the React State (GameState)
  // We look for the root element or hud element that holds the game context
  const root = document.querySelector('#root') || document.body;
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactInternalInstance'));
  const internalState = root[key];

  // Note: In many Sunflower Land builds, the game state is accessible via the 'window' 
  // if you are using a development build, but for testing, we'll assume standard React.
  // This helper finds the 'inventory' object within the React Fiber tree
  function findInventory(node) {
    if (!node) return null;
    if (node.memoizedProps?.state?.inventory) return node.memoizedProps.state.inventory;
    if (node.memoizedState?.inventory) return node.memoizedState.inventory;
    return findInventory(node.child) || findInventory(node.sibling);
  }

  const inventory = findInventory(internalState);

  if (!inventory) {
    console.error("Could not find Game Inventory. Make sure the game is fully loaded.");
    return;
  }

  // 2. Filter for Basket Items (Logic from src/features/island/hud/components/inventory/utils/inventory.ts)
  // We exclude placeables like buildings and collectibles
  const basketItems = Object.entries(inventory)
    .filter(([name, amount]) => {
      const qty = parseFloat(amount);
      // Logic from source: qty > 0 and not a placeable/land
      return qty > 0 && name !== "Basic Land"; 
    })
    .map(([name, amount]) => {
      // Here we would ideally grab the image from the global ITEM_DETAILS
      // If ITEM_DETAILS isn't global, we can fallback to searching the DOM for the specific src
      const imgElement = document.querySelector(`img[alt="${name}"]`);
      return {
        name: name,
        quantity: amount.toString(),
        imageSrc: imgElement ? imgElement.src : "Image not found in DOM"
      };
    });

  console.table(basketItems);

})();
