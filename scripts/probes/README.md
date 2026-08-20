# Probes

Not part of `npm run check`. These drive the built app to measure things a
pass/fail assertion is a bad fit for — frame timings, layout extents, whether a
window survives being closed mid-write. They are how the findings in
`QA_SCAN.md` were established, kept so the numbers can be reproduced.

Build first (`npm run build`), then:

    APP_DIR=$PWD SEED_PAGES=1500 xvfb-run -a node scripts/probes/scale.mjs

| Probe | Answers |
|---|---|
| `quit.mjs` | Does an edit typed inside the autosave debounce survive closing the window, and `app.quit()`? Does a second launch get its own window on the same vault? |
| `scale.mjs` | Frame timings for Home and the capture box at a seeded vault. |
| `graph.mjs` | Does the graph settle, fit its panel, and stay interactive? Prints the drawn extent against the panel. |
| `roundtrip.mjs` | Export → import: block types, ids, checkbox state, task projection, filename collisions. |

`SEED_PAGES` sets the vault size (default 1500 for `scale`, 400 for `graph`).
`SCREENSHOT_DIR` sets where shots land.
