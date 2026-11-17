AI usage in Sightline

Building it: nearly all the code, tests, Terraform and docs were written by Claude Code (with Claude sub-agents on the bigger pieces). I set direction, reviewed, and made the calls.
In the app: Scout, the co-pilot, is Claude Opus 5.5. It only picks settings and calls the app’s own calculation tools, so it never makes up numbers. Its voice is Google Cloud Text-to-Speech.
Not AI: every number on screen comes from our pipeline (NASA SPICE ephemeris and LOLA terrain), checked against JPL Horizons, NASA’s PGDA maps and LROC photos.
AI-made media: Scout’s icon, the demo narration, each labelled as AI in the app.

Since the event (one line per task, all Claude Code):
- 2026-11-17: the front page says how the Moon is moved (one line that goes after the first drag, zoom or click), and Scout's tour has a step that turns and zooms the Moon itself; its spoken line is AI-generated voice like the others.
