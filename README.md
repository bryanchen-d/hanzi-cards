# Hanzi Cards

A Duolingo-style web app for learning Chinese characters by pronouncing them out loud.

- **Accounts**: sign up / log in. Your progress is saved per user.
- **Practice sessions**: one character card per turn. Before you answer, the card shows only the character: no pinyin, meaning or audio. Tap the mic once and say it.
  - ✓ **Correct**: as soon as the app hears the right pronunciation, it stops listening and shows a check mark with a "pass" sound. You don't need to press stop.
  - ✗ **Wrong**: if nothing you say matches within the time limit (**10 seconds** by default, adjustable to 5–20 s on the dashboard), the turn ends with a cross and a "wrong" sound, and the correct pronunciation is played.
  - After each answer the card shows the pinyin and meaning, and 🔊 replays the sound.
- **Spaced repetition**: every answer is recorded per character. The next card depends on your history. Missed and weak characters come back sooner, mastered ones less often, and new characters are mixed in gradually.
- **Dashboard**: characters seen and mastered, accuracy, reviews due, a colour-coded grid of all 160 starter characters (common HSK 1–2), and recent sessions.

## Requirements

- Node.js **22.13 or newer**. The app uses the built-in `node:sqlite` module, so no native build step is needed.
- A browser with the Web Speech API for speaking practice: **Chrome, Edge or Safari** (desktop, Android or iOS). Firefox has no speech recognition; there you can type the pinyin instead.

## Run it

```bash
npm install
npm start
```

Open **http://localhost:3000**, create an account, and press **Start practice**. The first time you tap the mic, the browser asks for microphone permission.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `localhost` | Interface to bind |
| `HANZI_DB` | `./data/hanzi.db` | SQLite database file (created automatically) |
| `SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS |

`npm run dev` restarts the server whenever files change.

## Tests

```bash
npm test
```

These cover pinyin parsing and pronunciation checking (`test/checker.test.js`), spaced-repetition scheduling (`test/scheduler.test.js`), and the HTTP API: password hashing, register/login/logout, per-user isolation, and a full practice session (`test/api.test.js`).

## How it works

### Pronunciation checking

The browser's speech recogniser (`lang = zh-CN`, continuous with interim results) turns what you say into Chinese text, returning up to five alternatives for each phrase. While you speak, each new result is sent to `POST /api/sessions/:id/check`. That check records nothing, and the turn ends as correct the moment it matches. Browsers stop recognition by themselves after a pause, so the app restarts it until the time limit. When time runs out, everything heard is submitted and recorded as a wrong answer, unless it matches after all. The server ([`server/checker.js`](server/checker.js)) accepts an answer if any alternative:

1. contains the target character, or
2. contains a **homophone** with the same pinyin, using [`pinyin-pro`](https://github.com/zh-lx/pinyin-pro). For example, saying "tā" for 他 is accepted even if the recogniser writes 她.

Tones must match by default. When only the tone differs, the feedback says so. Turn on **Ignore tones** on the dashboard for a more forgiving check. The checker also maps digits the recogniser returns ("8" → 八) and understands typed pinyin such as `ni3`, `nǐ` or `lv4`.

### Scheduling

[`server/scheduler.js`](server/scheduler.js) uses Leitner boxes:

| Box | 1 | 2 | 3 | 4 | 5 (mastered) | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Next review | 1 min | 10 min | 1 day | 3 days | 7 days | 21 days | 60 days |

- A correct answer moves the card up one box. A wrong answer sends it back to box 1, due again right away.
- The next card is the weakest **due** card (lowest box, then highest error rate). There's a 30% chance of introducing a **new** card instead, as long as fewer than 4 cards are in early learning.
- If nothing is due, the soonest-due card is reviewed early.
- The last 3 cards shown are skipped, so the same character doesn't appear twice in a row.

### Other details

- **Correct pronunciation** is played with the browser's `speechSynthesis` using a zh-CN voice.
- **Sound effects** are synthesised with the Web Audio API, so the app ships no audio files.
- **Auth**: passwords are hashed with scrypt (Node `crypto`, random salt). Sessions use random tokens stored hashed in SQLite and sent as `HttpOnly`, `SameSite=Lax` cookies.

## Project layout

```
server/
  index.js           start the HTTP server
  app.js             Express app and API routes
  auth.js            password hashing, credential validation, session tokens
  checker.js         pronunciation / answer checking
  pinyin.js          pinyin syllable parsing (tone marks, tone numbers, ü)
  scheduler.js       spaced-repetition logic
  db.js, store.js    SQLite schema, seeding and queries
  data/characters.js starter deck (160 characters, pinyin, meaning)
public/              static front end (no build step)
  index.html, styles.css
  js/main.js         views and session flow
  js/speech.js       speech recognition wrapper
  js/tts.js          text-to-speech playback
  js/sounds.js       pass / fail / complete sound effects
test/                node:test suites
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | `{username, password}` → creates an account and logs in |
| `POST` | `/api/auth/login` | `{username, password}` |
| `POST` | `/api/auth/logout` | |
| `GET` | `/api/auth/me` | current user, or `null` |
| `GET` | `/api/stats` | totals, per-character progress, recent sessions |
| `POST` | `/api/sessions` | `{size}` → starts a practice session (3–50 cards) |
| `GET` | `/api/sessions/:id/next` | the current card, or a summary when the session is done |
| `POST` | `/api/sessions/:id/check` | `{charId, transcripts[], ignoreTones?}` → `{correct, matchType}` for a live check while listening; nothing is recorded |
| `POST` | `/api/sessions/:id/answer` | `{charId, transcripts[], ignoreTones?, skipped?, timedOut?}` → result and updated progress |

## Limitations

- **Browser support**: speech recognition works in Chrome, Edge and Safari, but not in Firefox. Firefox users get the type-the-pinyin fallback.
- **Online recognition**: Chrome and Edge send the audio to their cloud speech service, so speaking practice needs an internet connection. Safari may need Siri/Dictation enabled.
- **Secure context**: the microphone works only on `https://` or `http://localhost`. To use the app from another device on your network, serve it over HTTPS.
- **Tones**: the check relies on what the recogniser *thinks* you said. It works well for clear speech, but it is not a phonetic tone analyser. Single syllables are sometimes misheard, and the recogniser's language model can "fix" a wrong tone into the right character. Use **Ignore tones** if strict checking gets frustrating.
- **Leniency while listening**: any matching syllable heard during the time limit counts. Saying many different syllables in a row can therefore hit a homophone by chance.
- **Multiple readings**: characters with several readings are taught with their most common one (for example 的 = de). Saying the character itself is always accepted.
- **Voices**: playback quality depends on the Chinese voices your OS or browser provides. If none is installed, the dashboard shows a warning.
