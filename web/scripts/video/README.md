# The tutorial video

Two videos of Sightline are recorded from the real site by `record.mjs`: the narrated tutorial
(`sightline-tutorial.mp4`, with its poster and WebVTT captions) and a cut of it that runs under
30 seconds for the Space Apps submission (`sightline-30s.mp4`). Nothing is filmed by hand and nothing
is edited afterwards, so either can be made again whenever the site or the tour's words change.

**The narration is an AI-generated voice**: Google Cloud Text-to-Speech, the voice Scout speaks with
on the site (`en-US-Chirp3-HD-Leda`). Each video says so in a line under the picture for its whole
length, in a note at the top of its captions, and in the file's own description. Say the same
wherever a video is posted. There is no music, and nothing in the picture but the site itself, the
pointer, and rings round what is being talked about.

## What is here

| File | What it holds |
| --- | --- |
| `record.mjs` | The recorder: asks for the voice, drives the site in headless Chrome, writes the video, its captions, poster and a list of its steps, and measures the finished file. |
| `page.js` | Runs inside the page while it is recorded: a clock the recorder can hold, and the pointer and rings. |
| `tutorial.json` | What the video adds to the tour: where the pointer goes in each step, which sentences the short cut keeps, the pauses, and the line about the voice. |

The steps and their words are not here. They are the tour's own, in `web/src/sightline/tour.json`,
which the page reads too, so the video and the tour on the site say the same thing. Change the
words there, not here.

## Making the videos again

You need Google Chrome, `ffmpeg` (`brew install ffmpeg`), Node 22 or later, and `gcloud` signed in to
an account that may use Text-to-Speech in the team's Google Cloud project. From `web/`:

```bash
node scripts/video/record.mjs --project=clps-compute-6z1nc
```

```bash
node scripts/video/record.mjs --project=clps-compute-6z1nc --cut=short
```

Each run takes five to ten minutes and writes into `cache/video/<cut>/` (not committed): the `.mp4`,
the `.vtt`, a `-poster.jpg` for the full cut, and a `.json` listing each step with the second it
starts. It ends by printing what it measured and fails if the file is not 1920 by 1080 at 30 frames
a second, if a frame stalled, or, for the short cut, if the file runs past 29.5 seconds.

Other ways to run it:

- `--stills` is a rehearsal: one picture a second and no video, to see where the pointer goes.
- `--check=file.mp4` only measures a file that already exists.
- `--base=http://localhost:5173` records a site running on this machine instead of the live one.
- `--tour=path` reads the tour's steps from another file.

The site's copies go in the assets bucket, uploaded without replacing anything that is there (`-n`);
if a file must be replaced, do that on purpose and say so:

```bash
gcloud storage cp -n ../cache/video/full/sightline-tutorial.mp4 ../cache/video/full/sightline-tutorial-poster.jpg ../cache/video/full/sightline-tutorial.vtt ../cache/video/full/sightline-tutorial.json ../cache/video/short/sightline-30s.mp4 gs://<the assets bucket>/video/
```

A visitor can fetch a file from the bucket only if the load balancer has been told its name: it
serves the tiles' folders and the media files that `infra/assets.tf` lists one by one
(`media_files`, under `/media/`), and nothing else in the bucket. Before the videos can be played
from the site, their names and their path have to be added there, through the usual Terraform pull
request.

## How it records

- **Steady frames.** `page.js` gives the page a clock that follows real time while the page loads,
  then moves only when the recorder asks for the next frame: one thirtieth of a second at a time,
  for `performance.now`, `Date`, timers, `requestAnimationFrame` and CSS animations alike. Every
  frame is drawn in full before it is taken, however busy the machine is, so none is dropped or
  repeated. The one thing this changes: what arrives from the network during the recording arrives
  sooner in the video's time than it would for a visitor, because the video's clock runs slower
  than the wall's while frames are being taken.
- **One take.** The video is a single recording with no cuts, so no sentence is cut across. The
  short cut is its own take with fewer sentences, not an edit of the long one.
- **Real use.** The pointer's moves and presses are real mouse events sent to the page, and typing
  is real typing. The one exception is the plan the tour starts from, which is set through the
  page's address, as the tour itself sets it.
- **The voice** is asked from this machine, one request for each step's words, and kept in
  `cache/video/voice/`, so a second run with the same words asks for nothing. It never goes through
  the site's own voice route, which has a daily allowance for visitors. Chirp 3: HD voices cost
  US$30 for a million characters after the first million each month (Google's price list, read on
  2026-11-14); the tutorial's words are about 900 characters, so a full recording costs under
  three cents at most.
- **Nothing is asked of Scout.** While recording, whatever the page sends to `/api/chat`, `/api/ask`
  or `/api/speak` is stopped in the browser, so a recording spends none of the visitors' daily
  questions. `--ask` lets them through, for a take that is meant to show a real answer.
- **Captions** are WebVTT, one cue for each sentence, timed from the voice clips themselves (the
  quiet between two sentences is found in the clip). The same captions are inside the `.mp4` as a
  subtitle track that players can switch on.
