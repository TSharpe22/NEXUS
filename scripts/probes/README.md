# Probes

Not part of `npm run check`. These drive the built app to measure things a
pass/fail assertion is a bad fit for — frame timings, layout extents, whether a
window survives being closed mid-write. They are how the findings in
`QA_SCAN.md` were established, kept so the numbers can be reproduced.

Build first (`npm run build`), then:

    APP_DIR=$PWD SEED_PAGES=1500 xvfb-run -a node scripts/probes/typing.mjs

| Probe | Answers |
|---|---|
| `quit.mjs` | Does an edit typed inside the autosave debounce survive closing the window, and `app.quit()`? Does a second launch get its own window on the same vault? |
| `graph.mjs` | Does the graph settle, fit its panel, and stay interactive? Prints the drawn extent against the panel. |
| `interaction.mjs` | Does dragging a graph node navigate, does a settled graph still move, does chrome text select? |
| `restore.mjs` | Does restoring a snapshot put the vault back, and leave the window alive to see it? |
| `typing.mjs` | What does a keystroke cost in a vault that is actually in use? Long tasks and dropped frames through a typing burst. |
| `blocks.mjs` | Does the block menu open where you are typing? Every block type, empty and with a word in it. This is the reproduction for "blocks respond poorly". |

`SEED_PAGES` sets the vault size (default 400 for `graph` and `typing`).
`KEYSTROKES` is `typing.mjs`'s burst length. `SCREENSHOT_DIR` sets where shots
land.
