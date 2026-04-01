/**
 * Sunland – Autotest: Click Tree
 *
 * Paste this script into the browser console while on the farm page
 * to automatically find every available (un-chopped) tree and click
 * it the required number of times (3 hits) to chop it.
 *
 * Usage:
 *   1. Open the Sunland game in your browser and navigate to your farm.
 *   2. Make sure your inventory contains at least one Axe.
 *   3. Open the browser developer console (F12 → Console tab).
 *   4. Paste the entire script and press Enter.
 *
 * Notes:
 *   - Trees that are already chopped (recovering) are skipped automatically.
 *   - If a reward-captcha dialog appears it will pause automation for that tree.
 *   - Run the script again after trees have recovered to chop them again.
 */
(async function autotestClickTree() {
  // ─── Config ────────────────────────────────────────────────────────────────
  const HITS = 3; // clicks needed to chop one tree
  const HIT_DELAY_MS = 300; // delay between clicks on the same tree (ms)
  const TREE_DELAY_MS = 800; // delay between chopping different trees (ms)
  // ───────────────────────────────────────────────────────────────────────────

  /** Promise-based sleep helper */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Dispatches a realistic mouse-click sequence on an element so that
   * React's synthetic-event system (attached at the root container) picks
   * it up and fires the component's onClick handler.
   */
  function simulateClick(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    };
    element.dispatchEvent(new MouseEvent("mousedown", opts));
    element.dispatchEvent(new MouseEvent("mouseup", opts));
    element.dispatchEvent(new MouseEvent("click", opts));
  }

  /**
   * Finds every available (un-chopped) tree on the current page.
   *
   * Identification strategy
   * ──────────────────────
   * When a tree is ready to chop, RecoveredTree renders a static <img> whose
   * `src` URL path segment is "/resources/tree/<Biome>/<variant>.webp|png"
   * (e.g. "…/resources/tree/Basic/spring_basic_tree.webp").
   * Chopped-tree stumps use "/resources/stump.png" (no "/resources/tree/" segment).
   * Shake-sheet animation sprites are excluded by matching "shake_sheet" in the name.
   *
   * DOM hierarchy (bottom-up from the tree <img>):
   *   img.relative.pointer-events-none              ← static tree image (touchCount === 0)
   *   └─ div.absolute.w-full.h-full.cursor-pointer  ← RecoveredTree inner hover div
   *      └─ div.absolute.w-full.h-full              ← RecoveredTree outer wrapper
   *         └─ div.absolute.w-full.h-full           ← Tree.tsx click wrapper (onClick=shake) ← click target
   *            └─ div.relative.w-full.h-full         ← Tree.tsx outer component div
   */

  // Matches paths like "/resources/tree/Basic/spring_basic_tree.webp"
  // Excludes shake-sheet animations (contain "shake_sheet") and stump images.
  const TREE_IMG_RE = /\/resources\/tree\/[^/]+\/[^/]+\.(webp|png)$/;

  function findAvailableTrees() {
    // Static tree images visible when touchCount === 0 (not being animated/hit)
    const treeImgs = Array.from(
      document.querySelectorAll("img[src*='/resources/tree/']"),
    ).filter((img) => {
      try {
        const pathname = new URL(img.src).pathname;
        return TREE_IMG_RE.test(pathname) && !pathname.includes("shake_sheet");
      } catch {
        return false;
      }
    });

    const clickTargets = treeImgs
      .map((img) => {
        // Walk up 3 DOM levels:
        //   Level 1: div.cursor-pointer (RecoveredTree inner hover div, Tree.tsx RecoveredTree.tsx:96)
        //   Level 2: div.absolute (RecoveredTree outer wrapper, RecoveredTree.tsx:90)
        //   Level 3: div.absolute.w-full.h-full with onClick=shake (Tree.tsx:273) ← click target
        const clickWrapper =
          img.parentElement?.parentElement?.parentElement ?? null;

        // Sanity-check: the click wrapper should be an absolutely-positioned div
        // that is a direct child of the tree's relative outer wrapper.
        if (
          !clickWrapper ||
          clickWrapper.tagName !== "DIV" ||
          !clickWrapper.classList.contains("absolute")
        ) {
          return null;
        }
        return clickWrapper;
      })
      .filter(Boolean);

    // De-duplicate in case the same wrapper is matched by multiple selectors
    return [...new Set(clickTargets)];
  }

  // ─── Main ──────────────────────────────────────────────────────────────────
  console.log("🌲 Sunland Autotest – Click Tree starting…");

  const trees = findAvailableTrees();

  if (trees.length === 0) {
    console.warn(
      "❌ No available trees found.\n" +
        "   Make sure you are on the farm page and at least one tree is ready to chop.",
    );
    return;
  }

  console.log(`✅ Found ${trees.length} available tree(s). Chopping…`);

  let chopped = 0;
  let failed = 0;

  for (let i = 0; i < trees.length; i++) {
    const target = trees[i];
    console.log(`🪓 Chopping tree ${i + 1} / ${trees.length}…`);

    try {
      for (let hit = 0; hit < HITS; hit++) {
        simulateClick(target);
        // Only wait between hits, not after the last one
        if (hit < HITS - 1) await sleep(HIT_DELAY_MS);
      }
      chopped++;
      console.log(`   ✅ Tree ${i + 1} chopped.`);
    } catch (err) {
      failed++;
      console.error(`   ❌ Failed to chop tree ${i + 1}:`, err);
    }

    if (i < trees.length - 1) {
      await sleep(TREE_DELAY_MS);
    }
  }

  console.log(
    `\n🎉 Autotest complete!  Chopped: ${chopped}  |  Failed: ${failed}`,
  );
})();
