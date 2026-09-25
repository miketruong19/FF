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
Question | Answer 1 | Points 1 | Answer 2 | Points 2 | ... | Answer 8 | Points 8 | Multiplier
```

Multiplier is optional: 1, 2 or 3 (blank means 1).

Rows with no question, no answers, or non-number points are skipped and listed on the setup screen.
Rows whose points total more than 100 are skipped. Rows not in descending order load with a warning.

## How a round goes

1. **Setup**: add questions or upload a sheet, name the teams, check the list, Start game.
   The **Setup** button on other screens goes behind the red cover (the list shows answers); **Continue game** resumes.
2. **Buzz**: GM reads the question and taps **Arm buzzers**. Each team slaps their half of the screen.
   First touch wins, shows its lead in milliseconds, and the app moves to the board by itself. Early taps flash red and do nothing.
3. **Face-off on the board**: the banner says who buzzed. GM taps **Check answer**.
4. **Checking any answer** (face-off, regular play, steal):
   - A red cover says turn the iPad to the GM. Tap it, then pick what the player said, or ✗.
   - A green cover says turn it back. One tap plays everything: "Survey says…" with a drum roll, then the flip with a ding, or the big X with a buzzer.
   - In the face-off, the #1 answer wins control at once; otherwise the other team guesses and the higher answer wins. Both missing means **Redo face-off**.
   - The board then says who has control, with **Play** or **Pass**.
5. **Regular play**: keep using **Check answer**. ✗ counts as a strike. **Strike** and tapping a slot directly still work.
   On the third strike the other team gets one guess to **steal**; the pot goes to whoever wins it. Clearing the board also wins the pot.
   **Give pot to …** is the manual override. Tap a score to type a correction.
   Each question has its own **×1 / ×2 / ×3**, from the editor or the sheet. The buttons under the pot override it for one round.
6. **Next question / Finish game** appears in the banner when the round is over. Finish shows the final score and winner; **Play again** starts over.
7. **GM view** (top-right pill) shows every answer. Anything revealed or struck there plays with animation and sound when you switch back.
8. **Sound**: game-show style sounds made in code (not the TV show's). Toggle with the Sound button. If the iPad is silent, check its volume and silent switch.
