# Lessons from Demo #1

Measured on 2026-11-02 and 2026-11-03.

## Data and compute

| Question | Answer |
| --- | --- |
| DEM product | `LDEM_80S_20MPP_ADJ.TIF`, 20 m/px, 2.70 GB, 14 min at ~3.4 MB/s |
| Horizon compute | 0.2 s per mask, once the terrain is in memory |
| Full pipeline | ~3 min and 3.3 GB; ~170 s of that is the 80-pixel validation |
| Kernels | `naif0012.tls`, `de440s.bsp`, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `pck00011.tpc` |
| Frame check | Sun and Earth az/el match JPL Horizons to 0.00001° |
| PGDA agreement | Earth: 0.6 points at the site. Sun: 2.5 points typical across 80 pixels, but +17.4 at our site. See `VALIDATION.md`. |

**Precompute vs on demand, N sites × 1 year:** precompute. Without validation, each site takes seconds once
the DEM is loaded. A year of hourly rows at the current ~180 bytes each is about 1.6 MB per site, close to our
2 MB-per-file limit, so plan on 2-hour steps or a more compact format for a year.

## Pending

- **Real-phone check** of the deployed site.

## Deploy

Under a minute of commands once logged in (build plus deploy took 18 s). The surprise cost more:
`wrangler pages project create` handed off to Workers setup, edited four repo files, and deployed a Worker.
For Nov 14: commit a minimal `wrangler.jsonc` first, deploy with `wrangler deploy`, and never run setup
commands on a dirty tree.

## Agent and Git friction

- `PROGRESS.md` went stale for weeks and misled the next session. Update it in the same PR as the work.
- No conflicts, since only one person has worked in the repo so far. The multi-teammate workflow is
  **still untested**: invites haven't been sent.
- Agents can't read the challenge page (it's client-rendered). A human needs to paste it in on day one.

## Demo #2

- **Testing a second site changed the conclusion.** One site's Sun gap looked like a ridge quirk; four showed a
  pattern, and it exposed that a flat "too close" tolerance overstated site comparisons. On Nov 14, run the
  validation on several sites before writing any claim about accuracy.
- **Check data links early.** Of 27 published sites, only four had working region files.
- **Measure before building.** Short scripts showed that coarse terrain fails near the pole, and then that fine terrain
  only matters within a few km of a point. That removed a limit we'd assumed we had to live with.
- **Check surprising results.** One measurement showed finer terrain doing worse than coarser. That was a bug in the
  test script, not a finding.
- **Scenario = site + month** turned out to be the right unit: one comparison view covers both "other site" and
  "other date".

## Cesium: drop it for Nov 14 if shadows matter

- **Setup:** about 20 minutes, including the token. It rendered real terrain with no errors on the first try, and
  looked convincing.
- **Why we dropped it:** its shadows were wrong, and only a measurement showed it. They matched ray-traced terrain
  at 38.9% of 4,000 ground points, because the shadow map loses far casters at a low Sun. That's fatal near the
  poles, though it could be fine for a view that doesn't depend on shadows.
- **Bundle:** Cesium is over 5 MB of code plus 342 static files. Our renderer is 5.9 KB, gzipped.
- **Token hassle:** small. A token limited by address answers curl with 403 unless you send `Referer`, not just
  `Origin`, which looked like a bad token.
- **Phone:** Cesium wasn't tested on one. Our renderer drags smoothly on Rodrigo's phone, but went blank after a
  while. Phones can take the graphics context away at any time, so WebGL code must handle that from the start.
- **Lesson:** if you already have the data, a small custom shader can beat a big engine. And compare any picture
  with independent truth, with a deliberately wrong input as a control: both versions looked right.

## What we'd cut with only 36 hours

1. 3D view. The panorama answers the challenge's question without it, though it's the most striking shot.
2. The 18.6-year and 80-pixel validation **as code in the build**: run it once, keep the results.
3. Play button and light theme polish.

**What to build first, from testing the demo against the statement:** a plain answer on the first screen, then the grid of
every site and month, then the slip check. They use the same hourly flags, so one small file (`overview.json`, 6 KB
compressed) drives all three. A 3D view is striking but answers nothing they don't.

**Show a range wherever a site's number could be read as exact.** At ridges, a month's Sun varies by 20 to 68 points within 100 m. Compare
with LROC's map from real photos early: it's 6 MB and uses no terrain model. Dated photos are a sharper test, but look at the raw values first: ridge
pixels don't split cleanly into lit and dark, so report how a score moves with the line, and always run a control such as a Sun on the wrong side of the sky.

**Next, if there's time:** a map of nearby ground and a shortlist. Together they answer the statement's "alternative sites in the same
region", using the same terrain and positions. Measure against NASA's maps before showing a "best
spot": the top spots read up to 9 points high, and you should know that before someone asks.

Don't cut the Horizons and PGDA comparison itself: it found the site's Sun disagreement, and it's what makes
the numbers defensible.

## From the Google Cloud and Scout work (Nov 11 to 12)

**The Moon flickered because of one line, not the graphics library.** The globe's canvas rebuilt its whole renderer
whenever the page handed it a new callback, and the page handed it one on every render: 32 rebuilds in 150 frames.
Count what should happen once (renderers built, images loaded) before blaming or replacing a stack. A component that
owns something expensive should read its callbacks through a ref.

**Two of us fixed the same bug at the same time.** Misha moved the globe to Three.js while another branch fixed the
old renderer; the second had to be rebuilt on the first. On the weekend: pull `main` before starting and before
opening a pull request, and say in the channel which file you are in.

**A stepped rollout earns its keep, and its checks must not be flaky.** A deploy stopped because the one test question
got a "busy" reply from the model. Nobody saw a broken site, which is the point, but a busy model is not a broken site.
Anything that depends on a language model gets a retry before it can fail a deploy.

**Measure a stall twice, and alone.** A 2-second freeze turned out to be the screenshot taken just before the
measurement. Over 1,431 frames with nothing else going on, the worst was 50 ms.

**Cloud Run stops giving a server CPU when the response ends.** "Send it afterwards" (a log line to a queue, a trace)
can stall until the next visitor. Wait a moment for the send before closing the response, or pay for always-on CPU.

**A flat map of the Moon is useless at the poles.** It squeezes each pole into one row of pixels, which is exactly
where our sites are. Anything drawn near the pole needs a polar map (LOLA publishes them); plan for two map
projections from the start.

**The biggest model is not the best one for a chat.** We put the co-pilot's 12 set questions to four Gemini models.
The fast one we use passed 12 in about 5 s each; the two largest took about a minute per call and failed almost
all of them on time alone. Choose a model by running your own questions, with your own time limit. And don't run
such a test against the model the live site is using: it shares one quota, and ours answered "busy" for a while.

**A globe camera must not be "where it looks, with north up".** That has no answer at a pole, so a small drag there
swings the whole picture, and our sites are at a pole. Keep the camera's own orientation (the point in the middle
and which way is up), turn both together on a drag so the ground follows the finger, and ease back upright when
it is let go. Build this on day one; we rebuilt the camera twice.

**What carries over to the new repo in minutes:** the Terraform in `infra/` (run, bucket, load balancer, domain,
keyless deploys, monitoring), the stepped deploy workflow, and the rule that the model never types a number. The
access grants are applied by a person; leave ten minutes for that and for the certificate.

## From the Atlas (Nov 12)

**A map of every pixel is affordable, and worth more than a better picture of 13 points.** One horizon per pixel
for a million pixels took 31 minutes on a laptop once the inner loop was compiled (numba), with the same
sampling as a single site. After that every hour of four years is a lookup. Plan the per-pixel run on day one:
it turns "which sites did we list" into "any ground you tap".

**Store when things change, not what they are.** A pixel's month of Sun is a handful of on and off times. Kept
as those times, a month of a million pixels is 3.4 MB, sits whole on the graphics card, and moving time changes
one number. As a picture per hour it would be 744 uploads.

**Let a test read the real cells that matter.** Eight changes a month looked like plenty across the whole map:
0.02% of hours touched. A test on the four listed sites' own pixels failed at once: ridge tops, where a grazing
Sun comes and goes, need more, and they are the pixels people look at. Choose a limit by its effect on the cases
that matter, not on the average.

**Check the picture against the data, with a wrong picture as the control.** Reading 1.9 million pixels back
from screenshots took twenty minutes to write and found the drawn map right to 249 pixels. It also showed that a
map upside down still "agrees" 88% of the time, because most polar ground is dark: without the control, 88%
would have sounded fine.

**A design that needs the pole needs its own camera.** "North is up" has no meaning at the pole, and a camera
built on latitude and longitude turns a drag into a spin there. The Atlas keeps a point and an up direction, and
near the pole turns to the way polar maps are printed (0° longitude up).

**"Which way is up" cannot be smooth over a whole globe, so choose where it breaks.** North-up breaks at the
poles. Ours first broke along a line (180° longitude, between two latitudes), because it mixed two directions as
an angle; mixing them as arrows shrinks the break to one point. Then put that point where nobody looks: ours was
inside the map people came for, and a phone test showed the map turning upside-down after a drag.

**Try the gestures on a phone simulator, not only its layout.** `xcrun simctl` takes screenshots; the app's
simulator tool can swipe and tap. Emulated touch in headless Chrome never reached our page; real touches in the
simulator's Safari did, and found the upside-down turn above in two swipes.

**"Well-lit" means something else at another pixel size.** On the 120 m grid, the pixels NASA's map calls well-lit
are ridge tops. On the 300 m grid they are mostly open ground near 85° S that sees the Sun half the time, as a
smooth Moon would, so a model with no terrain beat ours there (RMSE 1.3 against 5.2). Look at which pixels a
subset holds before reading its score.

**A long run on a laptop needs mains power.** The wide grid's run drained the battery in the night and the laptop
slept for four hours with the work half done. Nothing was lost (the horizons are written once and the months
resume), but check the charger before starting anything that takes hours, or run it on the cloud VM.

## WebGPU or WebGL2 (Nov 12)

**Start the new app on WebGL2.** We drew this demo's Moon both ways and measured it (`/gpu/`,
`docs/SYSTEM_DESIGN.md` under "Measured"). WebGPU drew the same picture and was not smoother: one globe takes
well under a millisecond of processor time and one to two of graphics card time either way, out of the 16.7 a
screen gives, and WebGPU took a little more of both. What WebGPU would cost on the weekend is real: 80 kB more
JavaScript, shaders written in Three's node language instead of the GLSL everyone can find examples of, and a
slower fallback on the phones and browsers that don't have it yet (Firefox on Android, any iPhone not on iOS 26).
Newer is not faster for a scene this small. Look again only if the app needs thousands of objects or
calculations on the graphics card.

**A stand-in texture decides how the real one is read.** On WebGPU, Three writes the shader for the texture a
node holds when it is first drawn. Our 1×1 placeholder was a "nearest pixel" texture, so the real maps that
replaced it were read one pixel at a time, with no smoothing and no wrap-around: the whole Moon looked fine and
the pole had streaks and blocks. Comparing the two pictures pixel by pixel found it (3.7 brightness steps apart
on average, then 0.02 once the placeholder was a smoothed texture). When porting drawing code, compare pictures
with a number, not by eye, and in the hardest view.

## Saturday 9 AM plan

Checked against the challenge statement, but not its Resources tab.

1. Friday night: download the DEM, PGDA maps and kernels on two laptops.
2. 9:00: read the statement and Resources tab together; agree on the user and the sites. Jessica leads.
3. 9:30: create the new repo, CI, and an empty deployed page, so deploy is proven first.
4. 10:00: Pick sites from published sources only; settle the JSON contract before splitting up.
5. 10:30: pipeline and web split up and build against the contract, using a fake-data fixture in the UI.
6. 14:00: first real data in the UI, deployed.
7. 18:00: multi-site comparison.
8. Sunday 10:00: validation run; write down what we can and can't claim.
9. Sunday 14:00: feature freeze; Jessica records the demo.
10. Sunday 20:00: submit, well before the 23:59 deadline, with AI disclosure and references.
