## What this is

- [ ] Catalog entry (an agent added or updated in `mods/more-agents/catalog.js`)
- [ ] Code change (mod, scripts, docs)

## Catalog entry

- [ ] `source` links the page where `run` (and `continue`, if present) is documented
- [ ] `checked` is the date I verified it (`YYYY-MM-DD`) and `tier` is `official` or `community`
- [ ] No invented commands: `run`, `continue` and `install` are copied from that documentation
- [ ] `install` is one of the shapes the validator accepts (no `sudo`, no `;`, no `http://`)
- [ ] `node scripts/validate-catalog.mjs` passes
- [ ] `node scripts/check-links.mjs` passes (drop `--offline` to probe the URLs)
- [ ] I added the agent in Herdr and it starts (say how below)

## Code change

- [ ] `node scripts/smoke-test.mjs` passes
- [ ] `node scripts/check-syntax.mjs` passes
- [ ] `herdr-app check mods/more-agents` passes
- [ ] New or changed user-visible text exists in English and Spanish (`mods/more-agents/copy.js`)
- [ ] `CHANGELOG.md` has a line under "Unreleased"

## Notes for the reviewer

<!-- How you tested it, and anything that is still unverified. -->
