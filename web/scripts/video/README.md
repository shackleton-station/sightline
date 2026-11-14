# The videos

Two videos of Sightline are recorded from the real site by `record.mjs`:

- **The walkthrough** (`sightline-walkthrough.mp4`, with a poster, WebVTT captions, WebVTT chapter
  marks and a list of its chapters): a chapter for each part of the screen, as long as it needs.
  Chapter one is Scout's tour as a visitor takes it, about 85 seconds. For How it works.
- **The demo** (`sightline-demo-30s.mp4`, with a poster and captions): the problem, the answer and
  one moment of proof in under 30 seconds, for the Space Apps submission. A video over 30 seconds is
  not eligible for Global Judging, so the recorder refuses to make one.

Nothing is filmed by hand and nothing is edited afterwards, so either can be made again whenever the
site or the words change.

**The narration is an AI-generated voice**: Google Cloud Text-to-Speech, the voice Scout speaks with
on the site (`en-US-Chirp3-HD-Leda`). Each video says so in a line under the picture for its whole
length, in a note at the top of its captions, and in the file's own description. Say the same
wherever a video is posted. There is no music. The picture is the site itself; what the video adds
is the pointer, rings round what is being talked about, the words being said, and a card at each end.

## What is here

| File | What it holds |
| --- | --- |
| `record.mjs` | The recorder: asks for the voice, drives the site in headless Chrome, writes the video, its captions, poster and list of steps, and measures the finished file. |
| `page.js` | Runs inside the page while it is recorded: a clock the recorder can hold, and the pointer, the rings and the cards. |
| `tutorial.json` | What the videos add: where the pointer and the camera go in each step, the demo's own words, the cards, the pauses, and the line about the voice. |

The first chapter's steps and words are not here. They are the tour's own, in
`web/src/sightline/tour.json`, which the page reads too, so the video and the tour on the site say
the same thing. Change the words there, not here. That chapter does not set the screen up itself
either: the pointer presses the tour's chip in the Moon view, the tour puts the screen in each
step's state and rings what the step is about, and the pointer presses Next at the end of each
step. The other chapters' words, and the demo's, are in `tutorial.json` (a chapter's `script`, and
`cuts.pitch.script`).

## Making the videos again

You need Google Chrome, `ffmpeg` (`brew install ffmpeg`), Node 22 or later, and `gcloud` signed in to
an account that may use Text-to-Speech in the team's Google Cloud project. From `web/`:

```bash
node scripts/video/record.mjs --project=clps-compute-6z1nc --chapter=tour
```

```bash
node scripts/video/record.mjs --join
```

```bash
node scripts/video/record.mjs --project=clps-compute-6z1nc --cut=pitch
```

The walkthrough is recorded a chapter at a time (`--chapter=<id>`, the ids are in `tutorial.json`),
each chapter its own take of the live site, and `--join` puts the chapters recorded so far together
in order: the picture and sound are copied as they are, the captions move to each chapter's place,
and the chapters are written three ways, as `sightline-walkthrough-chapters.vtt` for a player's
chapter list, in `sightline-walkthrough.json`, and inside the `.mp4`. So when one part of the screen
changes, only its chapter is recorded again. The tour chapter takes about eleven minutes to record
and the demo about four. Everything is written into `cache/video/<cut>/` (not committed): the
`.mp4`, the `.vtt`, a `-poster.jpg` and a `.json`. A run ends by printing what it measured, and
fails if the file is not 1920 by 1080 at 60 frames a second, if a frame stalled, or, for the demo,
if the file runs past 29.5 seconds.

Other ways to run it:

- `--stills` is a rehearsal: one picture a second and no video, to see where the pointer and the camera go.
- `--words` only speaks the words and prints how long each step takes.
- `--check=file.mp4` only measures a file that already exists (`--longest=30` also checks its length).
- `--base=http://localhost:5173` records a site running on this machine instead of the live one.
- `--tour=path` reads the tour's steps from another file. `--fps=30` records at half the frame rate.

The site serves the files from the assets bucket under `/media/`, by name (`docs/DEPLOY.md`, "The
demo video"). Upload without replacing anything that is there (`-n`); to replace a file, leave `-n`
out on purpose and say so. The CDN keeps a file for up to an hour.

```bash
gcloud storage cp -n ../cache/video/walkthrough/sightline-walkthrough.mp4 ../cache/video/walkthrough/sightline-walkthrough-poster.jpg ../cache/video/walkthrough/sightline-walkthrough.vtt ../cache/video/walkthrough/sightline-walkthrough-chapters.vtt ../cache/video/walkthrough/sightline-walkthrough.json ../cache/video/pitch/sightline-demo-30s.mp4 ../cache/video/pitch/sightline-demo-30s-poster.jpg ../cache/video/pitch/sightline-demo-30s.vtt gs://clps-compute-6z1nc-web-assets/media/
```

## How it records

- **Steady frames.** `page.js` gives the page a clock that follows real time while the page loads,
  then moves only when the recorder asks for the next frame: one sixtieth of a second at a time,
  for `performance.now`, `Date`, timers, `requestAnimationFrame` and CSS animations alike. Every
  frame is drawn in full before it is taken, however busy the machine is, so none is dropped or
  repeated. The one thing this changes: what arrives from the network during the recording arrives
  sooner in the video's time than it would for a visitor, because the video's clock runs slower
  than the wall's while frames are being taken.
- **No cut inside a take.** The demo is a single recording. Each chapter of the walkthrough is a
  single recording too, and the chapters are joined only at their cards, so no sentence and no
  movement is cut across.
- **Real use.** The pointer's moves and presses are real mouse events sent to the page, the wheel is
  the real wheel, and typing is real typing. One thing is set through the page's address, as a
  shared link sets it: the four scenarios the demo opens with, so its landing and figures are the
  same in every take. Every figure in the picture is the site's own.
- **The tour's chip.** In the Moon view the tour is offered as a chip beside Scout ("One-minute
  tour"). The pointer presses it as the opening card clears. If the chip is not there the run stops
  and says so.
- **The camera.** The site is drawn at twice its size, as on a dense laptop screen, and each frame
  is taken from the part of it the camera is on. So when the camera moves in on a control, up to
  twice as close, the picture is still sharp enough to read on a phone. The camera only glides: it
  never cuts.
- **The words on screen.** The band under the site shows the sentence being said, in type large
  enough for a phone, and under it the line about the voice and the site's address. The band is
  outside the site's picture, so it never covers a control. The same sentences are in the `.vtt`,
  one cue each, timed from the voice clips themselves (the quiet between two sentences is found in
  the clip).
- **The voice** is asked from this machine, one request for each step's words, and kept in
  `cache/video/voice/`, so a second run with the same words asks for nothing. It never goes through
  the site's own voice route, which has a daily allowance for visitors. Chirp 3: HD voices cost
  US$30 for a million characters after the first million each month (Google's price list, read on
  2026-11-14); the tour chapter's words are about 900 characters and the demo's about 400, so recording
  both costs under five cents at most. The demo's voice runs at 1.07 times its usual pace, set in
  `tutorial.json`, to fit its words in 29 seconds.
- **Nothing is asked of Scout.** While recording, whatever the page sends to `/api/chat`, `/api/ask`
  or `/api/speak` is stopped in the browser, so a recording spends none of the visitors' daily
  questions. `--ask` lets them through, for a take that is meant to show a real answer.
