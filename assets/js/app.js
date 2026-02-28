/* ============================================================
 *  BANDCAMP WEB ARCHIVE — app.js
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
    activeStatuses:   new Set(),
    activeArtists:    new Set(),   // artist-name keys OR band_id strings depending on groupBy
    allTagCounts:     {},
    _artistBarData:   {},          // groupKey -> release count (cache)
    _artistBarHints:  {},          // groupKey -> hint string
    _byGroupCache:    {},          // groupKey -> releases[] (for lazy observer)
    releaseLayout:    'list',      // 'grid' | 'list'
    viewMode:         'by-artist', // 'by-artist' | 'all-releases'
    groupBy:          'artist',    // 'artist' | 'band_id' | 'album_artist'
    coversEnabled:    false,
    loadAll:          false,  // if false, show placeholder until a filter is active
    page:             0,
};

const PAGE_SIZE = 60;

// ============================================================
// GROUP KEY HELPER
// Returns the key used for grouping/filtering releases.
// ============================================================

function groupKey(rel) {
    if (state.groupBy === 'band_id')      return String(rel.band_id || '');
    if (state.groupBy === 'album_artist') return rel.artist || rel._artistKey;
    return rel._artistKey;
}

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

    const BATCH = 10;
    let loaded = 0;

    for (let i = 0; i < artistFiles.length; i += BATCH) {
        const batch = artistFiles.slice(i, i + BATCH);
        await Promise.all(batch.map(async (entry) => {
            try {
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

    // Pre-compute cached fields once — avoids repeated new Date(), status checks, etc.
    for (const rel of state.allReleases) {
        rel._dateVal       = rel.datePublished ? (new Date(rel.datePublished).getTime() || 0) : 0;
        rel._status        = (rel.uploaded && rel.ia_identifier) ? 'archived' : rel.archived ? 'queued' : 'pending';
        rel._tagsLower     = (rel.tags || []).map(t => t.toLowerCase());
        rel._dateFormatted = formatDate(rel.datePublished);
    }

    state.allReleases.sort((a, b) => b._dateVal - a._dateVal);

    for (const rel of state.allReleases) {
        for (const lc of rel._tagsLower) {
            state.allTagCounts[lc] = (state.allTagCounts[lc] || 0) + 1;
        }
    }

    setLoader('Rendering…', 95);
    buildTagBar();
    buildArtistBar();
    updateStats();
    applyFilters();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = '';
}


// ============================================================
// PIPELINE STATUS HELPER
// ============================================================

function pipelineStatus(rel) {
    return rel._status !== undefined ? rel._status
        : (rel.uploaded && rel.ia_identifier) ? 'archived' : rel.archived ? 'queued' : 'pending';
}


// ============================================================
// FILTERS & SORT
// ============================================================

function hasActiveFilter() {
    const q = document.getElementById('search').value.trim();
    return q.length > 0
        || state.activeTags.size > 0
        || state.activeClasses.size > 0
        || state.activeStatuses.size > 0
        || state.activeArtists.size > 0;
}

function applyFilters() {
    const q    = document.getElementById('search').value.trim().toLowerCase();
    const sort = document.getElementById('sort-select').value;

    let results = state.allReleases;

    if (q) {
        results = results.filter(r =>
        (r._artistKey || '').toLowerCase().includes(q) ||
        (r.title      || '').toLowerCase().includes(q) ||
        (r.artist     || '').toLowerCase().includes(q) ||
        (r.label      || '').toLowerCase().includes(q) ||
        (r.tags       || []).some(t => t.toLowerCase().includes(q))
        );
    }

    if (state.activeClasses.size > 0) {
        results = results.filter(r => state.activeClasses.has(r.classification));
    }

    if (state.activeStatuses.size > 0) {
        results = results.filter(r => state.activeStatuses.has(pipelineStatus(r)));
    }

    if (state.activeTags.size > 0) {
        const activeTags = [...state.activeTags];
        results = results.filter(r => {
            const rTags = r._tagsLower || (r.tags || []).map(t => t.toLowerCase());
            return activeTags.every(t => rTags.includes(t));
        });
    }

    if (state.activeArtists.size > 0) {
        results = results.filter(r => state.activeArtists.has(groupKey(r)));
    }

    results = [...results];
    switch (sort) {
        case 'date-desc':   results.sort((a, b) => b._dateVal - a._dateVal); break;
        case 'date-asc':    results.sort((a, b) => a._dateVal - b._dateVal); break;
        case 'artist-asc':  results.sort((a, b) => (a._artistKey || '').localeCompare(b._artistKey || '')); break;
        case 'artist-desc': results.sort((a, b) => (b._artistKey || '').localeCompare(a._artistKey || '')); break;
        case 'title-asc':   results.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
        case 'tracks-desc': results.sort((a, b) => (b.trackinfo || []).length - (a.trackinfo || []).length); break;
    }

    state.filteredReleases = results;
    state.page = 0;

    updateStats();

    if (!state.loadAll && !hasActiveFilter()) {
        renderPlaceholder();
    } else {
        render();
    }
}


// ============================================================
// TOGGLE HELPERS  (called from HTML)
// ============================================================

window.toggleTag = function (tag) {
    if (state.activeTags.has(tag)) state.activeTags.delete(tag);
    else state.activeTags.add(tag);
    document.querySelectorAll('.tag-chip').forEach(c => {
        c.classList.toggle('active', state.activeTags.has(c.dataset.tag));
    });
    applyFilters();
};

window.toggleClass = function (cls) {
    if (state.activeClasses.has(cls)) state.activeClasses.delete(cls);
    else state.activeClasses.add(cls);
    document.querySelectorAll('.class-btn').forEach(b => {
        const c = b.dataset.class;
        b.className = 'class-btn' + (state.activeClasses.has(c) ? ` active-${c}` : '');
    });
    applyFilters();
};

window.toggleStatus = function (status) {
    if (state.activeStatuses.has(status)) state.activeStatuses.delete(status);
    else state.activeStatuses.add(status);
    document.querySelectorAll('.status-filter-btn').forEach(b => {
        b.classList.toggle('active', state.activeStatuses.has(b.dataset.status));
    });
    applyFilters();
};

window.toggleArtist = function (key) {
    if (state.activeArtists.has(key)) state.activeArtists.delete(key);
    else state.activeArtists.add(key);
    // Sync chip highlight without full rebuild
    document.querySelectorAll('.artist-chip').forEach(c => {
        c.classList.toggle('active', state.activeArtists.has(c.dataset.artist));
    });
    applyFilters();
};

window.filterArtistChips = function (q) {
    renderArtistChips(q);
};

window.clearArtistFilter = function () {
    state.activeArtists.clear();
    buildArtistBar();
    applyFilters();
};

window.setGroupBy = function (mode) {
    if (state.groupBy === mode) return;
    state.groupBy = mode;
    state.activeArtists.clear(); // keys changed, clear selection
    document.getElementById('btn-groupby-artist').classList.toggle('active', mode === 'artist');
    document.getElementById('btn-groupby-id').classList.toggle('active', mode === 'band_id');
    document.getElementById('btn-groupby-album-artist').classList.toggle('active', mode === 'album_artist');
    try { localStorage.setItem('bc-archive-groupby', mode); } catch (_) {}
    buildArtistBar();
    applyFilters();
};

window.setViewMode = function (mode) {
    state.viewMode = mode;
    document.getElementById('view-mode-select').value = mode;
    try { localStorage.setItem('bc-archive-view', mode); } catch (_) {}
    const collapseBtns = document.getElementById('collapse-btns');
    if (collapseBtns) collapseBtns.style.display = mode === 'by-artist' ? '' : 'none';
    render();
};

window.setReleaseLayout = function (layout) {
    state.releaseLayout = layout;
    document.getElementById('btn-grid').classList.toggle('active', layout === 'grid');
    document.getElementById('btn-list').classList.toggle('active', layout === 'list');
    try { localStorage.setItem('bc-archive-layout', layout); } catch (_) {}
    render();
};

window.collapseAll = function () {
    document.querySelectorAll('.artist-section').forEach(s => s.classList.add('collapsed'));
};

window.expandAll = function () {
    document.querySelectorAll('.artist-section').forEach(s => {
        s.classList.remove('collapsed');
        // Force-render any section that hasn't been lazily populated yet
        if (!s.dataset.rendered) {
            s.dataset.rendered = '1';
            if (_sectionObserver) _sectionObserver.unobserve(s);
            const releases = state._byGroupCache[s.dataset.groupKey];
            if (releases) {
                const content = s.querySelector('.artist-releases');
                if (content) {
                    content.innerHTML = releases.map(releaseCardHTML).join('');
                    if (state.coversEnabled) lazyLoadCovers();
                }
            }
        }
    });
};

window.collapseArtist = function (id) {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle('collapsed');
    // If user expands a section that hasn't been lazily rendered yet, render it now
    if (!section.classList.contains('collapsed') && !section.dataset.rendered) {
        section.dataset.rendered = '1';
        if (_sectionObserver) _sectionObserver.unobserve(section);
        const key     = section.dataset.groupKey;
        const releases = state._byGroupCache[key];
        if (releases) {
            const content = section.querySelector('.artist-releases');
            if (content) {
                content.innerHTML = releases.map(releaseCardHTML).join('');
                if (state.coversEnabled) lazyLoadCovers();
            }
        }
    }
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

window.toggleLoadAll = function () {
    setLoadAll(!state.loadAll);
};

window.setLoadAll = function (val) {
    state.loadAll = val;
    const track = document.getElementById('load-all-toggle');
    if (track) track.classList.toggle('on', val);
    try { localStorage.setItem('bc-archive-loadall', val); } catch (_) {}
    applyFilters();
};

window.toggleCovers = function () {
    state.coversEnabled = !state.coversEnabled;
    document.getElementById('covers-toggle').classList.toggle('on', state.coversEnabled);
    document.body.classList.toggle('no-covers', !state.coversEnabled);
    try { localStorage.setItem('bc-archive-covers', state.coversEnabled); } catch (_) {}
    if (!state.coversEnabled) {
        clearTimeout(coverTimer);
        coverTimer = null;
        coverQueue.length = 0;
    } else {
        lazyLoadCovers();
    }
};


// ============================================================
// RENDER
// ============================================================

function renderPlaceholder() {
    const content = document.getElementById('content');
    const empty   = document.getElementById('empty');
    const lmWrap  = document.getElementById('load-more-wrap');
    empty.style.display  = 'none';
    lmWrap.style.display = 'none';
    if (_sectionObserver) { _sectionObserver.disconnect(); _sectionObserver = null; }
    content.innerHTML = `<div class="load-all-placeholder">
        <p>${state.allReleases.length.toLocaleString()} releases across ${Object.keys(state.artistMap).length} artists.</p>
        <p>Use the search or filters above to find releases, or
        <button class="load-all-inline-btn" onclick="setLoadAll(true)">load everything</button>.</p>
    </div>`;
}

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

// IntersectionObserver for lazy card rendering in by-artist mode
let _sectionObserver = null;

function getSectionObserver() {
    if (_sectionObserver) return _sectionObserver;
    _sectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            if (el.dataset.rendered) continue;
            el.dataset.rendered = '1';
            _sectionObserver.unobserve(el);
            const releases = state._byGroupCache[el.dataset.groupKey];
            if (!releases) continue;
            const layout  = state.releaseLayout;
            const content = el.querySelector('.artist-releases');
            if (content) {
                content.className = `artist-releases ${layout}-view`;
                content.innerHTML = releases.map(releaseCardHTML).join('');
                if (state.coversEnabled) lazyLoadCovers();
            }
        }
    }, { rootMargin: '200px' }); // start rendering 200px before entering viewport
    return _sectionObserver;
}

function renderByArtist(container) {
    // Disconnect old observer and clear cache
    if (_sectionObserver) { _sectionObserver.disconnect(); _sectionObserver = null; }

    const byGroup = {};
    for (const r of state.filteredReleases) {
        const k = groupKey(r);
        if (!byGroup[k]) byGroup[k] = [];
        byGroup[k].push(r);
    }

    const sort = document.getElementById('sort-select').value;
    let keys = Object.keys(byGroup);

    if (sort === 'artist-asc') {
        keys.sort((a, b) => a.localeCompare(b));
    } else if (sort === 'artist-desc') {
        keys.sort((a, b) => b.localeCompare(a));
    } else {
        const groupMax = {};
        for (const k of keys) {
            let m = 0;
            for (const r of byGroup[k]) { if (r._dateVal > m) m = r._dateVal; }
            groupMax[k] = m;
        }
        keys.sort((a, b) => groupMax[b] - groupMax[a]);
    }

    // Store releases by group key for the observer to access
    state._byGroupCache = byGroup;

    const layout  = state.releaseLayout;
    const observer = getSectionObserver();

    // Render section shells only — cards are filled in lazily by the observer
    const html = keys.map(key => {
        const releases  = byGroup[key];
        const id        = sectionId(key);
        const nArchived = releases.filter(r => (r._status || pipelineStatus(r)) === 'archived').length;
        const nameLabel = state.groupBy === 'band_id'
        ? `${esc(key)} <span class="artist-name-hint">${esc(releases[0]._artistKey || '')}</span>`
        : state.groupBy === 'artist'
        ? `${esc(key)} <span class="artist-name-hint">${esc(String(releases[0].band_id || ''))}</span>`
        : esc(key);
        const countLabel = nArchived === releases.length
        ? `${releases.length} release${releases.length !== 1 ? 's' : ''}`
        : `${releases.length} release${releases.length !== 1 ? 's' : ''} · ${nArchived} archived`;
        return `
        <div class="artist-section collapsed" id="${id}" data-group-key="${escAttr(key)}">
        <div class="artist-header" onclick="collapseArtist('${id}')">
        <span class="artist-name">${nameLabel}</span>
        <span class="artist-count">${countLabel}</span>
        <span class="artist-collapse-icon">▾</span>
        </div>
        <div class="artist-releases ${layout}-view"></div>
        </div>`;
    }).join('');

    container.innerHTML = html;

    // Observe all section shells — observer fills cards on scroll-into-view
    container.querySelectorAll('.artist-section[data-group-key]').forEach(el => {
        observer.observe(el);
    });
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

    const lmWrap    = document.getElementById('load-more-wrap');
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

const BADGE_CLASS = { free: 'badge-free', nyp: 'badge-nyp', paid: 'badge-paid' };

function releaseCardHTML(rel) {
    const cls     = rel.classification || '';
    const date    = rel._dateFormatted !== undefined ? rel._dateFormatted : formatDate(rel.datePublished);
    const tracks  = rel.trackinfo || [];
    const topTags = (rel.tags || []).slice(0, 5);

    const badgeClass = BADGE_CLASS[cls] || '';

    // Primary link: IA if uploaded, else Bandcamp
    const iaUrl      = rel.ia_identifier ? `https://archive.org/details/${rel.ia_identifier}` : null;
    const bcUrl      = rel.url || '#';
    const primaryUrl = iaUrl || bcUrl;

    // Pipeline status
    const status = pipelineStatus(rel);
    let statusHTML;
    if (status === 'archived') {
        statusHTML = `<a class="status-badge status-archived" href="${escAttr(iaUrl)}" target="_blank" rel="noopener" title="View archived copy on archive.org">ARCHIVED</a>`;
    } else if (status === 'queued') {
        statusHTML = `<span class="status-badge status-queued" title="Crawled — awaiting upload to archive.org">QUEUED</span>`;
    } else {
        statusHTML = `<span class="status-badge status-pending" title="Not yet crawled">PENDING</span>`;
    }

    // Bandcamp secondary link
    const bcLinkHTML = `<a class="bc-link" href="${escAttr(bcUrl)}" target="_blank" rel="noopener" title="View on Bandcamp">BC ↗</a>`;

    // Cover: Bandcamp embed iframe — track pages use track= param, albums use album=
    const itemId   = rel.item_id;
    const embedType = (rel.url || '').includes('/track/') ? 'track' : 'album';
    const coverHTML = itemId
    ? `<div class="cover-wrap">
    <iframe class="cover-iframe"
    data-src="https://bandcamp.com/EmbeddedPlayer/${embedType}=${itemId}/size=large/bgcol=111113/linkcol=5de4c7/minimal=true/transparent=true/"
    scrolling="no" frameborder="0" allowtransparency="true" seamless
    title="${escAttr(rel.title || '')}"></iframe>
    </div>`
    : `<div class="cover-wrap"><div class="cover-no-art">${gridSVG()}</div></div>`;

    // Tags
    const tagsHTML = topTags.length
    ? `<div class="release-tags">${topTags.map(t =>
        `<button class="release-tag" onclick="filterByTag(event,'${escAttr(t.toLowerCase())}')">${esc(t)}</button>`
    ).join('')}</div>`
    : '';

    // History
    const history = rel._history || [];
    let historyHTML = '';
    if (history.length) {
        const entries = history.slice().reverse().map(h => {
            const d     = h.changed_at ? formatDate(h.changed_at) : '?';
            const iaId  = h.ia_identifier_at_change;
            const iaLink = iaId
            ? `<a class="history-ia-link" href="https://archive.org/details/${escAttr(iaId)}" target="_blank" rel="noopener">${esc(iaId)}</a>`
            : `<span class="history-no-ia">no archive at change</span>`;
            const changedFields = Object.entries(h.fields || {});
            const fieldsHTML = changedFields.length
            ? `<div class="history-fields">${changedFields.map(([k, v]) => {
                if (k === 'trackinfo' && Array.isArray(v)) {
                    return `<div class="history-trackinfo"><span class="history-field-key">trackinfo:</span><div class="track-list track-list--history">${renderTrackList(v)}</div></div>`;
                }
                const display = (Array.isArray(v) || (v !== null && typeof v === 'object'))
                    ? JSON.stringify(v)
                    : String(v);
                return `<span class="history-field-key">${esc(k)}:</span> <span class="history-field-val">${esc(display)}</span>`;
            }).join(' · ')}</div>`
            : '';
            return `<div class="history-entry"><span class="history-date">${d}</span>${iaLink}${fieldsHTML}</div>`;
        }).join('');
        historyHTML = `<details class="release-history"><summary class="history-toggle">↺ ${history.length} version${history.length !== 1 ? 's' : ''}</summary><div class="history-list">${entries}</div></details>`;
    }

    const labelHTML  = rel.label ? `<div class="release-label">${esc(rel.label)}</div>` : '';
    const artistHTML = rel.artist && rel.artist !== rel._artistKey
    ? `<div class="release-artist">${esc(rel.artist)}</div>`
    : '';

    // Track listing dropdown
    const tracksDropdownHTML = tracks.length
    ? `<details class="release-tracks"><summary class="tracks-toggle">♫ ${tracks.length} track${tracks.length !== 1 ? 's' : ''}</summary><div class="track-list">${renderTrackList(tracks)}</div></details>`
    : '';

    return `
    <div class="release-card" data-status="${status}">
    ${coverHTML}
    <div class="card-body">
    <a class="release-title-link" href="${escAttr(primaryUrl)}" target="_blank" rel="noopener">
    <div class="release-title">${esc(rel.title || 'Untitled')}</div>
    </a>
    ${artistHTML}
    ${labelHTML}
    <div class="release-meta">
    ${statusHTML}
    ${cls ? `<span class="classification-badge ${badgeClass}">${cls.toUpperCase()}</span>` : ''}
    <span class="release-date">${date}</span>
    ${bcLinkHTML}
    </div>
    ${tagsHTML}
    ${tracksDropdownHTML}
    ${historyHTML}
    </div>
    </div>`;
}

function renderTrackList(tracks) {
    return tracks.map(t => {
        const num  = t.track_num ? `<span class="track-num">${esc(t.track_num)}.</span>` : '';
        const link = t.url
        ? `<a class="track-title" href="${escAttr(t.url)}" target="_blank" rel="noopener">${esc(t.title || 'Untitled')}</a>`
        : `<span class="track-title">${esc(t.title || 'Untitled')}</span>`;
        const dur  = t.duration ? `<span class="track-duration">${esc(t.duration)}</span>` : '';
        return `<div class="track-row">${num}${link}${dur}</div>`;
    }).join('');
}

// Pre-built constant — identical every time, no need to recompute per card
const GRID_SVG = (() => {
    let lines = '';
    for (let i = 0; i <= 40; i += 8) {
        lines += `<line x1="${i}" y1="0" x2="${i}" y2="40" stroke="#555560" stroke-width="0.5"/>`;
        lines += `<line x1="0" y1="${i}" x2="40" y2="${i}" stroke="#555560" stroke-width="0.5"/>`;
    }
    return `<svg class="cover-grid-pattern" viewBox="0 0 40 40" aria-hidden="true">${lines}</svg>`;
})();
function gridSVG() { return GRID_SVG; }


// ============================================================
// COVER LAZY LOADING — throttled Bandcamp embed iframes
// ============================================================

const coverQueue = [];
let coverTimer   = null;
const COVER_DELAY_MS = 500; // generous delay — each iframe loads a full embed page

function lazyLoadCovers() {
    const iframes = document.querySelectorAll('.cover-iframe[data-src]:not([data-queued])');
    for (const el of iframes) {
        el.dataset.queued = '1';
        coverQueue.push(el);
    }
    if (!coverTimer && coverQueue.length > 0) drainCoverQueue();
}

function drainCoverQueue() {
    coverTimer = null;
    if (!state.coversEnabled || coverQueue.length === 0) return;

    const el = coverQueue.shift();

    // Skip stale nodes (after re-render) or already loaded
    if (!document.contains(el) || el.src) {
        drainCoverQueue(); // no delay — just skip
        return;
    }

    const src = el.dataset.src;
    if (!src) { drainCoverQueue(); return; }

    el.src = src;
    // iframes: no onerror — if the embed fails it shows blank, not a flash-then-disappear

    coverTimer = setTimeout(drainCoverQueue, COVER_DELAY_MS);
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

function buildArtistBar() {
    // Build count map and hints map keyed by current groupBy
    const counts = {};
    const hints  = {};
    for (const rel of state.allReleases) {
        const k = groupKey(rel);
        counts[k] = (counts[k] || 0) + 1;
        // artist mode: hint = band_id; band_id mode: hint = page artist name
        if (state.groupBy === 'artist' && !hints[k]) {
            hints[k] = String(rel.band_id || '');
        } else if (state.groupBy === 'band_id' && !hints[k]) {
            hints[k] = rel._artistKey || '';
        }
        // album_artist mode: no hints (multiple band_ids could mix)
    }
    state._artistBarData  = counts;
    state._artistBarHints = hints;
    renderArtistChips('');
}

function renderArtistChips(filter) {
    const bar    = document.getElementById('artist-bar');
    const counts = state._artistBarData  || {};
    const hints  = state._artistBarHints || {};
    const isId          = state.groupBy === 'band_id';
    const isAlbumArtist = state.groupBy === 'album_artist';

    const sortedKeys = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    const visible    = filter
    ? sortedKeys.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
    : sortedKeys;

    const hasActive  = state.activeArtists.size > 0;
    const clearBtn   = hasActive
    ? `<button class="artist-clear-btn" onclick="clearArtistFilter()" title="Clear artist filter">✕ clear</button>`
    : '';

    const label = isId ? 'Band IDs' : isAlbumArtist ? 'Album Artists' : 'Artists';
    const ph    = isId ? 'search IDs…' : isAlbumArtist ? 'search album artists…' : 'search artists…';

    const chips = visible.map(k => {
        const active   = state.activeArtists.has(k) ? ' active' : '';
        const hint     = hints[k];
        const hintHTML = hint ? ` <span class="artist-name-hint">${esc(hint)}</span>` : '';
        return `<button class="artist-chip${active}" data-artist="${escAttr(k)}" onclick="toggleArtist('${escAttr(k)}')">${esc(k)}${hintHTML} <span class="artist-chip-count">${counts[k]}</span></button>`;
    }).join('');

    // Only do a full rebuild when the bar structure changes (label, placeholder, clear btn).
    // When just filtering chips, update the chips-wrap in-place so the input keeps focus.
    const existingWrap = bar.querySelector('.artist-chips-wrap');
    const existingLabel = bar.querySelector('.artist-bar-label');
    const existingInput = bar.querySelector('.artist-search');
    const labelChanged = !existingLabel || existingLabel.textContent !== label;
    const phChanged    = !existingInput || existingInput.placeholder !== ph;
    const clearChanged = !!bar.querySelector('.artist-clear-btn') !== !!clearBtn;
    if (labelChanged || phChanged || clearChanged || !existingWrap) {
        // Full rebuild needed (mode switch, clear btn appearing/disappearing)
        bar.innerHTML = `
        <span class="artist-bar-label">${label}</span>
        <input type="search" class="artist-search" placeholder="${ph}"
        oninput="filterArtistChips(this.value)"
        autocomplete="off" spellcheck="false"
        value="${escAttr(filter)}">
        ${clearBtn}
        <div class="artist-chips-wrap">${chips}</div>`;
    } else {
        // Just swap out the chips — input keeps focus and cursor position
        existingWrap.innerHTML = chips;
    }
}

function updateStats() {
    const total   = state.allReleases.length;
    const shown   = state.filteredReleases.length;
    const artists = Object.keys(state.artistMap).length;
    let nArchived = 0, nQueued = 0, nPending = 0;
    for (const r of state.allReleases) {
        const s = r._status || pipelineStatus(r);
        if      (s === 'archived') nArchived++;
        else if (s === 'queued')   nQueued++;
        else                       nPending++;
    }

    let html = `<b>${artists}</b> artists · <b>${total}</b> releases`;
    if (shown !== total) html += ` · <b>${shown}</b> filtered`;
    html += ` &nbsp;·&nbsp; <span class="stat-archived">${nArchived} archived</span>`;
    if (nQueued)  html += ` · <span class="stat-queued">${nQueued} queued</span>`;
    if (nPending) html += ` · <span class="stat-pending">${nPending} pending</span>`;

    document.getElementById('stats-bar').innerHTML = html;
}

function setLoader(text, pct) {
    document.getElementById('loader-text').textContent = text;
    document.getElementById('loader-fill').style.width = pct + '%';
}

function setLoaderText(text) {
    document.getElementById('loader-text').textContent = text;
}

function restorePreferences() {
    try {
        const savedCovers = localStorage.getItem('bc-archive-covers');
        if (savedCovers === 'true') {
            state.coversEnabled = true;
            document.getElementById('covers-toggle').classList.add('on');
            document.body.classList.remove('no-covers');
        } else {
            document.body.classList.add('no-covers');
        }

        const savedGroupBy = localStorage.getItem('bc-archive-groupby');
        if (savedGroupBy === 'band_id' || savedGroupBy === 'artist' || savedGroupBy === 'album_artist') {
            state.groupBy = savedGroupBy;
            document.getElementById('btn-groupby-artist').classList.toggle('active', savedGroupBy === 'artist');
            document.getElementById('btn-groupby-id').classList.toggle('active', savedGroupBy === 'band_id');
            document.getElementById('btn-groupby-album-artist').classList.toggle('active', savedGroupBy === 'album_artist');
        }

        const savedView = localStorage.getItem('bc-archive-view');
        if (savedView && ['by-artist', 'all-releases'].includes(savedView)) {
            state.viewMode = savedView;
            document.getElementById('view-mode-select').value = savedView;
            const collapseBtns = document.getElementById('collapse-btns');
            if (collapseBtns) collapseBtns.style.display = savedView === 'by-artist' ? '' : 'none';
        }

        const savedLayout = localStorage.getItem('bc-archive-layout');
        if (savedLayout === 'grid' || savedLayout === 'list') {
            state.releaseLayout = savedLayout;
            document.getElementById('btn-grid').classList.toggle('active', savedLayout === 'grid');
            document.getElementById('btn-list').classList.toggle('active', savedLayout === 'list');
        }
        const savedLoadAll = localStorage.getItem('bc-archive-loadall');
        if (savedLoadAll === 'true') {
            state.loadAll = true;
            const track = document.getElementById('load-all-toggle');
            if (track) track.classList.add('on');
        }
    } catch (_) {
        document.body.classList.add('no-covers');
    }
}


// ============================================================
// UTILITY
// ============================================================

function sectionId(key) {
    return 'section-' + String(key).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// kept for back-compat with any remaining call sites
function artistId(name) { return sectionId(name); }

function dateVal(rel) {
    return rel._dateVal !== undefined ? rel._dateVal
        : rel.datePublished ? (new Date(rel.datePublished).getTime() || 0) : 0;
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
