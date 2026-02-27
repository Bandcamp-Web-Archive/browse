/* ============================================================
 *  BANDCAMP ARCHIVE — app.js
 *  ============================================================ */

'use strict';

// ============================================================
// STATE
// ============================================================

const state = {
    allReleases:      [],   // flat array, each release has ._artistKey injected
    artistMap:        {},   // artistKey -> [releases]
    filteredReleases: [],
    activeTags:       new Set(),
    activeClasses:    new Set(),
    allTagCounts:     {},
    releaseLayout:    'list',   // 'grid' | 'list'
    viewMode:         'all-list', // 'by-artist' | 'all-grid' | 'all-list'
    coversEnabled:    false,
    page:             0,
};

const PAGE_SIZE = 60;

// ============================================================
// BOOTSTRAP
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('search').addEventListener('input', debounce(applyFilters, 180));
    restorePreferences();
    loadArchive();
});

async function loadArchive() {
    setLoader('Fetching manifest…', 5);

    let manifestData;
    try {
        const resp = await fetch('manifest.json');
        if (!resp.ok) throw new Error(resp.status);
        manifestData = await resp.json();
    } catch (e) {
        setLoaderText('Error loading manifest.json — has Jekyll built the site?');
        return;
    }

    const artistFiles = manifestData.artists || [];
    if (!artistFiles.length) {
        setLoaderText('No artist JSON files found in manifest.');
        return;
    }

    setLoader(`Loading ${artistFiles.length} artists…`, 15);

    // Fetch all JSONs in parallel, in batches to avoid overwhelming the browser
    const BATCH = 10;
    let loaded = 0;

    for (let i = 0; i < artistFiles.length; i += BATCH) {
        const batch = artistFiles.slice(i, i + BATCH);
        await Promise.all(batch.map(async (entry) => {
            try {
                // Encode each path segment so special chars (spaces, brackets,
                // ampersands, Unicode, etc.) in artist folder/file names are
                // transmitted correctly.
                const safePath = (entry.path || '').trim()
                .split('/')
                .map(seg => encodeURIComponent(seg))
                .join('/');
                const r = await fetch(safePath);
                if (!r.ok) throw new Error(r.status);
                const data = await r.json();

                for (const [artistKey, releases] of Object.entries(data)) {
                    if (!Array.isArray(releases)) continue;
                    if (!state.artistMap[artistKey]) state.artistMap[artistKey] = [];

                    for (const rel of releases) {
                        const enriched = { ...rel, _artistKey: artistKey };
                        state.artistMap[artistKey].push(enriched);
                        state.allReleases.push(enriched);
                    }
                }
            } catch (e) {
                console.warn('Failed to load', entry.path, e);
            }
            loaded++;
            setLoader(
                `Loading artists (${loaded}/${artistFiles.length})…`,
                      15 + (loaded / artistFiles.length) * 75
            );
        }));
    }

    // Default sort: newest first
    state.allReleases.sort((a, b) => dateVal(b) - dateVal(a));

    // Build tag frequency index
    for (const rel of state.allReleases) {
        for (const t of (rel.tags || [])) {
            const lc = t.toLowerCase();
            state.allTagCounts[lc] = (state.allTagCounts[lc] || 0) + 1;
        }
    }

    setLoader('Rendering…', 95);
    buildTagBar();
    buildJumpBar();
    updateStats();
    applyFilters();

    document.getElementById('loading').style.display  = 'none';
    document.getElementById('content').style.display  = '';
}


// ============================================================
// FILTERS & SORT
// ============================================================

function applyFilters() {
    const q    = document.getElementById('search').value.trim().toLowerCase();
    const sort = document.getElementById('sort-select').value;

    let results = state.allReleases;

    // Text search
    if (q) {
        results = results.filter(r =>
        (r._artistKey   || '').toLowerCase().includes(q) ||
        (r.title        || '').toLowerCase().includes(q) ||
        (r.artist       || '').toLowerCase().includes(q) ||
        (r.label        || '').toLowerCase().includes(q) ||
        (r.tags         || []).some(t => t.toLowerCase().includes(q))
        );
    }

    // Classification filter
    if (state.activeClasses.size > 0) {
        results = results.filter(r => state.activeClasses.has(r.classification));
    }

    // Tag filter (AND logic — must match every active tag)
    if (state.activeTags.size > 0) {
        results = results.filter(r => {
            const rTags = (r.tags || []).map(t => t.toLowerCase());
            return [...state.activeTags].every(t => rTags.includes(t));
        });
    }

    // Sort
    results = [...results];
    switch (sort) {
        case 'date-desc':   results.sort((a, b) => dateVal(b) - dateVal(a)); break;
        case 'date-asc':    results.sort((a, b) => dateVal(a) - dateVal(b)); break;
        case 'artist-asc':  results.sort((a, b) => (a._artistKey || '').localeCompare(b._artistKey || '')); break;
        case 'artist-desc': results.sort((a, b) => (b._artistKey || '').localeCompare(a._artistKey || '')); break;
        case 'title-asc':   results.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
        case 'tracks-desc': results.sort((a, b) => (b.trackinfo || []).length - (a.trackinfo || []).length); break;
    }

    state.filteredReleases = results;
    state.page = 0;

    updateStats();
    render();
}


// ============================================================
// TOGGLE HELPERS  (called from HTML)
// ============================================================

window.toggleTag = function (tag) {
    if (state.activeTags.has(tag)) {
        state.activeTags.delete(tag);
    } else {
        state.activeTags.add(tag);
    }
    // Sync tag chip UI without rebuilding the whole bar
    document.querySelectorAll('.tag-chip').forEach(c => {
        c.classList.toggle('active', state.activeTags.has(c.dataset.tag));
    });
    applyFilters();
};

window.toggleClass = function (cls) {
    if (state.activeClasses.has(cls)) {
        state.activeClasses.delete(cls);
    } else {
        state.activeClasses.add(cls);
    }
    document.querySelectorAll('.class-btn').forEach(b => {
        const c = b.dataset.class;
        b.className = 'class-btn' + (state.activeClasses.has(c) ? ` active-${c}` : '');
    });
    applyFilters();
};

window.setViewMode = function (mode) {
    state.viewMode = mode;
    document.getElementById('view-mode-select').value = mode;
    render();
};

window.setReleaseLayout = function (layout) {
    state.releaseLayout = layout;
    document.getElementById('btn-grid').classList.toggle('active', layout === 'grid');
    document.getElementById('btn-list').classList.toggle('active', layout === 'list');
    render();
};

window.collapseArtist = function (id) {
    const section = document.getElementById(id);
    if (section) section.classList.toggle('collapsed');
};

window.filterByTag = function (e, tag) {
    e.preventDefault();
    e.stopPropagation();
    toggleTag(tag);
    buildTagBar();
};

window.loadMore = function () {
    state.page++;
    const vm = document.getElementById('view-mode-select').value;
    if (vm !== 'by-artist') renderFlat(document.getElementById('content'));
    if (state.coversEnabled) lazyLoadCovers();
};

window.toggleCovers = function () {
    state.coversEnabled = !state.coversEnabled;
    document.getElementById('covers-toggle').classList.toggle('on', state.coversEnabled);
    document.body.classList.toggle('no-covers', !state.coversEnabled);
    try { localStorage.setItem('bc-archive-covers', state.coversEnabled); } catch (_) {}
    if (state.coversEnabled) lazyLoadCovers();
};


// ============================================================
// RENDER
// ============================================================

function render() {
    const content = document.getElementById('content');
    const empty   = document.getElementById('empty');
    const lmWrap  = document.getElementById('load-more-wrap');

    if (state.filteredReleases.length === 0) {
        content.innerHTML = '';
        empty.style.display  = 'block';
        lmWrap.style.display = 'none';
        return;
    }

    empty.style.display = 'none';

    const vm = document.getElementById('view-mode-select').value;
    if (vm === 'by-artist') {
        renderByArtist(content);
        lmWrap.style.display = 'none';
    } else {
        renderFlat(content);
    }

    if (state.coversEnabled) lazyLoadCovers();
}

function renderByArtist(container) {
    const byArtist = {};
    for (const r of state.filteredReleases) {
        const k = r._artistKey;
        if (!byArtist[k]) byArtist[k] = [];
        byArtist[k].push(r);
    }

    const sort = document.getElementById('sort-select').value;
    let artistKeys = Object.keys(byArtist);

    if (sort === 'artist-asc') {
        artistKeys.sort((a, b) => a.localeCompare(b));
    } else if (sort === 'artist-desc') {
        artistKeys.sort((a, b) => b.localeCompare(a));
    } else {
        // Order artists by their most-recent release in the filtered set
        artistKeys.sort((a, b) => {
            const maxA = Math.max(...byArtist[a].map(dateVal));
            const maxB = Math.max(...byArtist[b].map(dateVal));
            return maxB - maxA;
        });
    }

    const layout = state.releaseLayout;
    const html = artistKeys.map(key => {
        const releases = byArtist[key];
        const id = artistId(key);
        return `
        <div class="artist-section" id="${id}">
        <div class="artist-header" onclick="collapseArtist('${id}')">
        <span class="artist-name">${esc(key)}</span>
        <span class="artist-count">${releases.length} release${releases.length !== 1 ? 's' : ''}</span>
        <span class="artist-collapse-icon">▾</span>
        </div>
        <div class="artist-releases ${layout}-view">
        ${releases.map(releaseCardHTML).join('')}
        </div>
        </div>`;
    }).join('');

    container.innerHTML = html;
}

function renderFlat(container) {
    const to    = Math.min((state.page + 1) * PAGE_SIZE, state.filteredReleases.length);
    const slice = state.filteredReleases.slice(0, to);
    const layout = state.releaseLayout;

    const gridStyle = layout === 'grid'
    ? 'style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))"'
    : '';

    container.innerHTML = `
    <div class="artist-releases ${layout}-view" ${gridStyle}>
    ${slice.map(releaseCardHTML).join('')}
    </div>`;

    const lmWrap = document.getElementById('load-more-wrap');
    const remaining = state.filteredReleases.length - to;
    if (remaining > 0) {
        lmWrap.style.display = 'block';
        lmWrap.querySelector('button').textContent = `Load more (${remaining} remaining)`;
    } else {
        lmWrap.style.display = 'none';
    }
}


// ============================================================
// CARD TEMPLATE
// ============================================================

function releaseCardHTML(rel) {
    const cls      = rel.classification || '';
    const date     = formatDate(rel.datePublished);
    const tracks   = rel.trackinfo || [];
    const topTags  = (rel.tags || []).slice(0, 5);
    const artId    = rel.art_id;
    const coverUrl = rel.coverUrl_0 ? rel.coverUrl_0.replace('_0', '_9') : null;

    const badgeClass = { free: 'badge-free', nyp: 'badge-nyp', paid: 'badge-paid' }[cls] || '';

    const coverHTML = artId
    ? `<div class="cover-wrap">
    <div class="cover-placeholder" id="ph-${artId}"></div>
    <img class="cover-img" id="cov-${artId}" alt="" data-src="${escAttr(coverUrl || '')}" />
    </div>`
    : `<div class="cover-wrap">
    <div class="cover-no-art">${gridSVG()}</div>
    </div>`;

    const tagsHTML = topTags.length
    ? `<div class="release-tags">
    ${topTags.map(t =>
        `<button class="release-tag" onclick="filterByTag(event,'${escAttr(t.toLowerCase())}')">${esc(t)}</button>`
    ).join('')}
    </div>`
    : '';

    const labelHTML  = rel.label  ? `<div class="release-label">${esc(rel.label)}</div>`  : '';
    const artistHTML = rel.artist && rel.artist !== rel._artistKey
    ? `<div class="release-artist">${esc(rel.artist)}</div>`
    : '';

    return `
    <div class="release-card">
    <a class="card-link" href="${escAttr(rel.url || '#')}" target="_blank" rel="noopener" aria-label="${escAttr(rel.title || 'Release')}"></a>
    ${coverHTML}
    <div class="card-body">
    <div class="release-title">${esc(rel.title || 'Untitled')}</div>
    ${artistHTML}
    ${labelHTML}
    <div class="release-meta">
    ${cls ? `<span class="classification-badge ${badgeClass}">${cls.toUpperCase()}</span>` : ''}
    <span class="release-date">${date}</span>
    ${tracks.length ? `<span class="track-count">${tracks.length} trk</span>` : ''}
    </div>
    ${tagsHTML}
    </div>
    </div>`;
}

function gridSVG() {
    let lines = '';
    for (let i = 0; i <= 40; i += 8) {
        lines += `<line x1="${i}" y1="0" x2="${i}" y2="40" stroke="#555560" stroke-width="0.5"/>`;
        lines += `<line x1="0" y1="${i}" x2="40" y2="${i}" stroke="#555560" stroke-width="0.5"/>`;
    }
    return `<svg class="cover-grid-pattern" viewBox="0 0 40 40" aria-hidden="true">${lines}</svg>`;
}


// ============================================================
// COVER LAZY LOADING
// ============================================================

function lazyLoadCovers() {
    const imgs = document.querySelectorAll('.cover-img[data-src]:not([src])');
    for (const img of imgs) {
        const src = img.dataset.src;
        if (!src) continue;
        img.src = src;
        img.onload  = () => img.classList.add('loaded');
        img.onerror = () => {
            img.style.display = 'none';
            const ph = document.getElementById('ph-' + img.id.replace('cov-', ''));
            if (ph) ph.innerHTML = `<div class="cover-no-art">${gridSVG()}</div>`;
        };
    }
}


// ============================================================
// UI HELPERS
// ============================================================

function buildTagBar() {
    const bar    = document.getElementById('tags-bar');
    const sorted = Object.entries(state.allTagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60);

    const chips = sorted.map(([tag, count]) => {
        const active = state.activeTags.has(tag) ? ' active' : '';
        return `<button class="tag-chip${active}" data-tag="${escAttr(tag)}" onclick="toggleTag('${escAttr(tag)}')">${esc(tag)} <span style="color:var(--text3);font-size:9px">${count}</span></button>`;
    }).join('');

    bar.innerHTML = `<span class="tags-label">Tags</span>${chips}`;
}

function buildJumpBar() {
    const bar     = document.getElementById('jump-bar');
    const artists = Object.keys(state.artistMap).sort((a, b) => a.localeCompare(b));

    const links = artists.map(a =>
    `<a class="jump-link" href="#${artistId(a)}">${esc(a)}</a>`
    ).join('');

    bar.innerHTML = `<span class="jump-label">Artists</span>${links}`;
}

function updateStats() {
    const total   = state.allReleases.length;
    const shown   = state.filteredReleases.length;
    const artists = Object.keys(state.artistMap).length;

    document.getElementById('stats-bar').innerHTML =
    `<b>${artists}</b> artists · <b>${total}</b> releases`
    + (shown !== total ? ` · <b>${shown}</b> filtered` : '');
}

function setLoader(text, pct) {
    document.getElementById('loader-text').textContent  = text;
    document.getElementById('loader-fill').style.width  = pct + '%';
}

function setLoaderText(text) {
    document.getElementById('loader-text').textContent = text;
}

function restorePreferences() {
    try {
        const saved = localStorage.getItem('bc-archive-covers');
        if (saved === 'true') {
            state.coversEnabled = true;
            document.getElementById('covers-toggle').classList.add('on');
            document.body.classList.remove('no-covers');
        } else {
            document.body.classList.add('no-covers');
        }
    } catch (_) {
        document.body.classList.add('no-covers');
    }
}


// ============================================================
// UTILITY
// ============================================================

function artistId(name) {
    return 'artist-' + name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function dateVal(rel) {
    if (!rel.datePublished) return 0;
    return new Date(rel.datePublished).getTime() || 0;
}

function formatDate(str) {
    if (!str) return '';
    const d = new Date(str);
    if (isNaN(d)) return str.substring(0, 10);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function esc(s) {
    return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
