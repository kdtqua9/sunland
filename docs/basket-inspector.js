/**
 * Sunland – Basket / Inventory Inspector
 *
 * Paste this into the browser console while on your farm.
 *
 * How it works:
 *   1. Finds the basket button by looking for an img whose src contains
 *      "icons/basket" (e.g. https://sunflower-land.com/game-assets/icons/basket.png)
 *      and walks up to the nearest clickable ancestor.
 *   2. Clicks it with a real MouseEvent (clientX/Y from bounding rect) so
 *      SFL's React handler actually responds.
 *   3. Polls the DOM every 150 ms until a panel element containing item
 *      images appears (up to 3 seconds).
 *   4. Scrapes ONLY within that panel element — never the whole document —
 *      so farm-world images (clouds, buildings, composters) are excluded.
 *   5. Derives item names from the img src path and quantities from the
 *      nearest text node containing a number in the item slot.
 *
 * Usage (auto-runs on paste):
 *   inspectBasket()   – open basket, scrape, close
 */
(function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ── Click helper: dispatch a real MouseEvent so React responds ─────────────
  function simulateClick(el) {
    var r  = el.getBoundingClientRect();
    var cx = r.left + r.width  * (0.4 + Math.random() * 0.2);
    var cy = r.top  + r.height * (0.4 + Math.random() * 0.2);
    el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy,
      screenX: cx + (window.screenX || 0),
      screenY: cy + (window.screenY || 0),
    }));
  }

  // ── Find the basket button ─────────────────────────────────────────────────
  // Primary: look for the basket icon img by src, then walk up to clickable parent.
  // Fallback: aria-label / text-content scan.
  function findBasketBtn() {
    // Strategy 1: known basket icon src (user confirmed: .../icons/basket.png)
    var basketImg = Array.from(document.querySelectorAll("img")).find(function (i) {
      var s = (i.getAttribute("src") || "").toLowerCase();
      return s.includes("icons/basket") || s.includes("basket.png");
    });
    if (basketImg) {
      var el = basketImg;
      for (var n = 0; n < 8 && el; n++) {
        if (el.tagName === "BUTTON" || el.tagName === "A" ||
            el.getAttribute("role") === "button" ||
            el.classList.contains("cursor-pointer")) return el;
        el = el.parentElement;
      }
      // Nothing clickable found up the tree – click the img's direct parent
      return basketImg.parentElement || basketImg;
    }

    // Strategy 2: aria-label / title attributes
    var byAttr = document.querySelector(
      "[aria-label='Inventory'],[aria-label='inventory']," +
      "[title='Inventory'],[title='inventory']," +
      "[aria-label='Basket'],[aria-label='basket']," +
      "[aria-label='Backpack'],[aria-label='backpack']"
    );
    if (byAttr && byAttr.getBoundingClientRect().width > 0) return byAttr;

    // Strategy 3: any img src with inventory-related keyword
    var invImg = Array.from(document.querySelectorAll("img")).find(function (i) {
      var s = (i.getAttribute("src") || "").toLowerCase();
      return s.includes("backpack") || s.includes("inventory") ||
             s.includes("bag") || s.includes("satchel");
    });
    if (invImg) {
      var el2 = invImg;
      for (var m = 0; m < 8 && el2; m++) {
        if (el2.tagName === "BUTTON" || el2.tagName === "A" ||
            el2.getAttribute("role") === "button" ||
            el2.classList.contains("cursor-pointer")) return el2;
        el2 = el2.parentElement;
      }
      return invImg.parentElement || invImg;
    }

    return null;
  }

  // ── Wait for the inventory panel to appear after the click ─────────────────
  // Polls every 150 ms for up to 3 s.  Returns the panel element or null.
  async function waitForPanel() {
    for (var attempt = 0; attempt < 20; attempt++) {
      await sleep(150);
      var candidates = Array.from(document.querySelectorAll(
        "[role='dialog'],[class*='modal'],[class*='panel']," +
        "[class*='inventory'],[class*='chest'],[class*='bag']"
      )).filter(function (el) {
        var r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 50;
      });

      // Pick the candidate that contains the most item-like images
      var best = null, bestCount = 0;
      for (var i = 0; i < candidates.length; i++) {
        var count = candidates[i].querySelectorAll(
          "img[src*='game-assets'],img[src*='sunflower-land.com']"
        ).length;
        if (count > bestCount) { bestCount = count; best = candidates[i]; }
      }
      if (best && bestCount > 0) return best;
    }
    return null;
  }

  // ── Derive item name from img src path ─────────────────────────────────────
  // e.g. ".../crops/barley/seed.png"  → "Barley Seed"
  //      ".../resources/wood.png"     → "Wood"
  //      ".../tools/axe.png"          → "Axe"
  function nameFromSrc(src) {
    // Strip query / hash, split path
    var parts = src.split("?")[0].split("#")[0].split("/");
    var file  = (parts[parts.length - 1] || "").replace(/\.\w+$/, ""); // e.g. "seed"
    var fold  = parts[parts.length - 2] || "";                          // e.g. "barley"
    var fold2 = parts[parts.length - 3] || "";                          // e.g. "crops"

    var raw = (
      file === "seed"     ? fold + " seed"     :
      file === "seedling" ? fold + " seedling" :
      file === "crop"     ? fold               :
      fold === fold2      ? file               :
      fold + " " + file
    ).replace(/[-_]/g, " ").trim();

    if (!raw || raw.length < 2) return null;

    return raw.split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  // ── Find the quantity for an item image ────────────────────────────────────
  // Searches the item slot (img → parent → grandparent) for a pure-number text.
  function qtyForImg(img) {
    var NUMBER_RE = /^\d[\d,]*(\.\d+)?$/;

    // Walk up two levels to cover different slot structures
    var containers = [img.parentElement];
    if (img.parentElement && img.parentElement.parentElement) {
      containers.push(img.parentElement.parentElement);
    }

    for (var c = 0; c < containers.length; c++) {
      var slot = containers[c];
      if (!slot) continue;

      // Check every descendant element whose own text (not children) is a number
      var all = Array.from(slot.querySelectorAll("*")).concat([slot]);
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        // Use only elements with no child elements OR elements that are
        // purely presentational (span/p/b/strong) to avoid matching
        // container divs whose textContent is the concatenation of all children.
        var isLeaf = el.children.length === 0 ||
                     /^(SPAN|P|B|STRONG|LABEL)$/.test(el.tagName);
        if (!isLeaf) continue;
        var txt = (el.textContent || "").trim();
        if (NUMBER_RE.test(txt)) return parseFloat(txt.replace(/,/g, ""));
      }
    }
    return 0;
  }

  // ── Scrape items from the open panel ──────────────────────────────────────
  // panelRoot: the panel DOM element returned by waitForPanel().
  function scrapePanel(panelRoot) {
    var result = {};

    Array.from(panelRoot.querySelectorAll(
      "img[src*='game-assets'],img[src*='sunflower-land.com']"
    )).filter(function (img) {
      var src = img.getAttribute("src") || "";
      // Skip UI / icon images that live in the /icons/ folder
      if (src.includes("/icons/")) return false;
      // Must be visible
      var r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).forEach(function (img) {
      var src  = img.getAttribute("src") || "";
      var name = nameFromSrc(src);
      if (!name) return;

      var qty = qtyForImg(img);
      // qty 0 means text was absent – record as 1 so the item still appears
      if (!result[name] || qty > result[name]) result[name] = qty || 1;
    });

    return result;
  }

  // ── Main entry point ───────────────────────────────────────────────────────
  window.inspectBasket = async function inspectBasket() {
    // 1. Find the basket button
    var btn = findBasketBtn();
    if (!btn) {
      console.warn("[basket-inspector] ❌ Basket button not found.");
      console.log("[basket-inspector] All img srcs on page:",
        Array.from(document.querySelectorAll("img"))
          .map(function (i) { return i.getAttribute("src"); })
          .filter(Boolean)
          .filter(function (s) { return s.includes("icons"); })
          .slice(0, 20)
      );
      return;
    }
    console.log("[basket-inspector] Basket button found:", btn);

    // 2. Click it with a real MouseEvent
    simulateClick(btn);
    console.log("[basket-inspector] Click dispatched, waiting for panel…");

    // 3. Wait for the panel to appear in the DOM
    var panel = await waitForPanel();
    if (!panel) {
      console.warn(
        "[basket-inspector] ❌ Panel did not appear after 3 s. " +
        "The basket may need to be opened manually, or the panel selector needs updating."
      );
      return;
    }
    console.log("[basket-inspector] Panel found:", panel);

    // 4. Scrape only within the panel
    var found = scrapePanel(panel);

    // 5. Close the panel (Escape key is the safest cross-version close)
    await sleep(200);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true, cancelable: true }));

    // 6. Print results
    if (!Object.keys(found).length) {
      console.warn("[basket-inspector] ⚠️  No items found in panel. " +
        "Panel HTML (first 500 chars):", panel.innerHTML.slice(0, 500));
      return;
    }

    console.log("%c🧺 Inventory", "font-weight:bold;font-size:14px");
    var table = Object.entries(found)
      .sort(function (a, b) { return a[0].localeCompare(b[0]); })
      .reduce(function (acc, e) { acc[e[0]] = { qty: e[1] }; return acc; }, {});
    console.table(table);
  };

  // Auto-run immediately on paste
  window.inspectBasket();
})();
