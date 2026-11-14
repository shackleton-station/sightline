# Problem paragraph (draft for Jessica)

> **Status:** AI-assisted first draft, for Jessica to rewrite in her own voice. Needs one engineer's accuracy
> check (issue #18). This is practice for the demo; the real pitch is written for the Nov 14 submission.

## The paragraph

When a lunar mission slips, planners face a deceptively hard question: is the landing site still viable on the
new date? At the Moon's south pole, the Sun circles near the horizon, so low ridges decide when there's power and
when Earth is in view, and a short delay can change the answer completely. Tools that hold this information
exist, but they're built for specialists, and checking one site on one date can mean navigating several
interfaces and raw data. **Lunar Landing Site Navigator** puts it on one page, for mission planners, educators and
anyone curious about why the Moon is so hard to land on. Pick a site and a date to see the Sun and Earth against
the real terrain horizon, how long until sunset or Earthset, and when landing windows open, then compare any two
options side by side.

## A shorter version, for the project page's first line

See when a lunar landing site has power and a line to Earth, and what happens to both when the date slips.

## The example to use

These come from the app, with **example** limits: a 14-day mission that can go 72 hours without Sun or Earth, with
both up at landing.

| Site | 2027 landing windows |
| --- | --- |
| Connecting Ridge | Through March 9, then none until June 21 |
| Peak near Shackleton | Opens April 1, while Connecting Ridge is closed |

A second example, for "small changes have large impacts": in our model, moving about 220 m along Connecting Ridge
drops May 2027 sunlight from 60% to 40%.
[First point](https://shackletonstation.dev/#a=-89.45267,-137.14865@2027-05&t=0&limits=14_72_72_1_1),
[second point](https://shackletonstation.dev/#a=-89.46,-137.2@2027-05&t=0&limits=14_72_72_1_1).
This depends on 20 m terrain on a ridge top, where our model is least certain, so say "in our model".

## Claims to keep accurate

| Safe to say | Avoid |
| --- | --- |
| "In our model" or "using these example limits" | Presenting the example limits as a real mission's requirements |
| Sun and Earth positions match JPL Horizons | "Validated by NASA" or "NASA-approved" |
| At sites away from ridges, we match NASA's maps within 3.5 points | Quoting one ridge's percentage as fact: our ridge Sun values run 3–24 points above NASA's map |
| Sites come from published NASA and LROC coordinates | Suggesting NASA or any agency endorses the tool |

Details: [`docs/VALIDATION.md`](../VALIDATION.md).

## Who this is for

- **Mission planners** reassessing a site or date after a delay.
- **Educators and the public** curious why the south pole is so much harder than where Apollo landed.
