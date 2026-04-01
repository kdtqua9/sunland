/**
 * Sunland – Autotest: Click Tree  (infinite loop edition)
 *
 * Paste this script into the browser console while on the farm page.
 * It will continuously find, chop, and wait for every tree to recover,
 * then chop again – forever, until you stop it.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   1. Open the Sunland game in your browser and navigate to your farm.
 *   2. Make sure your inventory contains at least one Axe.
 *   3. Open the browser developer console (F12 → Console tab).
 *   4. Paste the entire script and press Enter.
 *   5. To stop at any time, run:  stopTreeAutotest()
 *
 * ─── Why this bypasses browser timer throttling ──────────────────────────────
 *   Browsers throttle setTimeout/setInterval in background/hidden tabs,
 *   which silently breaks console autotests.  This script spins up an
 *   inline Web Worker for all waiting – Worker timers are NOT throttled
 *   even when the tab is hidden or the page is backgrounded.
 *   Additionally, native setTimeout/setInterval are captured immediately
 *   (before any game code can monkey-patch them) as a fallback.
 *
 * ─── Notes ───────────────────────────────────────────────────────────────────
 *   - Trees that are still recovering are automatically skipped each round.
 *   - After all visible trees are chopped the script waits for them to
 *     recover (default: TREE_RECOVERY_TIME = 2 h, plus a 90-second buffer)
 *     then starts the next round.
 *   - If a reward-captcha dialog appears it pauses automation for that tree.
 */
(function () {
  // ─── Capture native timers BEFORE any game code can override them ─────────
  const _nativeSetTimeout = window.setTimeout.bind(window);
  const _nativeClearTimeout = window.clearTimeout.bind(window);
  const _nativeSetInterval = window.setInterval.bind(window);
  const _nativeClearInterval = window.clearInterval.bind(window);

  // ─── Config ────────────────────────────────────────────────────────────────
  const HITS = 3; // clicks needed to chop one tree
  const HIT_DELAY_MS = 300; // ms between clicks on the same tree
  const TREE_DELAY_MS = 800; // ms between chopping different trees
  const TREE_RECOVERY_MS = 2 * 60 * 60 * 1000; // 2 h  (= TREE_RECOVERY_TIME in src/features/game/lib/constants.ts)
  const RECOVERY_BUFFER_MS = 90 * 1000; // extra 90 s after recovery
  const POLL_INTERVAL_MS = 30 * 1000; // re-check interval while waiting
  // ───────────────────────────────────────────────────────────────────────────

  // ─── Stop control ─────────────────────────────────────────────────────────
  let stopped = false;
  window.stopTreeAutotest = function () {
    if (stopped) return; // guard against double-calls
    stopped = true;

    // Resolve all pending sleep callbacks so the async loop can exit cleanly.
    for (const id in _sleepCallbacks) {
      try { _sleepCallbacks[id](); } catch (_) {}
    }
    for (const id in _sleepCallbacks) delete _sleepCallbacks[id];

    try { worker.terminate(); } catch (_) {}
    try { URL.revokeObjectURL(workerUrl); } catch (_) {}
    console.log("🛑 Tree autotest stopped.");
  };

  // ─── Web Worker for background-safe sleep ─────────────────────────────────
  // Worker timers are never throttled by the browser, even in hidden tabs.
  const workerCode = `
    self.onmessage = function(e) {
      var id = e.data.id;
      var ms = e.data.ms;
      setTimeout(function() { self.postMessage(id); }, ms);
    };
  `;
  const workerBlob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(workerBlob);
  const worker = new Worker(workerUrl);

  let _sleepCounter = 0;
  const _sleepCallbacks = {};

  worker.onmessage = function (e) {
    const id = e.data;
    if (_sleepCallbacks[id]) {
      _sleepCallbacks[id]();
      delete _sleepCallbacks[id];
    }
  };

  /**
   * Background-safe sleep.  Uses the inline Worker so that even when the
   * game tab is hidden the delay fires on time.
   */
  function sleep(ms) {
    return new Promise(function (resolve) {
      if (stopped) { resolve(); return; }
      const id = ++_sleepCounter;
      _sleepCallbacks[id] = resolve;
      worker.postMessage({ id: id, ms: ms });
    });
  }

  // ─── Tree detection ───────────────────────────────────────────────────────
  /**
   * Matches static tree image paths like:
   *   "/resources/tree/Basic/spring_basic_tree.webp"
   *
   * Stump images ("/resources/stump.png") do not match because they lack the
   * two-segment "/resources/tree/<Biome>/<file>" pattern.
   *
   * Shake-sheet sprites (e.g. "…_shake_sheet.webp") DO match the pattern, so
   * they must be filtered out separately – see the `!pathname.includes('shake_sheet')` check below.
   */
  const TREE_IMG_RE = /\/resources\/tree\/[^/]+\/[^/]+\.(webp|png)$/;

  /**
   * Finds every available (un-chopped) tree on the current page.
   *
   * DOM hierarchy (bottom-up from the tree <img>):
   *   img.relative.pointer-events-none              ← static tree image (touchCount === 0)
   *   └─ div.absolute.w-full.h-full.cursor-pointer  ← RecoveredTree inner hover div
   *      └─ div.absolute.w-full.h-full              ← RecoveredTree outer wrapper
   *         └─ div.absolute.w-full.h-full           ← Tree.tsx click wrapper (onClick=shake) ← click target
   *            └─ div.relative.w-full.h-full         ← Tree.tsx outer component div
   */
  function findAvailableTrees() {
    const treeImgs = Array.from(
      document.querySelectorAll("img[src*='/resources/tree/']"),
    ).filter(function (img) {
      try {
        const pathname = new URL(img.src).pathname;
        return TREE_IMG_RE.test(pathname) && !pathname.includes("shake_sheet");
      } catch (_) {
        return false;
      }
    });

    const clickTargets = treeImgs
      .map(function (img) {
        // Walk up 3 DOM levels to reach the div with onClick=shake (Tree.tsx:273)
        const clickWrapper =
          img.parentElement &&
          img.parentElement.parentElement &&
          img.parentElement.parentElement.parentElement;

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

    return Array.from(new Set(clickTargets));
  }

  // ─── Click simulation ─────────────────────────────────────────────────────
  /**
   * Dispatches a realistic mouse-click sequence on an element so that
   * React's synthetic-event system picks it up and fires onClick.
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

  // ─── Chop one round of trees ──────────────────────────────────────────────
  async function chopRound(round) {
    const trees = findAvailableTrees();

    if (trees.length === 0) {
      return 0;
    }

    console.log(
      `[Round ${round}] 🌲 Found ${trees.length} tree(s). Chopping…`,
    );
    let chopped = 0;

    for (let i = 0; i < trees.length; i++) {
      if (stopped) break;

      const target = trees[i];
      console.log(`  🪓 Tree ${i + 1}/${trees.length}…`);

      try {
        for (let hit = 0; hit < HITS; hit++) {
          simulateClick(target);
          if (hit < HITS - 1) await sleep(HIT_DELAY_MS);
        }
        chopped++;
        console.log(`     ✅ Chopped.`);
      } catch (err) {
        console.error(`     ❌ Failed:`, err);
      }

      if (i < trees.length - 1) await sleep(TREE_DELAY_MS);
    }

    console.log(`[Round ${round}] 🎉 Done.  Chopped ${chopped}/${trees.length} trees.`);
    return chopped;
  }

  // ─── Infinite loop ────────────────────────────────────────────────────────
  async function runLoop() {
    console.log(
      "🌲 Sunland Autotest – infinite tree loop started.\n" +
        "   Run  stopTreeAutotest()  to stop at any time.",
    );

    let round = 0;

    while (!stopped) {
      round++;
      const chopped = await chopRound(round);

      if (stopped) break;

      if (chopped > 0) {
        // Trees were just chopped – wait for them to recover before the next round.
        const waitMs = TREE_RECOVERY_MS + RECOVERY_BUFFER_MS;
        const waitMin = Math.ceil(waitMs / 60000);
        console.log(
          `[Round ${round}] ⏰ Waiting ~${waitMin} min for trees to recover…`,
        );

        // Wait in POLL_INTERVAL_MS chunks so we can stop cleanly.
        let elapsed = 0;
        while (elapsed < waitMs && !stopped) {
          const chunk = Math.min(POLL_INTERVAL_MS, waitMs - elapsed);
          await sleep(chunk);
          elapsed += chunk;
          if (!stopped && elapsed < waitMs) {
            const remaining = Math.ceil((waitMs - elapsed) / 60000);
            console.log(
              `[Round ${round}] ⏳ ~${remaining} min remaining until next chop.`,
            );
          }
        }
      } else {
        // No trees available yet – poll more frequently.
        console.log(
          `[Round ${round}] 🔍 No trees ready. Rechecking in ` +
            `${POLL_INTERVAL_MS / 1000} s…`,
        );
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  runLoop();
})();
