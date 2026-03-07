> [!CAUTION]
>
> **AI-generated code warning**
>
> This project was written entirely by [Claude](https://claude.ai). I do not condone the use of AI for coding, or for much else really, but I believe archival is important enough to warrant a degree of hypocrisy on my part. I am not a coder. Please read through the code and satisfy yourself that it does what it says before running it, especially anything that touches your filesystem or makes outbound network requests. Really keep in mind that everything outside of this block (documentation, scripts) is most likely written by AI, so don't believe it's doing exactly what it says is doing, this project was tested by me, on my machine, and my machine only. If you are a real coder, find anything that could be better and want to help, feel free to send a PR and I'll do my best to understand it.

---

# Bandcamp WACZ Archive Browser

A companion static site for [Bandcamp WACZ Archiver](https://github.com/Bandcamp-Web-Archive/bandcamp-wacz-archiver). It reads the `artists/` JSON files produced by the archiver and turns them into a fast, filterable web interface for browsing your followed Bandcamp artists and their releases — with live archive pipeline status for each one.

Deployable to GitHub Pages with no server, no database, and no build step beyond Jekyll.

---

## How It Fits Together

The archiver maintains one JSON file per artist under `artists/`. Each release in that file carries state flags — `archived`, `uploaded`, `ia_identifier` — that the archiver writes and updates as it works. This site reads those same files directly and surfaces that state as status badges: **ARCHIVED** (linked to the archive.org item), **QUEUED**, or **PENDING**.

```
bandcamp-wacz-archiver/
└── artists/
    └── Some Artist [band_id]/
        └── Some Artist [band_id].json   ← archiver writes this
```

The simplest setup is to point both repos at the same `artists/` folder, or to symlink / copy it. Whenever the archiver updates a release's status, rebuilding this Jekyll site reflects the change.

---

## Features

- **Instant search** across artist names, album titles, and tags
- **Tag filter bar** — click any tag to narrow the full catalog
- **Artist quick-filter bar** — isolate any followed artist
- **Archive status badges** — `ARCHIVED` links directly to the archive.org item; `QUEUED` and `PENDING` show what's still outstanding
- **Three grouping modes** — by page artist, album artist, or numeric Bandcamp band ID
- **Classification filters** — Free, Name Your Price (NYP), or Paid
- **Status filters** — filter to show only Archived, Queued, or Pending releases
- **Sort controls** — newest first, oldest first, A→Z by artist or title, most tracks
- **Two view modes** — grouped by artist (collapsible) or flat list of all releases
- **Grid and list layouts** for release cards
- **Optional cover art** — Bandcamp-embedded artwork loaded on demand
- **Load All toggle** — shows a placeholder until a filter is active by default, to keep the initial render fast on large collections
- **Preferences persistence** — layout, covers, view mode, and load-all saved across sessions

---

## Requirements

- Ruby ≥ 2.7 and Bundler, **or** a GitHub Pages-enabled repository (no local Ruby needed for deployment)
- Artist JSON files from [Bandcamp WACZ Archiver](https://github.com/Bandcamp-Web-Archive/bandcamp-wacz-archiver) placed in `artists/`

---

## Getting Started

### 1. Add your artist data

Copy or symlink the `artists/` directory from your archiver instance into this repo's root. The folder structure should look like:

```
artists/
└── Some Artist [3774983561]/
    └── Some Artist [3774983561].json
```

The folder and file naming (`Artist Name [band_id]`) is what the archiver produces by default — no changes needed.

### 2. Run locally

```bash
git clone https://github.com/Bandcamp-Web-Archive/browser.git
cd bandcamp-wacz-browser

bundle install
bundle exec jekyll serve
```

Jekyll will build `manifest.json` automatically from whatever is in `artists/`, so any JSON files there will appear in the browser immediately.

### 3. Deploy to GitHub Pages

1. Push the repository (including `artists/`) to GitHub.
2. Go to **Settings → Pages** and set the source to the `main` branch.
3. GitHub Actions will build and publish the site automatically.

The `Gemfile` pins `github-pages`, so no custom Actions workflow is needed.

---

## Repository Structure

```
browser/
├── _config.yml          # Site title, description, Jekyll settings
├── Gemfile              # Ruby gem dependencies (github-pages)
├── index.html           # Single-page app shell (Jekyll-templated)
├── manifest.json        # Jekyll-generated index of all artist JSON files
├── artists/             # Artist JSON files (from the archiver)
│   └── Artist Name [band_id]/
│       └── Artist Name [band_id].json
└── assets/
    ├── css/
    │   └── style.css    
    └── js/
        └── app.js       
```

`manifest.json` is a Jekyll template — it enumerates every `.json` file in `artists/` at build time so the client knows what to fetch. You don't edit it directly.

---

## How the Browser Reads Data

On page load, `app.js` fetches `manifest.json` to get the list of artist files, then fetches each one in parallel batches of 10. Releases are enriched with a derived `_status` field:

| Condition | Status displayed |
|---|---|
| `uploaded === true` and `ia_identifier` is set | **ARCHIVED** — badge links to `archive.org/details/{ia_identifier}` |
| `archived === true` and not yet uploaded | **QUEUED** |
| Neither | **PENDING** |

These map directly to the state flags the archiver writes. No transformation or re-processing needed.

---

## Customisation

| What | Where |
|---|---|
| Site title and description | `_config.yml` |
| Releases per page | `PAGE_SIZE` constant near the top of `assets/js/app.js` |
| Fonts | `<link>` tags in `index.html` and `font-family` in `style.css` |
| Colour scheme | CSS custom properties at the top of `assets/css/style.css` |
| Default sort / layout / view mode | `restorePreferences()` in `app.js` |

---

## Related

- **[Bandcamp WACZ Archiver](https://github.com/Bandcamp-Web-Archive/bandcamp-wacz-archiver)** — the pipeline that produces the artist JSON files this site reads, crawls Bandcamp pages into WACZ archives, and uploads them to the Internet Archive.
- **[ReplayWeb.page](https://replayweb.page)** — for replaying the WACZ archives offline.
- **[Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler)** — the crawler at the core of the archiver.

---

## License

Code is released under the [GNU GENERAL PUBLIC LICENSE](LICENSE). Artist data in `artists/` remains the property of the respective artists and labels — this tool is intended for personal archival and reference use only.
