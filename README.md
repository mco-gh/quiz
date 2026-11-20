# Quiz

A live trivia quiz for a room full of people, in the browser at [mco.dev/quiz](https://mco.dev/quiz/). The host picks a topic, Claude writes the questions, and everyone plays on their phone while the big screen shows the questions, the answers and the leaderboard. It works in English, French, Spanish and German.

It is a peer-to-peer successor to [Quizaic](https://github.com/mco-gh/quizaic), which ran on Google Cloud Run. Here there is no server: the host's browser is the game server.

It is a static app with no build step: open `index.html` from any web server. It is made of plain HTML, CSS and JavaScript modules.

## How it works

- **Connections.** Every player's browser connects straight to the host's browser over a WebRTC data channel, in a star. Players never connect to each other. [PeerJS](https://peerjs.com/) (vendored in `vendor/`) uses its public broker only to introduce the browsers to each other. `net.js` holds all of this.
- **The host's browser runs the game.** `host.js` keeps the questions, the answers, the clock and the scores. Each phone receives one question at a time, without its answer, then learns how it did. Answers are timed by the host's clock, so a tampered phone can't see the right answer early or claim to have answered faster. A player who reloads or drops out rejoins with the same code and gets their name and score back.
- **Two ways to play**, as in Quizaic:
  - *Together, live*: everyone sees each question at the same moment, and the host moves the game along from the big screen.
  - *At their own pace*: each player starts when they join, and the host's screen shows everyone's progress live.
- **Scoring.** A right answer is worth 500 to 1000 points, depending on how quickly it came in. Answering several right in a row adds a streak bonus.
- **Writing quizzes with AI.** `ai.js` calls Anthropic's Claude (`claude-opus-5-5`) directly from the host's browser, using the host's own API key. The key is stored only in that browser and sent only to Anthropic. Players don't need a key. The prompt descends from Quizaic's, and the reply comes back as structured JSON.
- **Checking the answers.** This optional step follows Quizaic's accuracy work. Each question is split into one statement per answer, all the statements are shuffled together, and Claude judges each one on its own. Questions whose verdicts disagree with the quiz are flagged in the editor, where the host can fix or replace them.
- **Quizzes stay in the browser.** They are saved in `localStorage`, and the host can export and import them as JSON files. A first visit starts with a sample quiz in the visitor's language, so the app can be tried without a key.

The Anthropic SDK is bundled into `vendor/anthropic.js`, so the page never loads code from a CDN. It is only downloaded when the host first asks for a quiz. To rebuild it after upgrading, run this in `build/`:

```bash
npm install && npm run build
```

This repo is mounted in [mco-gh/mco.dev](https://github.com/mco-gh/mco.dev) as a git submodule at `static/quiz`. After pushing a change here, update the submodule pointer there to publish it:

```bash
cd mco.dev
git submodule update --remote static/quiz
git commit -am "Update quiz"
git push
```

## Languages

The interface text lives in `languages/`, one file per language. To add a language, copy `en.js`, translate it, and register it in `languages/index.js`. The sample quizzes are in `samples.js`.

## Install on a phone

The app is an installable web app: `manifest.webmanifest` describes it, and `sw.js` is a network-first service worker, so it is always current when online and still opens offline. Nothing needs bumping on release. The icons in `icons/` are rendered from the SVG sources by `bash build/icons/render.sh` (needs Google Chrome).

## Connecting through firewalls

Two browsers usually connect directly, with help from a public STUN server. When they can't (mobile data, strict routers, browsers that block local connections), a TURN relay carries the traffic. `ice.js` fetches short-lived relay credentials from `/api/turn`, a Netlify Function in the mco.dev repo that asks Cloudflare for them. If that isn't available, it falls back to STUN only.
