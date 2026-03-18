const API_KEY = "0857baf457a2296f7cc13f40e7df9809";

const genreMap = {
    none:"none", Action:28, Adventure:12, Animation:16, Comedy:35, Crime:80,
    Documentary:99, Drama:18, Family:10751, Fantasy:14, History:36, Horror:27,
    Music:10402, Mystery:9648, Romance:10749, Sci_fi:878, Thriller:53, War:10752, Western:37
};

const industries = {
    en:"Hollywood", hi:"Bollywood", te:"Tollywood", ta:"Kollywood",
    ml:"Mollywood", kn:"Sandalwood", es:"Spanish Cinema",
    ko:"Korean Cinema", ja:"Japanese Cinema", fr:"French Cinema"
};

const INDIAN_LANGUAGE_CODES = new Set(["hi", "te", "ta", "ml", "kn"]);

// DOM refs
const searchBox       = document.getElementById("search_box");
const searchBtn       = document.getElementById("search_button");
const pageContainer   = document.querySelector(".page");
const mainHeading     = document.querySelector(".movie_heading h2");
const sectionMain     = document.querySelector(".Main");
const secondaryFilter = document.querySelector(".secondary_filter");
const primaryFilter   = document.getElementById("primaryFilter");
const hamburger       = document.getElementById("hamburger");
const paginationEl    = document.getElementById("pagination");
const langSelect      = document.getElementById("lang_select");
const yearSelect      = document.getElementById("year_select");

function populateYearOptions() {
    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    const earliestYear = 1950;
    const options = [
        '<option disabled selected hidden>Year</option>',
        '<option value="none">None</option>'
    ];

    for (let year = currentYear; year >= earliestYear; year -= 1) {
        options.push(`<option value="${year}">${year}</option>`);
    }

    yearSelect.innerHTML = options.join("");
}

// ─── Hamburger menu (mobile) ──────────────────────────────────────────────────
hamburger.addEventListener("click", () => {
    hamburger.classList.toggle("open");
    primaryFilter.classList.toggle("open");
});
// Close when a primary filter item is clicked
primaryFilter.addEventListener("click", (e) => {
    if (e.target.closest("#lang_select")) return;
    if (e.target !== primaryFilter) {
        hamburger.classList.remove("open");
        primaryFilter.classList.remove("open");
    }
});

// ─── State ─────────────────────────────────────────────────────────────────────
let state = {
    type:        "movie",  // "movie" | "tv"
    lang:        null,     // e.g. "te", "hi", "ta"
    year:        null,
    with_genres: null,
    sort_by:     null,
    isSearch:    false,
    searchQuery: "",
    currentPage: 1,
    totalPages:  1,
};

// ─── Session Preference Engine ────────────────────────────────────────────────
// Pure in-memory: resets on every page refresh, no persistence.
const sessionPrefs = {
    genreWeights: {},   // { genreId: score }  — accumulated from clicks
    recentIds:    [],   // clicked movie/tv ids, newest first (max 5)
    recentTitles: [],   // matching titles
    searchTerms:  [],   // searched strings, newest first (max 5)
    lastType:     "movie"
};

/** Called whenever a card is opened — boosts genre weights for that title. */
function trackMovieClick(id, genreIds, title, type) {
    genreIds.forEach(gid => {
        sessionPrefs.genreWeights[gid] = (sessionPrefs.genreWeights[gid] || 0) + 3;
    });
    if (!sessionPrefs.recentIds.includes(id)) {
        sessionPrefs.recentIds.unshift(id);
        sessionPrefs.recentTitles.unshift(title);
        if (sessionPrefs.recentIds.length > 5) {
            sessionPrefs.recentIds.pop();
            sessionPrefs.recentTitles.pop();
        }
    }
    sessionPrefs.lastType = type;
    scheduleRecs();
}

/** Called whenever a search is submitted. */
function trackSearch(query) {
    if (!query) return;
    sessionPrefs.searchTerms = [
        query,
        ...sessionPrefs.searchTerms.filter(q => q !== query)
    ].slice(0, 5);
    scheduleRecs();
}

// Debounce so rapid events don't stack fetches
let _recTimer = null;
function scheduleRecs() {
    clearTimeout(_recTimer);
    _recTimer = setTimeout(generateRecommendations, 700);
}

function getTopGenres(n) {
    return Object.entries(sessionPrefs.genreWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([id]) => id);
}

// ─── Recommendation generation ─────────────────────────────────────────────────
async function generateRecommendations() {
    const type      = sessionPrefs.lastType;
    const hasClicks = sessionPrefs.recentIds.length > 0;
    const hasSearch = sessionPrefs.searchTerms.length > 0;
    if (!hasClicks && !hasSearch) return;

    showRecLoading();

    let bucket = [];
    const seenIds = new Set(sessionPrefs.recentIds); // never recommend what user already opened

    // ── Strategy A: TMDB's own recommendations for the most recently clicked title ──
    if (hasClicks) {
        try {
            const r = await fetch(
                `https://api.themoviedb.org/3/${type}/${sessionPrefs.recentIds[0]}/recommendations?api_key=${API_KEY}`
            );
            const d = await r.json();
            bucket.push(...(d.results || []).slice(0, 8));
        } catch (_) {}
    }

    // ── Strategy B: genre-weighted Discover (kicks in once ≥1 click recorded) ──
    const topGenres = getTopGenres(2);
    if (topGenres.length) {
        try {
            const r = await fetch(
                `https://api.themoviedb.org/3/discover/${type}?api_key=${API_KEY}` +
                `&with_genres=${topGenres.join(",")}&sort_by=popularity.desc&vote_count.gte=80`
            );
            const d = await r.json();
            bucket.push(...(d.results || []).slice(0, 6));
        } catch (_) {}
    }

    // ── Strategy C: search-seeded discover (no clicks yet — cold-start via search) ──
    if (!hasClicks && hasSearch) {
        try {
            const r = await fetch(
                `https://api.themoviedb.org/3/search/${type}?api_key=${API_KEY}` +
                `&query=${encodeURIComponent(sessionPrefs.searchTerms[0])}`
            );
            const d = await r.json();
            // Seed genre weights from top search results
            (d.results || []).slice(0, 3).forEach(m =>
                (m.genre_ids || []).forEach(gid => {
                    sessionPrefs.genreWeights[gid] = (sessionPrefs.genreWeights[gid] || 0) + 1;
                })
            );
            const g = getTopGenres(2);
            if (g.length) {
                const r2 = await fetch(
                    `https://api.themoviedb.org/3/discover/${type}?api_key=${API_KEY}` +
                    `&with_genres=${g.join(",")}&sort_by=popularity.desc&vote_count.gte=80`
                );
                const d2 = await r2.json();
                bucket.push(...(d2.results || []).slice(0, 8));
            }
        } catch (_) {}
    }

    // Deduplicate across all strategies
    const deduped = [];
    for (const m of bucket) {
        if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            deduped.push(m);
        }
    }

    if (!deduped.length) { hideRecSection(); return; }

    const label = hasClicks
        ? `Based on "${sessionPrefs.recentTitles[0]}"`
        : `Based on your search for "${sessionPrefs.searchTerms[0]}"`;

    renderRecSection(deduped.slice(0, 14), label, type);
}

// ─── Recommendation section DOM helpers ───────────────────────────────────────
const REC_CONFIG = {
    firstTrigger: 5,
    refreshEvery: 3,
    maxTrackedTitles: 6,
    maxSearchTerms: 6,
    maxSearchSeeds: 8,
    maxHistoryItems: 20,
    maxKeywordWeights: 36
};

const STOP_WORDS = new Set([
    "a", "about", "after", "all", "also", "an", "and", "are", "as", "at", "be",
    "because", "been", "before", "being", "between", "but", "by", "can", "could",
    "did", "do", "does", "during", "each", "for", "from", "had", "has", "have",
    "he", "her", "him", "his", "how", "if", "in", "into", "is", "it", "its",
    "just", "more", "most", "new", "no", "not", "of", "on", "one", "only", "or",
    "our", "out", "over", "she", "so", "some", "story", "than", "that", "the",
    "their", "them", "then", "there", "these", "they", "this", "those", "through",
    "to", "too", "under", "up", "very", "was", "we", "were", "what", "when",
    "where", "which", "who", "will", "with", "would", "you", "your"
]);

const mediaCache = new Map();
let pendingSearchTracking = null;
let _recRequestId = 0;

function createProfile() {
    return {
        genreWeights: {},
        languageWeights: {},
        keywordWeights: {},
        recentIds: [],
        recentTitles: [],
        searchTerms: [],
        clickedItems: [],
        searchSeeds: [],
        history: [],
        interactionCount: 0,
        lastRecommendationAt: 0,
        hasShownRecommendations: false,
        lastRenderedRecommendationIds: []
    };
}

sessionPrefs.profiles = {
    movie: createProfile(),
    tv: createProfile()
};
sessionPrefs.interactionCount = 0;
sessionPrefs.clickCount = 0;
sessionPrefs.searchCount = 0;

function getProfile(type = "movie") {
    return sessionPrefs.profiles[type] || sessionPrefs.profiles.movie;
}

function movieCacheKey(id, type) {
    return `${type}:${id}`;
}

function getGenreIds(movie) {
    if (Array.isArray(movie?.genreIds) && movie.genreIds.length) return movie.genreIds;
    if (Array.isArray(movie?.genre_ids) && movie.genre_ids.length) return movie.genre_ids.filter(Boolean);
    if (Array.isArray(movie?.genres) && movie.genres.length) {
        return movie.genres.map(g => g.id).filter(Boolean);
    }
    return [];
}

function cacheMovie(movie, type) {
    if (!movie?.id) return null;

    const key = movieCacheKey(movie.id, type);
    const prev = mediaCache.get(key) || {};
    const genreIds = getGenreIds(movie);
    const cached = {
        ...prev,
        ...movie,
        id: movie.id,
        type,
        title: movie.title || movie.name || prev.title || "Untitled",
        overview: movie.overview || prev.overview || "",
        genreIds: genreIds.length ? genreIds : (prev.genreIds || []),
        originalLanguage: movie.original_language || prev.originalLanguage || null,
        voteAverage: typeof movie.vote_average === "number" ? movie.vote_average : (prev.voteAverage || 0),
        popularity: typeof movie.popularity === "number" ? movie.popularity : (prev.popularity || 0)
    };

    mediaCache.set(key, cached);
    return cached;
}

function getCachedMovie(id, type) {
    return mediaCache.get(movieCacheKey(id, type));
}

function pushUniqueValue(list, value, max) {
    const next = [value, ...list.filter(item => item !== value)].slice(0, max);
    list.length = 0;
    list.push(...next);
}

function pushUniqueMovie(list, movie, max) {
    const next = [movie, ...list.filter(item => !(item.id === movie.id && item.type === movie.type))].slice(0, max);
    list.length = 0;
    list.push(...next);
}

function pushHistory(list, entry, max) {
    list.unshift(entry);
    if (list.length > max) list.length = max;
}

function trimWeightTable(weightTable, maxEntries) {
    const topEntries = Object.entries(weightTable)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxEntries);

    Object.keys(weightTable).forEach(key => delete weightTable[key]);
    topEntries.forEach(([key, value]) => { weightTable[key] = value; });
}

function addGenreWeights(weightTable, genreIds, weight) {
    genreIds.forEach(gid => {
        if (!gid) return;
        weightTable[gid] = (weightTable[gid] || 0) + weight;
    });
}

function addLanguageWeight(weightTable, languageCode, weight) {
    if (!languageCode) return;
    weightTable[languageCode] = (weightTable[languageCode] || 0) + weight;
}

function extractKeywords(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

function addKeywordWeights(weightTable, text, weight) {
    extractKeywords(text).forEach(word => {
        weightTable[word] = (weightTable[word] || 0) + weight;
    });
    trimWeightTable(weightTable, REC_CONFIG.maxKeywordWeights);
}

function registerInteraction(kind, type) {
    const profile = getProfile(type);
    sessionPrefs.interactionCount += 1;
    if (kind === "click") sessionPrefs.clickCount += 1;
    if (kind === "search") sessionPrefs.searchCount += 1;
    sessionPrefs.lastType = type;
    profile.interactionCount += 1;
}

function shouldGenerateRecommendations(profile) {
    if (profile.interactionCount < REC_CONFIG.firstTrigger) return false;
    if (!profile.hasShownRecommendations) return true;
    return (profile.interactionCount - profile.lastRecommendationAt) >= REC_CONFIG.refreshEvery;
}

function trackMovieClick(id, genreIds, title, type, overview = "") {
    if (!id) return;

    const cachedMovie = getCachedMovie(id, type);
    const safeType = type || cachedMovie?.type || state.type;
    const safeGenres = genreIds?.length ? genreIds : (cachedMovie?.genreIds || []);
    const safeTitle = title || cachedMovie?.title || "Untitled";
    const safeOverview = overview || cachedMovie?.overview || "";
    const safeLanguage = cachedMovie?.originalLanguage || null;

    const profile = getProfile(safeType);
    registerInteraction("click", safeType);

    addGenreWeights(profile.genreWeights, safeGenres, 3.5);
    addLanguageWeight(profile.languageWeights, safeLanguage, INDIAN_LANGUAGE_CODES.has(safeLanguage) ? 4.5 : 2.25);
    addKeywordWeights(profile.keywordWeights, `${safeTitle} ${safeOverview}`, 2.1);

    pushUniqueValue(profile.recentIds, id, REC_CONFIG.maxTrackedTitles);
    pushUniqueValue(profile.recentTitles, safeTitle, REC_CONFIG.maxTrackedTitles);
    pushUniqueMovie(profile.clickedItems, {
        id,
        type: safeType,
        title: safeTitle,
        overview: safeOverview,
        genreIds: safeGenres,
        originalLanguage: safeLanguage
    }, REC_CONFIG.maxTrackedTitles);
    pushHistory(profile.history, {
        source: "click",
        id,
        type: safeType,
        title: safeTitle,
        overview: safeOverview,
        genreIds: safeGenres,
        originalLanguage: safeLanguage
    }, REC_CONFIG.maxHistoryItems);

    scheduleRecs();
}

function trackSearch(query, type = state.type) {
    if (!query) return;

    const profile = getProfile(type);
    registerInteraction("search", type);

    pushUniqueValue(profile.searchTerms, query, REC_CONFIG.maxSearchTerms);
    addKeywordWeights(profile.keywordWeights, query, 1.1);
    pendingSearchTracking = { query, type };
}

function absorbSearchResults(query, results, type) {
    const profile = getProfile(type);
    const searchSeeds = (results || [])
        .slice(0, 4)
        .map(movie => cacheMovie(movie, type))
        .filter(Boolean);

    searchSeeds.forEach((movie, index) => {
        const weight = Math.max(1.2, 2.7 - (index * 0.45));
        addGenreWeights(profile.genreWeights, movie.genreIds, weight);
        addLanguageWeight(
            profile.languageWeights,
            movie.originalLanguage,
            INDIAN_LANGUAGE_CODES.has(movie.originalLanguage) ? weight * 1.6 : weight
        );
        addKeywordWeights(profile.keywordWeights, `${movie.title} ${movie.overview}`, weight);
        pushUniqueMovie(profile.searchSeeds, {
            id: movie.id,
            type,
            title: movie.title,
            overview: movie.overview,
            genreIds: movie.genreIds,
            originalLanguage: movie.originalLanguage,
            query
        }, REC_CONFIG.maxSearchSeeds);
        pushHistory(profile.history, {
            source: "search",
            id: movie.id,
            type,
            title: movie.title,
            overview: movie.overview,
            genreIds: movie.genreIds,
            originalLanguage: movie.originalLanguage,
            query
        }, REC_CONFIG.maxHistoryItems);
    });

    scheduleRecs();
}

function scheduleRecs() {
    clearTimeout(_recTimer);
    _recTimer = setTimeout(generateRecommendationsIfNeeded, 700);
}

function getTopGenres(profile, n) {
    return Object.entries(profile.genreWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([id]) => id);
}

function getTopLanguages(profile, n) {
    return Object.entries(profile.languageWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([languageCode]) => languageCode);
}

function scoreCandidate(movie, profile, blockedIds) {
    if (!movie?.id || blockedIds.has(movie.id)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    const languageScore = profile.languageWeights[movie.originalLanguage] || 0;
    const indianLanguagePreference = Object.entries(profile.languageWeights)
        .filter(([languageCode]) => INDIAN_LANGUAGE_CODES.has(languageCode))
        .reduce((sum, [, weight]) => sum + weight, 0);

    movie.genreIds.forEach(gid => {
        score += profile.genreWeights[gid] || 0;
    });

    score += languageScore * 3.4;

    if (indianLanguagePreference > 0) {
        if (INDIAN_LANGUAGE_CODES.has(movie.originalLanguage)) {
            score += indianLanguagePreference * 0.85;
        } else if (movie.originalLanguage === "en") {
            score -= indianLanguagePreference * 0.45;
        }
    }

    extractKeywords(`${movie.title} ${movie.overview}`).forEach(word => {
        score += (profile.keywordWeights[word] || 0) * 1.35;
    });

    score += Math.min(movie.voteAverage || 0, 10) * 0.35;
    score += Math.min(movie.popularity || 0, 120) * 0.025;

    return score;
}

function buildRecLabel(profile, isRefresh = false) {
    const hasClicks = profile.clickedItems.length > 0;
    const hasSearches = profile.searchTerms.length > 0;

    if (isRefresh && hasClicks && hasSearches) return "Updated from your latest clicks and searches";
    if (isRefresh) return "Updated from your latest activity";
    if (hasClicks && hasSearches) return "Built from your recent clicks and searches";
    if (hasClicks && profile.clickedItems.length > 1) {
        return `Inspired by ${profile.clickedItems[0].title} and ${profile.clickedItems[1].title}`;
    }
    if (hasClicks) return `Inspired by ${profile.clickedItems[0].title}`;
    if (hasSearches && profile.searchTerms.length > 1) return "Built from your recent searches";
    if (hasSearches) return `Based on your search for "${profile.searchTerms[0]}"`;
    return "Built from your recent activity";
}

async function fetchCandidateList(url, type) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.results || [])
            .map(movie => cacheMovie(movie, type))
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

async function generateRecommendationsIfNeeded() {
    const type = sessionPrefs.lastType || state.type;
    const profile = getProfile(type);
    if (!shouldGenerateRecommendations(profile)) return;
    await generateRecommendations(type, profile);
}

async function generateRecommendations(type = sessionPrefs.lastType || state.type, profile = getProfile(type)) {
    const hasClicks = profile.clickedItems.length > 0;
    const hasSearch = profile.searchTerms.length > 0;
    if (!hasClicks && !hasSearch) return;

    const requestId = ++_recRequestId;
    const isRefresh = profile.hasShownRecommendations;
    showRecLoading();

    const topGenres = getTopGenres(profile, 3);
    const topLanguages = getTopLanguages(profile, 2);
    const preferredLanguages = Array.from(new Set([
        ...(state.lang ? [state.lang] : []),
        ...topLanguages
    ])).slice(0, 3);
    const urls = [];

    profile.clickedItems.slice(0, 4).forEach(movie => {
        urls.push(`https://api.themoviedb.org/3/${type}/${movie.id}/recommendations?api_key=${API_KEY}`);
        urls.push(`https://api.themoviedb.org/3/${type}/${movie.id}/similar?api_key=${API_KEY}`);
    });

    if (topGenres.length) {
        urls.push(
            `https://api.themoviedb.org/3/discover/${type}?api_key=${API_KEY}` +
            `&with_genres=${topGenres.join(",")}&sort_by=popularity.desc&vote_count.gte=80`
        );
    }

    preferredLanguages.forEach(languageCode => {
        urls.push(
            `https://api.themoviedb.org/3/discover/${type}?api_key=${API_KEY}` +
            `&with_original_language=${languageCode}&sort_by=popularity.desc&vote_count.gte=50`
        );

        if (topGenres.length) {
            urls.push(
                `https://api.themoviedb.org/3/discover/${type}?api_key=${API_KEY}` +
                `&with_original_language=${languageCode}&with_genres=${topGenres.join(",")}` +
                `&sort_by=popularity.desc&vote_count.gte=30`
            );
        }
    });

    profile.searchTerms.slice(0, 3).forEach(query => {
        urls.push(
            `https://api.themoviedb.org/3/search/${type}?api_key=${API_KEY}` +
            `&query=${encodeURIComponent(query)}`
        );
    });

    if (!urls.length) {
        hideRecSection();
        return;
    }

    const bucket = (await Promise.all(urls.map(url => fetchCandidateList(url, type)))).flat();
    if (requestId !== _recRequestId) return;

    const blockedIds = new Set([
        ...profile.recentIds,
        ...profile.searchSeeds.map(movie => movie.id)
    ]);
    const previouslyRenderedIds = new Set(profile.lastRenderedRecommendationIds);
    const seenIds = new Set();
    const ranked = [];

    bucket.forEach(movie => {
        if (!movie?.id || seenIds.has(movie.id)) return;
        seenIds.add(movie.id);

        const score = scoreCandidate(movie, profile, blockedIds);
        if (score === Number.NEGATIVE_INFINITY) return;

        ranked.push({ movie, score });
    });

    ranked.sort((a, b) => b.score - a.score);
    const recommendations = [];

    ranked
        .filter(entry => !previouslyRenderedIds.has(entry.movie.id))
        .slice(0, 14)
        .forEach(entry => recommendations.push(entry.movie));

    if (recommendations.length < 14) {
        ranked.forEach(entry => {
            if (recommendations.length >= 14) return;
            if (recommendations.some(movie => movie.id === entry.movie.id)) return;
            recommendations.push(entry.movie);
        });
    }

    if (!recommendations.length) {
        hideRecSection();
        return;
    }

    profile.hasShownRecommendations = true;
    profile.lastRecommendationAt = profile.interactionCount;
    profile.lastRenderedRecommendationIds = recommendations.map(movie => movie.id);

    renderRecSection(recommendations, buildRecLabel(profile, isRefresh), type);
}

function openTrackedMovieFromBox(box) {
    const type = box.dataset.mediaType || "movie";
    const id = Number(box.dataset.movieId);
    if (!id) return;

    const cachedMovie = getCachedMovie(id, type);
    const genreIds = cachedMovie?.genreIds || (box.dataset.genreIds || "").split(",").map(Number).filter(Boolean);
    const title = cachedMovie?.title || box.dataset.title || "Untitled";
    const overview = cachedMovie?.overview || "";

    trackMovieClick(id, genreIds, title, type, overview);
    openMovieModal(id, type);
}

const recSection = document.getElementById("recSection");
const recTrack   = document.getElementById("recTrack");
const recLabel   = document.getElementById("recLabel");
const recPulse   = document.getElementById("recPulse");

function showRecLoading() {
    recPulse.style.display = "block";
    recLabel.textContent   = "Finding recommendations…";
    if (!recSection.classList.contains("active")) {
        recSection.classList.add("active");
    }
    recTrack.innerHTML = `
        <div class="rec-skeleton"></div>
        <div class="rec-skeleton"></div>
        <div class="rec-skeleton"></div>
        <div class="rec-skeleton"></div>
        <div class="rec-skeleton"></div>`;
}

function hideRecSection() {
    recSection.classList.remove("active");
}

function renderRecSection(movies, label, type) {
    recPulse.style.display = "none";
    recLabel.textContent   = label;

    recTrack.innerHTML = "";
    movies.forEach(movie => {
        const cachedMovie = cacheMovie(movie, type) || movie;
        const title  = cachedMovie.title || cachedMovie.name || "Untitled";
        const year   = (cachedMovie.release_date || cachedMovie.first_air_date || "").slice(0, 4) || "N/A";
        const imgSrc = cachedMovie.backdrop_path
            ? `https://image.tmdb.org/t/p/w500${cachedMovie.backdrop_path}`
            : "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg";
        const genres = (cachedMovie.genreIds || [])
            .map(id => Object.keys(genreMap).find(k => genreMap[k] === id))
            .filter(Boolean).slice(0, 2).join(", ") || "N/A";

        const card = document.createElement("div");
        card.className = "box";
        card.dataset.movieId   = cachedMovie.id;
        card.dataset.mediaType = type;
        card.dataset.genreIds  = (cachedMovie.genreIds || []).join(",");
        card.dataset.title     = title;
        card.innerHTML = `
            <div class="poster">
                <img src="${imgSrc}" alt="${title}" loading="lazy"
                    onerror="this.src='https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg'">
            </div>
            <div class="movie_details">
                <div class="movie_name">${title}</div>
                <div class="movie_genre">${genres}</div>
                <div class="movie_year">${year}</div>
            </div>`;
        recTrack.appendChild(card);
    });
}

// Click handler for rec-section cards (same modal, also updates prefs)
recTrack.addEventListener("click", (e) => {
    const box = e.target.closest(".box");
    if (!box) return;
    openTrackedMovieFromBox(box);
});

// ─── Build fetch URL ───────────────────────────────────────────────────────────
function buildURL(page) {
    if (state.isSearch) {
        return `https://api.themoviedb.org/3/search/${state.type}?api_key=${API_KEY}&query=${encodeURIComponent(state.searchQuery)}&page=${page}`;
    }
    let url = `https://api.themoviedb.org/3/discover/${state.type}?api_key=${API_KEY}&page=${page}`;
    if (state.lang)        url += `&with_original_language=${state.lang}`;
    if (state.year) {
        const yearParam = state.type === "tv" ? "first_air_date_year" : "primary_release_year";
        url += `&${yearParam}=${state.year}`;
    }
    if (state.with_genres) url += `&with_genres=${state.with_genres}`;
    if (state.sort_by)     url += `&sort_by=${state.sort_by}`;
    return url;
}

// ─── Fetch & render ────────────────────────────────────────────────────────────
async function fetchAndRender(page) {
    page = Math.max(1, Math.min(page, state.totalPages || 1));
    const url = buildURL(page);

    pageContainer.innerHTML = `
        <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;
            height:200px;color:#556677;font-family:'Urbanist';font-size:0.75rem;letter-spacing:0.05em;">
            Loading…
        </div>`;
    paginationEl.innerHTML = "";

    let result;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result = await res.json();
    } catch (err) {
        pageContainer.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ff4422;
                font-family:'Urbanist';font-size:0.75rem;">
                Failed to load. Please try again.
            </div>`;
        return;
    }

    state.currentPage = result.page;
    state.totalPages  = Math.min(result.total_pages, 400); // TMDB caps at 500; 400 is safe

    renderCards(result.results);
    if (
        pendingSearchTracking &&
        state.isSearch &&
        page === 1 &&
        pendingSearchTracking.query === state.searchQuery &&
        pendingSearchTracking.type === state.type
    ) {
        absorbSearchResults(pendingSearchTracking.query, result.results, state.type);
        pendingSearchTracking = null;
    }
    renderPagination(state.currentPage, state.totalPages);

    // Scroll to top of results section
    sectionMain.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Render cards ──────────────────────────────────────────────────────────────
function renderCards(movies) {
    if (!movies || movies.length === 0) {
        pageContainer.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#556677;
                font-family:'Urbanist';font-size:0.75rem;">
                No results found.
            </div>`;
        return;
    }

    pageContainer.innerHTML = "";
    movies.forEach(movie => {
        const cachedMovie = cacheMovie(movie, state.type) || movie;
        const title = cachedMovie.title || cachedMovie.name || "Untitled";
        const year  = (cachedMovie.release_date || cachedMovie.first_air_date || "").slice(0, 4) || "N/A";
        const imgSrc = cachedMovie.backdrop_path
            ? `https://image.tmdb.org/t/p/w500${cachedMovie.backdrop_path}`
            : "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg";

        const genres = (cachedMovie.genreIds || [])
            .map(id => Object.keys(genreMap).find(k => genreMap[k] === id))
            .filter(Boolean).slice(0, 2).join(", ") || "N/A";

        const card = document.createElement("div");
        card.className = "box";
        card.dataset.movieId   = cachedMovie.id;
        card.dataset.mediaType = state.type;
        card.dataset.genreIds  = (cachedMovie.genreIds || []).join(",");
        card.dataset.title     = title;
        card.innerHTML = `
            <div class="poster">
                <img src="${imgSrc}" alt="${title}" loading="lazy"
                    onerror="this.src='https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg'">
            </div>
            <div class="movie_details">
                <div class="movie_name">${title}</div>
                <div class="movie_genre">${genres}</div>
                <div class="movie_year">${year}</div>
            </div>`;
        pageContainer.appendChild(card);
    });
}

// ─── Pagination ────────────────────────────────────────────────────────────────
// Builds:  ‹  1  …  4 [5] 6  …  20  ›
function buildPageRange(current, total) {
    if (total <= 1) return [];

    const delta = 2; // pages each side of current
    const range = [];
    const rangeWithDots = [];

    // always include 1 and total
    const left  = Math.max(2, current - delta);
    const right = Math.min(total - 1, current + delta);

    range.push(1);
    for (let i = left; i <= right; i++) range.push(i);
    if (!range.includes(total)) range.push(total);

    // insert dots
    let prev;
    for (const page of range) {
        if (prev) {
            if (page - prev === 2) {
                rangeWithDots.push(prev + 1);           // single missing page → show it
            } else if (page - prev > 2) {
                rangeWithDots.push("…");                // gap → ellipsis
            }
        }
        rangeWithDots.push(page);
        prev = page;
    }

    return rangeWithDots;
}

function renderPagination(current, total) {
    paginationEl.innerHTML = "";
    if (total <= 1) return;

    const make = (label, page, cls = "") => {
        const btn = document.createElement("button");
        btn.className = `pg-btn ${cls}`;
        btn.textContent = label;
        if (page !== null) btn.dataset.page = page;
        return btn;
    };

    // Prev
    const prev = make("‹", current - 1, "pg-prev");
    if (current === 1) prev.disabled = true;
    paginationEl.appendChild(prev);

    // Page numbers
    for (const item of buildPageRange(current, total)) {
        if (item === "…") {
            paginationEl.appendChild(make("…", null, "pg-dots"));
        } else {
            const cls = item === current ? "pg-active" : "";
            paginationEl.appendChild(make(item, item, cls));
        }
    }

    // Next
    const next = make("›", current + 1, "pg-next");
    if (current === total) next.disabled = true;
    paginationEl.appendChild(next);

    // Click handler
    paginationEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".pg-btn");
        if (!btn || btn.disabled || btn.classList.contains("pg-dots") || btn.classList.contains("pg-active")) return;
        const targetPage = parseInt(btn.dataset.page, 10);
        if (!isNaN(targetPage)) fetchAndRender(targetPage);
    }, { once: true });
}

// ─── Search ────────────────────────────────────────────────────────────────────
function doSearch() {
    const q = searchBox.value.trim();
    if (!q) return;
    trackSearch(q);                      // ← record for recommendation engine
    state.isSearch   = true;
    state.searchQuery = q;
    state.totalPages = 1;
    mainHeading.textContent = `Search: "${q}"`;
    secondaryFilter.style.pointerEvents = "none";
    secondaryFilter.style.opacity = "0.4";
    fetchAndRender(1);
}

searchBtn.addEventListener("click", doSearch);
searchBox.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

// ─── Primary filter ────────────────────────────────────────────────────────────
primaryFilter.addEventListener("click", (e) => {
    if (e.target.closest("#lang_select")) return;
    const id = e.target.id;
    if (!id || !industries[id]) return;
    resetSearch();
    state.lang = id;
    mainHeading.textContent = `${industries[id]} — ${state.type === "movie" ? "Movies" : "Series"}`;
    fetchAndRender(1);
});

langSelect.addEventListener("change", () => {
    const langCode = langSelect.selectedOptions[0]?.id;
    if (!langCode || !industries[langCode]) return;
    resetSearch();
    state.lang = langCode;
    mainHeading.textContent = `${industries[langCode]} — ${state.type === "movie" ? "Movies" : "Series"}`;
    fetchAndRender(1);
});

// ─── Secondary filter ──────────────────────────────────────────────────────────
const moviesBtn    = document.querySelector(".movies_select");
const webSeriesBtn = document.querySelector(".web-series_select");

secondaryFilter.addEventListener("click", (e) => {
    if (e.target.closest(".dropdown")) return;
    if (e.target === secondaryFilter) return;

    if (e.target.classList.contains("movies_select")) {
        if (state.type === "movie") return;
        state.type = "movie";
        moviesBtn.classList.add("selected");
        webSeriesBtn.classList.remove("selected");
    } else if (e.target.classList.contains("web-series_select")) {
        if (state.type === "tv") return;
        state.type = "tv";
        webSeriesBtn.classList.add("selected");
        moviesBtn.classList.remove("selected");
    }
    updateHeading();
    fetchAndRender(1);
});

secondaryFilter.addEventListener("change", (e) => {
    const sel = e.target;
    const val = sel.value;
    const wrap = sel.parentElement;

    if (val === "none") {
        wrap.classList.remove("selected");
    } else {
        wrap.classList.add("selected");
    }

    if (wrap.classList.contains("year_select")) {
        state.year = val === "none" ? null : val;
    } else if (wrap.classList.contains("genre_select")) {
        state.with_genres = val === "none" ? null : genreMap[val];
    } else if (wrap.classList.contains("sort-by")) {
        state.sort_by = val === "none" ? null : val;
    }

    fetchAndRender(1);
});

function updateHeading() {
    const typeLabel = state.type === "movie" ? "Movies" : "Series";
    // preserve any industry prefix already in heading
    const current = mainHeading.textContent;
    if (current.includes("—")) {
        mainHeading.textContent = current.split("—")[0].trim() + " — " + typeLabel;
    } else {
        mainHeading.textContent = `Discover — ${typeLabel}`;
    }
}

function resetSearch() {
    state.isSearch = false;
    state.searchQuery = "";
    state.lang = null;
    pendingSearchTracking = null;
    secondaryFilter.style.pointerEvents = "auto";
    secondaryFilter.style.opacity = "1";
}

// ─── Card click → modal ────────────────────────────────────────────────────────
pageContainer.addEventListener("click", (e) => {
    const box = e.target.closest(".box");
    if (!box) return;
    openTrackedMovieFromBox(box);
});

// ─── Modal ─────────────────────────────────────────────────────────────────────
const modal        = document.getElementById("movieModal");
const modalClose   = document.getElementById("modalClose");
const modalLoading = document.getElementById("modalLoading");
const modalCard    = document.getElementById("modalCard");

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

function closeModal() { modal.classList.remove("active"); }

async function openMovieModal(id, type) {
    modal.classList.add("active");
    modalLoading.classList.add("show");
    modalCard.scrollTop = 0;

    // Reset
    ["modalTitle","modalMeta","modalGenres","modalOverview","modalCast","modalStreaming"]
        .forEach(i => { document.getElementById(i).innerHTML = ""; });
    document.getElementById("modalRating").textContent = "";
    document.getElementById("modalBackdrop").classList.remove("loaded");

    try {
        const [detRes, provRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${API_KEY}&append_to_response=credits`),
            fetch(`https://api.themoviedb.org/3/${type}/${id}/watch/providers?api_key=${API_KEY}`)
        ]);
        if (!detRes.ok) throw new Error(`Details HTTP ${detRes.status}`);
        populateModal(await detRes.json(), await provRes.json(), type);
    } catch (err) {
        document.getElementById("modalTitle").textContent = "Could not load details.";
    } finally {
        modalLoading.classList.remove("show");
    }
}

function populateModal(d, providers, type) {
    cacheMovie(d, type);

    // Backdrop
    const bd = document.getElementById("modalBackdrop");
    if (d.backdrop_path) {
        bd.onload = () => bd.classList.add("loaded");
        bd.src = `https://image.tmdb.org/t/p/w1280${d.backdrop_path}`;
    }

    // Poster
    document.getElementById("modalPoster").src = d.poster_path
        ? `https://image.tmdb.org/t/p/w342${d.poster_path}`
        : "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg";

    // Title
    document.getElementById("modalTitle").textContent =
        (type === "movie" ? d.title : d.name) || "Untitled";

    // Rating
    const rEl = document.getElementById("modalRating");
    if (d.vote_average > 0) {
        rEl.textContent = `⭐ ${d.vote_average.toFixed(1)} / 10`;
        rEl.style.display = "";
    } else { rEl.style.display = "none"; }

    // Meta
    const year = (type === "movie" ? d.release_date : d.first_air_date)?.slice(0,4);
    const rt   = type === "movie"
        ? d.runtime ? `${d.runtime} min` : null
        : d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min/ep` : null;
    document.getElementById("modalMeta").innerHTML =
        [year, rt, d.status, d.vote_count ? `${d.vote_count.toLocaleString()} votes` : null]
        .filter(Boolean).join(" &bull; ");

    // Genres
    document.getElementById("modalGenres").innerHTML =
        (d.genres || []).map(g => `<span class="genre-tag">${g.name}</span>`).join("");

    // Overview
    document.getElementById("modalOverview").textContent =
        d.overview || "No overview available.";

    // Cast
    const castEl   = document.getElementById("modalCast");
    const castList = d.credits?.cast?.slice(0, 10) || [];
    castEl.innerHTML = castList.length ? castList.map(c => `
        <div class="cast-member">
            <img src="${c.profile_path ? "https://image.tmdb.org/t/p/w185"+c.profile_path : ""}"
                alt="${c.name}"
                onerror="this.src='';this.style.background='var(--bg-surface)';">
            <span class="cast-name">${c.name}</span>
            <span class="cast-char">${c.character || ""}</span>
        </div>`).join("") : '<p class="no-stream">Cast info not available.</p>';

    // Streaming
    const streamEl  = document.getElementById("modalStreaming");
    const region    = providers.results?.IN || providers.results?.US || null;
    if (!region) {
        streamEl.innerHTML = '<p class="no-stream">Not available on any streaming platform.</p>';
        return;
    }
    let html = "";
    if (region.flatrate?.length) html += buildStreamGroup("Stream",  region.flatrate);
    if (region.rent?.length)     html += buildStreamGroup("Rent",    region.rent);
    if (region.buy?.length)      html += buildStreamGroup("Buy",     region.buy);
    streamEl.innerHTML = html || '<p class="no-stream">Not listed on streaming platforms.</p>';
    if (region.link) {
        streamEl.innerHTML += `<a href="${region.link}" target="_blank" rel="noopener"
            style="display:block;margin-top:.6rem;font-family:'Urbanist';
            font-size:0.4rem;color:var(--text-lo);text-decoration:none;">
            Powered by JustWatch ↗</a>`;
    }
}

function buildStreamGroup(label, list) {
    return `<div class="stream-group">
        <span class="stream-label">${label}</span>
        <div class="stream-logos">
            ${list.map(p => `
                <div class="stream-provider" title="${p.provider_name}">
                    <img src="https://image.tmdb.org/t/p/w92${p.logo_path}"
                        alt="${p.provider_name}"
                        onerror="this.parentElement.style.display='none'">
                    <span>${p.provider_name}</span>
                </div>`).join("")}
        </div>
    </div>`;
}

// ─── Boot ───────────────────────────────────────────────────────────────────────
mainHeading.textContent = "Discover — Movies";
populateYearOptions();
fetchAndRender(1);
