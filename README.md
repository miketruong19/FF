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

The app needs an HTTPS address. Two ways to get one:

**A. GitHub Pages** (nothing to run, permanent link): repo Settings → Pages → deploy from this branch, root folder.

**B. Your laptop + ngrok** (fixed address, laptop must be running):

1. `brew install ngrok`, then `ngrok config add-authtoken YOUR_TOKEN` (token is on the ngrok dashboard).
2. Claim your free static domain at https://dashboard.ngrok.com/domains.
3. Open `serve.sh` and put that domain on the `NGROK_DOMAIN` line.
4. Run `./serve.sh`. It starts a local server on port 8000 and the tunnel. Ctrl-C stops both.

Then on the iPad:

1. Open the address in Safari. With free ngrok, tap **Visit Site** on the warning page the first time.
2. Share → **Add to Home Screen**. Open it from there for full screen.
3. From then on it opens offline. Your questions, team names and scores are kept on the iPad.

Opening `index.html` straight from the Files app does not work well in Safari, so use a URL.

## Adding questions

Two ways, mix them freely:

- **In the app**: Setup → **+ Add a question**. Type the question and up to 8 answers with points.
  Points are how many of the 100 people surveyed gave that answer, so the total can't go over 100 (it's usually under). Answers get sorted by points on save.
  Each question in the list has Edit, move up/down and delete buttons. **Download as .csv** backs the whole list up.
- **Spreadsheet**: upload a `.xlsx` or `.csv` in the format below.

## Spreadsheet format

One row per question, best answer first. A header row is fine.

```
Question | Answer 1 | Points 1 | Answer 2 | Points 2 | ... | Answer 8 | Points 8
```

Rows with no question, no answers, or non-number points are skipped and listed on the setup screen.
Rows whose points total more than 100 are skipped. Rows not in descending order load with a warning.

## How a round goes

1. **Setup**: add questions or upload a sheet, name the teams, check the list, Start game.
   The **Setup** button on the other screens brings you back here; **Continue game** resumes where you were.
2. **Face-off**: GM reads the question, taps **Arm buzzers**. Each team slaps their half of the screen.
   First touch wins and shows its lead in milliseconds. Taps before arming flash red and do nothing.
   GM taps **Check answer**, turns the iPad, picks what the player said (or **Not on board**).
   The #1 answer wins control at once; otherwise the other team gets a guess and the higher answer wins.
   Both revealed answers stay up and their points go in the pot. Both miss → **Redo face-off**.
   Then **Play** or **Pass**.
3. **Board**: tap a slot to flip it (adds to pot). **Strike** flashes an X, max three.
   On the third strike the other team gets one guess to **steal**: tap the answer they give and the whole pot goes to them,
   or tap **Steal missed** and the playing team keeps it. Clearing the board gives the pot to the playing team automatically.
   **Give pot to …** is the manual override. Tap a score to type a correction.
   **×1 / ×2 / ×3** under the pot sets a double or triple round: slots keep their survey numbers, the pot and the award are multiplied.
   The setting carries over to the next question until you change it.
   **Reveal all** flips the rest without adding points. ◀ ▶ moves to another question and resets pot and strikes.
4. **GM view** (top-right pill) shows every answer with points and marks the revealed ones.
   Flips made there play as animations when you switch back to player view.
