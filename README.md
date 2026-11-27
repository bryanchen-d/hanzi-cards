# Hanzi Cards

A Duolingo-style web app for learning the **3,000 most common Chinese characters** by pronouncing them out loud. Answers are spoken, never typed. It runs entirely in your browser.

**▶ Live: https://bryanchen-d.github.io/hanzi-cards/**

- **Accounts**: sign up / log in. Each account's progress is saved separately, **in this browser on this device only** (see [Where your data lives](#where-your-data-lives)).
- **Practice sessions**: one character card per turn. Before you answer, the card shows only the character: no pinyin, meaning or audio. Tap the mic once and say it.
  - ✓ **Correct**: as soon as the app hears the right pronunciation, it stops listening and shows a check mark with a "pass" sound. You don't need to press stop.
  - ✗ **Wrong**: if nothing you say matches within the time limit (**10 seconds** by default, adjustable to 5–20 s on the dashboard), the turn ends with a cross and a "wrong" sound, and the correct pronunciation is played.
  - After each answer the card shows the pinyin and meaning, and 🔊 replays the sound.
  - A tiny panda crawls along the blue progress bar as you work through the session. It holds still if your system asks for reduced motion.
- **Spaced repetition**: every answer is recorded per character. The next card depends on your history. Missed and weak characters come back sooner, mastered ones less often, and new characters are mixed in gradually.
- **Deck**: 3,000 characters (see [Character data](#character-data)). A curated beginner set of 160 (HSK 1–2: numbers, pronouns, everyday words) comes first, then the rest from most to least frequent.
- **Dashboard**: characters seen and mastered, accuracy, reviews due, a colour-coded grid of the characters you've practised, the next ones coming up, and recent sessions.

## Use it

Open **https://bryanchen-d.github.io/hanzi-cards/** in **Chrome, Edge or Safari** (desktop, Android or iOS). Create an account and press **Start practice**. The first time you tap the mic, the browser asks for microphone permission. Firefox has no speech recognition, so the app explains which browser to use instead.

## Run it locally

Requires Node.js 20 or newer. Node is only used to fetch dependencies, run tests and serve the files.

```bash
npm install   # also copies pinyin-pro into public/vendor/
npm start
```

Then open **http://localhost:3000**. The preview server also serves the site at `/hanzi-cards/`, the same path as GitHub Pages. `PORT` and `HOST` change where it listens, and `npm run dev` restarts it when files change.

`public/` is a plain static site with no bundler. Any static file server works once `npm install` (or `npm run build`) has created `public/vendor/`.

## Tests

```bash
npm test
```

The tests cover:
- pinyin parsing and pronunciation checking, including polyphones (`test/checker.test.js`)
- spaced-repetition scheduling (`test/scheduler.test.js`)
- the deck and the in-browser backend (`test/backend.test.js`): 3,000 unique characters with readings and meanings, password hashing, register/login/logout, per-user isolation, persistence across page loads, carry-over of earlier progress, a full practice session, live checks and timeouts

## Deployment

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs on every push to `main`. It installs dependencies (which vendors pinyin-pro), runs the tests, and publishes `public/` to GitHub Pages.

## How it works

Everything runs in the browser. [`public/js/lib/backend.js`](public/js/lib/backend.js) offers the async API the UI calls: register, login, stats, sessions, next card, check and answer. It stores its data in `localStorage` and uses the same checker and scheduler modules that the Node tests exercise.

### Pronunciation checking

The browser's speech recogniser (`lang = zh-CN`, continuous with interim results) turns what you say into Chinese text, asking for up to ten alternatives per phrase (most browsers return fewer). Every interim and final result, with all its alternatives, is kept for the whole turn and checked right away, so a match is never lost when the recogniser later revises its guess. Live checks record nothing, and the turn ends as correct the moment one matches. Browsers stop recognition by themselves after a pause, so the app restarts it until the time limit. When time runs out, everything heard is submitted and recorded as a wrong answer, unless it matches after all.

[`public/js/lib/checker.js`](public/js/lib/checker.js) accepts an answer if any alternative:

1. contains the target character, or
2. contains a **homophone** of any of the character's standard readings, using [`pinyin-pro`](https://github.com/zh-lx/pinyin-pro) to read the transcript. For example, saying "tā" for 他 is accepted even if the recogniser writes 她. For a polyphone like 行 (xíng / háng), either reading counts.

How close the sound has to be depends on the **Matching** setting on the dashboard:

| Level | Accepts |
|---|---|
| Strict | the same syllable with the same tone |
| Normal | the same syllable with any tone |
| **Relaxed** (default) | any tone, plus sounds that regional accents commonly merge: initials z/zh, c/ch, s/sh, n/l, r/l and f/h; finals an/ang, en/eng, in/ing, ian/iang and uan/uang |

The character itself always passes, at every level. The checker picks the strictest match it finds. When a pass relied on leniency, the feedback says so gently, for example "Counted! It sounded like shān, close to the standard sān". In stricter levels, near misses get a hint instead. The setting is saved per device. The old "Ignore tones" checkbox was off by default, so everyone now starts on Relaxed.

The checker also maps digits the recogniser returns ("8" → 八). Latin-letter transcripts are ignored, because answers are spoken.

After you answer, the card shows the main reading, any other standard readings ("also …") and a short English gloss.

## Character data

The deck lives in [`public/js/lib/deck-data.js`](public/js/lib/deck-data.js), a compact generated module (113 KB, about 58 KB gzipped). [`scripts/build_deck.py`](scripts/build_deck.py) builds it like this:

1. **Character set**: level 1 of the 2013 *Table of General Standard Chinese Characters* (通用规范汉字表), which lists the 3,500 most common characters. It comes from the Unicode Han Database (Unihan) field `kTGH`.
2. **Order**: the curated beginner deck in [`scripts/data/starter.tsv`](scripts/data/starter.tsv) comes first. The rest follow by frequency, cut off at 3,000 characters in total. A character's frequency is the summed frequency of the Chinese words that contain it, from [wordfreq](https://github.com/rspeer/wordfreq). wordfreq includes SUBTLEX-CH, Google Books Ngrams, OpenSubtitles and Wikipedia.
3. **Readings**: Unihan `kTGHZ2013`, the standard readings from 通用规范汉字字典. `kMandarin`, the most customary reading, is shown as the main one. Every standard reading is accepted when you speak.
4. **Meanings**: Unihan `kDefinition`, trimmed to the first senses. Radical numbers and bare "surname" senses are dropped. The 160 starter characters keep hand-written meanings.

To rebuild it:

```bash
python3 -m venv .venv && .venv/bin/pip install wordfreq
.venv/bin/python scripts/build_deck.py      # downloads Unihan.zip into .cache/ on first run
```

**License**: the generated deck data is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It credits wordfreq (Robyn Speer, CC BY-SA 4.0) and SUBTLEX-CH (Cai & Brysbaert, 2010), and it includes Unihan data under the Unicode License v3. The full notices are in [`DATA-LICENSE.md`](DATA-LICENSE.md) and at the top of `deck-data.js`, and the app credits the sources on the dashboard. Progress is keyed by character, so earlier progress carries over to the larger deck.

### Scheduling

[`public/js/lib/scheduler.js`](public/js/lib/scheduler.js) uses Leitner boxes:

| Box | 1 | 2 | 3 | 4 | 5 (mastered) | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Next review | 1 min | 10 min | 1 day | 3 days | 7 days | 21 days | 60 days |

- A correct answer moves the card up one box. A wrong answer sends it back to box 1, due again right away.
- The next card is the weakest **due** card (lowest box, then highest error rate). There's a 30% chance of introducing a **new** card instead, as long as fewer than 4 cards are in early learning.
- If nothing is due, the soonest-due card is reviewed early.
- The last 3 cards shown are skipped, so the same character doesn't appear twice in a row.

### Where your data lives

- Accounts and progress are stored in the browser's `localStorage` under keys starting with `hanzi-cards:v1:`. Each account has a single JSON document with its per-character progress, sessions and recent attempts.
- Nothing is sent to a server, so there is **no sync**. Another browser, another device or a private window starts empty. Clearing this site's data deletes all accounts and progress.
- Passwords are hashed with PBKDF2-SHA-256 (Web Crypto, 210,000 iterations, random salt). The password itself is never stored. Anyone who can use this browser profile can still read the stored progress, so treat the login as a way to keep learners apart, not as security.
- If the browser blocks storage (some private modes), the app warns that progress lasts only until the tab closes.

### Other details

- **Correct pronunciation** is played with the browser's `speechSynthesis` using a zh-CN voice.
- **Sound effects** are synthesised with the Web Audio API, so the app ships no audio files.

## Project layout

```
public/                 the static site (deployed as-is)
  index.html            import map for pinyin-pro, relative asset paths
  styles.css
  js/main.js            views and session flow
  js/api.js             wires the UI to the in-browser backend
  js/speech.js          continuous speech recognition with deadline
  js/tts.js             text-to-speech playback
  js/sounds.js          pass / fail / complete sound effects
  js/lib/backend.js     accounts, progress, sessions (localStorage + Web Crypto)
  js/lib/checker.js     pronunciation / answer checking
  js/lib/pinyin.js      pinyin syllable parsing (tone marks, tone numbers, ü)
  js/lib/scheduler.js   spaced-repetition logic
  js/lib/characters.js  parses the deck
  js/lib/deck-data.js   generated 3,000-character deck (CC BY-SA 4.0)
  vendor/               generated by npm install (git-ignored)
scripts/vendor.mjs      copies pinyin-pro's ES module build into public/vendor/
scripts/build_deck.py   regenerates deck-data.js from Unihan + wordfreq
scripts/data/starter.tsv  curated beginner deck (shown first)
DATA-LICENSE.md         licenses and credits for the character data
server/index.js         local static preview server
test/                   node:test suites
```

## Limitations

- **Device-only progress**: see [Where your data lives](#where-your-data-lives). There's no cloud sync, and no export yet.
- **Voice only**: there is no typing. Speech recognition works in Chrome, Edge and Safari, but not in Firefox, where **Start practice** is disabled and a message says which browsers work. If the microphone is blocked, the app shows how to allow it.
- **Online recognition**: Chrome and Edge send the audio to their cloud speech service, so speaking practice needs an internet connection. Safari may need Siri/Dictation enabled.
- **Secure context**: the microphone and Web Crypto work only on `https://` (such as GitHub Pages) or `http://localhost`.
- **Tones**: the check relies on what the recogniser *thinks* you said. It works well for clear speech, but it is not a phonetic tone analyser. Single syllables are sometimes misheard, and the recogniser's language model can "fix" a wrong tone into the right character.
- **Leniency trade-off**: Relaxed matching, plus checking everything heard during the time limit, makes false passes a little more likely. Mumbling several syllables, or a near-sound like sì for shì, can be counted as correct. Choose **Normal** or **Strict** on the dashboard for tougher checking.
- **Multiple readings**: any standard reading is accepted, so the check can't tell whether you used the right reading for a particular word.
- **Meanings**: the English glosses for characters beyond the starter deck are brief dictionary definitions from Unihan. A few are archaic or unhelpful (for example 范 "bee-like insect").
- **Rarer characters**: recognisers do best with common syllables. For rarer characters they often write a more common homophone, which still counts.
- **Voices**: playback quality depends on the Chinese voices your OS or browser provides. If none is installed, the dashboard shows a warning.
