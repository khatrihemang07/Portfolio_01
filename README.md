# Portfolio

The personal site of Hemang Khatri: one static page with a Hero, the Work section (a Project Block with an image Gallery for each of Mnemora, Markuli and localAIWrapper), About and Contact. Built with Astro and hosted on Cloudflare (a Workers static-assets deployment) at https://me.hemangkhatri.workers.dev.

Terms (Site, Project Block, Gallery, Dock, Ruler and others) are defined in `GLOSSARY.md`.

## Commands

Install with pnpm (see `.nvmrc` for the Node version).

| Command            | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `pnpm dev`         | Local dev server                                                        |
| `pnpm build`       | Production build into `dist/`, then writes `dist/_headers`              |
| `pnpm verify`      | Type check, lint, build and tests. Run before every push                |
| `pnpm test`        | Build-gate tests against the built `dist/`                              |
| `pnpm check:links` | Checks every link on the built home page (needs network, run on demand) |

## Cloudflare setup (one time)

The site is a Cloudflare Workers project with static assets (`wrangler.jsonc`), named `me`, built from this repository by Workers Builds. Every push to `main` builds and deploys it.

1. In the Cloudflare dashboard, create the Worker from the GitHub repository (Workers & Pages, Import a repository). The Worker name must be `me` to match `wrangler.jsonc`.
2. Build settings:
   - Build command: `pnpm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
3. Build variables (Settings, Build, Variables): set `PNPM_VERSION` to the version in `package.json` (`packageManager`, currently `11.20.0`). Cloudflare's build image defaults to pnpm 9, which cannot read this repo's `pnpm-workspace.yaml`. Node comes from `.nvmrc` (`22.23.4`).
4. The live address is `https://me.hemangkhatri.workers.dev`. The same address is set as `site` in `astro.config.mjs` and in `public/robots.txt`; change all three together if a custom domain is added.
5. Analytics: open **Web Analytics** for the account and enable it. Cloudflare then injects its own beacon. The beacon is cookieless, so there is no consent banner. The code contains no analytics snippet or token on purpose. The Content-Security-Policy already allows the beacon hosts (`static.cloudflareinsights.com` and `cloudflareinsights.com`).

## Headers are generated at build time

`scripts/write-headers.mjs` runs after `astro build` and writes `dist/_headers`. It sets:

- long, immutable caching for hashed assets under `/_astro/*`,
- short caching with revalidation for HTML,
- `nosniff`, `X-Frame-Options: DENY`, a referrer policy and a permissions policy,
- a strict Content-Security-Policy.

The CSP lists the SHA-256 hash of every inline `<script>` and `<style>` in every built HTML file. Those hashes only exist after the build, which is why the file is generated rather than kept by hand. If you add an inline script or style, nothing needs editing: the next build hashes it. The tests fail if any inline block is missing from the CSP.

Inline `style="..."` attributes are allowed by `style-src-attr 'unsafe-inline'`. The tiles use `style="--i: N"` for the staggered load-in, and an attribute cannot be hashed. Scripts never get `unsafe-inline`.

## Release checklist

Run `pnpm verify`, then check the preview URL before merging to `main`.

- [ ] `pnpm verify` passes on the branch
- [ ] Every Fact (four per Project Block) has its recorded source checked, and the Showcase Images in each Gallery are the real app with Demo Data
- [ ] `pnpm check:links` has no failures (warnings from github.com are rate limits and are acceptable)
- [ ] Keyboard only: skip link, Dock, Ruler, theme toggle, copy button and every link reach focus with a visible ring
- [ ] Both themes: light and dark, from the system and from the toggle
- [ ] Phone width: layout has no horizontal scroll, the Ruler is hidden, the Dock works with a thumb
- [ ] Reduced motion: the load-in, hover lift, Dock highlight and Ruler ticks stop moving
- [ ] Preview URL: the response headers include the Content-Security-Policy and `Cache-Control` as expected (`curl -I <preview-url>`), and the Dock, Ruler, theme toggle, copy action and analytics still work with the CSP applied
- [ ] Lighthouse on the preview: Performance, Accessibility and SEO at 100 (not run by the repository, run by hand)
- [ ] Copy changes are approved by the owner
