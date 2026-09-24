# Family Feud (iPad, no server)

A one-page Family Feud board for a game master (GM) and two teams sharing one iPad.
No server, no login. Once loaded it works offline.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: screens, styles, game logic |
| `xlsx.mini.min.js` | SheetJS, reads `.xlsx` and `.csv` files in the browser (Apache-2.0, see `LICENSE-sheetjs.txt`) |
| `sw.js` | Service worker: caches the app so it opens with no network |
| `manifest.webmanifest` | Lets Safari "Add to Home Screen" as a full-screen app |
| `sample-questions.csv` | Example sheet, includes two bad rows so you can see them flagged |

## Put it on the iPad

1. Host the folder somewhere with HTTPS. GitHub Pages is the easy option:
   repo Settings → Pages → deploy from this branch, root folder.
2. Open the URL in Safari on the iPad.
3. Share → **Add to Home Screen**. Open it from there for full screen.
4. From then on it opens offline. Your last spreadsheet, team names and scores are kept on the iPad.

Opening `index.html` straight from the Files app does not work well in Safari, so use a URL.

## Spreadsheet format

One row per question, best answer first. A header row is fine.

```
Question | Answer 1 | Points 1 | Answer 2 | Points 2 | ... | Answer 8 | Points 8
```

Rows with no question, no answers, or non-number points are skipped and listed on the setup screen.
Rows whose points are not in descending order are loaded but get a warning.

## How a round goes

1. **Setup**: upload the sheet, name the teams, check the question list, Start game.
2. **Face-off**: GM reads the question, taps **Arm buzzers**. Each team slaps their half of the screen.
   First touch wins and shows its lead in milliseconds. Taps before arming flash red and do nothing.
   GM taps **Check answer**, turns the iPad, picks what the player said (or **Not on board**).
   The #1 answer wins control at once; otherwise the other team gets a guess and the higher answer wins.
   Both revealed answers stay up and their points go in the pot. Both miss → **Redo face-off**.
   Then **Play** or **Pass**.
3. **Board**: tap a slot to flip it (adds to pot). **Strike** flashes an X, max three.
   **Give pot to …** moves the pot to a team. Tap a score to type a correction.
   **Reveal all** flips the rest without adding points. ◀ ▶ moves to another question and resets pot and strikes.
4. **GM view** (top-right pill) shows every answer with points and marks the revealed ones.
   Flips made there play as animations when you switch back to player view.
