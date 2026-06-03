<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Read the architecture map first

Before exploring the codebase, read **`ARCHITECTURE.md`** — it maps the data flow,
key files, the recipe for adding a map layer, API-route conventions, env vars, the
branch/dev workflow, and known-dead upstreams. It exists so you don't re-read the
whole tree each session.

**Keep it current:** when you add or materially change code (a new route, layer,
panel, env var, convention, or you discover a dead upstream), update the relevant
section of `ARCHITECTURE.md` in the *same* commit. A stale map is worse than none.
