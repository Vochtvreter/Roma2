# Castra Valeria — a Roman idle city-builder

It is the Kalends of April, AUC 800. Twenty-four souls of six legionary families pitch their tents inside a fresh
earth-and-timber rampart on a river bend at the frontier, and you are the *Praefectus castrorum*. Lay out blocks,
wells, granaries, shrines and fields yourself, or leave it to the **Ordo Decurionum**, the council that staffs, builds
and trades every day (even while you are away) and always says *why*. Grow from **Castra** to **Colonia**, watch tents
become *insulae* and atrium *domus*, and dedicate the **Capitolium**.

**Play:** <https://vochtvreter.github.io/Roma2/> *(placeholder until the first Pages deploy)*

## Scripts

| Command | What it does |
|---|---|
| `npm install` | install dependencies (use `npm ci` in CI) |
| `npm run dev` | Vite dev server with hot reload (add `?dev` to the URL for debug helpers) |
| `npm run build` | typecheck, then build the static site into `dist/` |
| `npm run preview` | serve the built `dist/` locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | run the Vitest suite |
| `npm run balance` | full balance-bot run (`BAL_FULL=1`), verbose |
| `npm run trace` | print a deterministic simulation trace, verbose |

## Deploying to GitHub Pages

The workflow `.github/workflows/deploy.yml` builds and publishes the site on every push to `main` (or the default
branch), and can also be run by hand. One-time setup in the repository:

**Settings → Pages → Source = GitHub Actions**

With "Deploy from a branch" Pages serves the raw `index.html` and `/src/main.ts` 404s. The build uses a relative base
(`./`), so it works from any Pages sub-path.

Everything is static and client-only: no server, no network calls at runtime, saves live in `localStorage` (with text
export/import), every sprite is drawn in code and every sound is synthesized.

## Credits

- Idea and calendar from the author's *rome* prototype.
- Engine techniques, code-drawn sprites and UI construction from the author's *IdleSettlement* (*Hearthlands*).
- Fonts: Pixelify Sans and Silkscreen (SIL Open Font License), bundled via @fontsource.
