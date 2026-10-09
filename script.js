/* ==========================================================
   MUSIC EXPLORER — SCRIPT
   Data source: the iTunes Search/Lookup API — a free, keyless,
   mainstream music catalog. Real, well-known artists and songs are
   searchable; playback uses each track's 30-second preview clip via
   a plain <audio> element (iTunes doesn't offer full-length audio
   without a paid, authenticated service — see the README).

   Views, all built into #view-root:
     - HOME    : Top Songs / Popular Artists / Popular Albums / New Singles,
                 all derived from Apple's live "most played" chart
     - SEARCH  : an Artists row + a filterable Tracks row for a query
     - ARTIST  : one artist's profile — their songs, their albums,
                 and a "Play All" button
   Clicking the "Music Explorer" wordmark always returns to HOME.
   ========================================================== */

// ---- DOM references ----
const homeLink = document.getElementById("home-link");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const statusMessage = document.getElementById("status-message");
const viewRoot = document.getElementById("view-root");

const playerOverlay = document.getElementById("player-overlay");
const playerClose = document.getElementById("player-close");
const playerArt = document.getElementById("player-art");
const playerGenre = document.getElementById("player-genre");
const playerTrackName = document.getElementById("player-track-name");
const playerArtistAlbum = document.getElementById("player-artist-album");
const playerTags = document.getElementById("player-tags");
const progressFill = document.getElementById("progress-fill");
const timeCurrentEl = document.getElementById("player-time-current");
const timeTotalEl = document.getElementById("player-time-total");
const playBtn = document.getElementById("play-btn");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const volumeSlider = document.getElementById("volume-slider");
const previewNote = document.getElementById("preview-note");
const audioPlayer = document.getElementById("audio-player");

// ---- Player state ----
// playerQueue: whatever list of tracks the currently-open player is
// stepping through (Top Songs, an artist's tracks, one album's
// tracks, or a search's Tracks results — whichever list was clicked).
let playerQueue = [];
let currentTrackIndex = null;

// ---- "Tracks" list + genre filter state (Search view only) ----
let flatTracksAll = [];
let flatTracksVisible = [];
let flatActiveGenre = "all";
let flatTracksRowEl = null;
let flatGenreNavEl = null;

const artworkColorCache = new Map();

// ==========================================================
// ITUNES API LAYER
// ==========================================================
// Two endpoints, both free and keyless:
//   /search  — find things by term (songs, or entity=musicArtist for artists)
//   /lookup  — fetch by a known Apple/iTunes ID (an artist's own songs or
//              albums, or one album's full track list)

async function searchTracksITunes(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&media=music&entity=song&limit=40`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes search responded with status ${response.status}`);
  const data = await response.json();
  return data.results;
}

async function searchArtistsITunes(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&entity=musicArtist&limit=10`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes artist search responded with status ${response.status}`);
  const data = await response.json();
  return data.results;
}

async function fetchArtistTracks(artistId) {
  const url = `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=50`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes lookup responded with status ${response.status}`);
  const data = await response.json();
  // The first item in a lookup-by-artist-id result is the artist record
  // itself; wrapperType tells us which entries are actually tracks.
  return data.results.filter((r) => r.wrapperType === "track");
}

async function fetchArtistAlbums(artistId) {
  const url = `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=50`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes lookup responded with status ${response.status}`);
  const data = await response.json();
  return data.results.filter((r) => r.wrapperType === "collection");
}

async function fetchAlbumTracks(collectionId) {
  const url = `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&limit=50`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes lookup responded with status ${response.status}`);
  const data = await response.json();
  return data.results.filter((r) => r.wrapperType === "track");
}

// Apple's live "most played" chart — free, public, keyless. Gives us
// chart order + Apple catalog IDs; we then batch those IDs through the
// /lookup endpoint above to get full track records (artwork, genre,
// previewUrl, etc.) in a single extra request.
async function fetchTopChartTracks() {
  const chartUrl =
    "https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/songs.json";
  const chartResponse = await fetch(chartUrl);
  if (!chartResponse.ok) {
    throw new Error(`Apple charts feed responded with status ${chartResponse.status}`);
  }
  const chartData = await chartResponse.json();
  const chartEntries = chartData?.feed?.results || [];
  if (chartEntries.length === 0) throw new Error("Charts feed returned no entries");

  const ids = chartEntries
    .slice(0, 40)
    .map((entry) => entry.id)
    .filter(Boolean)
    .join(",");

  const lookupUrl = `https://itunes.apple.com/lookup?id=${ids}&entity=song`;
  const lookupResponse = await fetch(lookupUrl);
  if (!lookupResponse.ok) {
    throw new Error(`iTunes lookup responded with status ${lookupResponse.status}`);
  }
  const lookupData = await lookupResponse.json();
  return lookupData.results;
}

// ==========================================================
// NORMALIZATION — iTunes' raw fields -> the shape this app uses
// ==========================================================

function getHighResArtwork(artworkUrl100) {
  if (!artworkUrl100) return null;
  return artworkUrl100.replace("100x100bb", "600x600bb");
}

function normalizeTrack(t) {
  return {
    id: t.trackId,
    trackName: t.trackName || "Untitled track",
    artistName: t.artistName || "Unknown artist",
    artistId: t.artistId || null,
    collectionId: t.collectionId || null,
    collectionName: t.collectionName || null,
    genre: t.primaryGenreName || null,
    artworkUrl: getHighResArtwork(t.artworkUrl100),
    durationMs: t.trackTimeMillis || 0,
    releaseDate: t.releaseDate || null,
    previewUrl: t.previewUrl || null,
  };
}

function normalizeArtistFromTrack(t) {
  return { id: t.artistId, name: t.artistName, genre: t.primaryGenreName || null };
}

function normalizeArtistFromSearch(a) {
  return { id: a.artistId, name: a.artistName, genre: a.primaryGenreName || null };
}

function normalizeAlbumFromTrack(t) {
  return {
    id: t.collectionId,
    title: t.collectionName || "Untitled album",
    artistName: t.artistName,
    artistId: t.artistId,
    artworkUrl: getHighResArtwork(t.artworkUrl100),
    trackCount: null,
    tracks: [],
  };
}

function normalizeAlbumFromLookup(c) {
  return {
    id: c.collectionId,
    title: c.collectionName || "Untitled album",
    artistName: c.artistName,
    artistId: c.artistId,
    artworkUrl: getHighResArtwork(c.artworkUrl100),
    trackCount: c.trackCount || null,
    tracks: [],
  };
}

// ---- Deterministic "monogram" avatar for artists ----
// iTunes' API doesn't provide artist photos at all, so rather than show
// a broken image, every artist gets a colored circle with their
// initials. The color is hashed from their name, so it's consistent
// every time the same artist appears.
function hashHue(str) {
  let hash = 0;
  for (const char of str) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function monogramColor(name) {
  const [r, g, b] = hslToRgb(hashHue(name), 45, 22);
  return `rgb(${r}, ${g}, ${b})`;
}

// ==========================================================
// SEARCH — form submit routes to the Search view
// ==========================================================

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  performSearch(query);
});

async function performSearch(query) {
  handleLoading();
  try {
    const [rawArtists, rawTracks] = await Promise.all([
      searchArtistsITunes(query).catch(() => []),
      searchTracksITunes(query),
    ]);

    const artists = rawArtists.map(normalizeArtistFromSearch);
    const tracks = rawTracks.filter((t) => t.trackName && t.artistName).map(normalizeTrack);

    if (artists.length === 0 && tracks.length === 0) {
      handleEmpty();
      return;
    }

    renderSearchView(artists, tracks);
    clearStatus();
  } catch (error) {
    handleError(error, () => performSearch(query));
  }
}

function renderSearchView(artists, tracks) {
  viewRoot.innerHTML = "";

  if (artists.length > 0) {
    const artistCards = artists.map((artist) => createArtistCard(artist));
    viewRoot.appendChild(buildCarouselSection("Artists", artistCards));
  }

  if (tracks.length > 0) {
    viewRoot.appendChild(buildFilterableTracksSection("Tracks", tracks));
  }
}

// ==========================================================
// HOMEPAGE
// ==========================================================
// A single fetch of Apple's live chart feeds all four sections:
//   - Top Songs      -> the chart, in its real order
//   - Popular Artists -> unique artists from that same chart
//   - Popular Albums  -> unique albums from that same chart
//   - New Singles     -> that chart re-sorted by release date

homeLink.addEventListener("click", () => loadHomepage());

async function loadHomepage() {
  handleLoading();
  try {
    const rawTracks = await fetchTopChartTracks();
    const tracks = rawTracks.filter((t) => t.trackName && t.artistName).map(normalizeTrack);

    const topSongs = tracks.slice(0, 20);

    const seenArtistIds = new Set();
    const popularArtists = [];
    tracks.forEach((t) => {
      if (t.artistId && !seenArtistIds.has(t.artistId)) {
        seenArtistIds.add(t.artistId);
        popularArtists.push(normalizeArtistFromTrack(t));
      }
    });

    const seenAlbumIds = new Set();
    const popularAlbums = [];
    tracks.forEach((t) => {
      if (t.collectionId && !seenAlbumIds.has(t.collectionId)) {
        seenAlbumIds.add(t.collectionId);
        popularAlbums.push(normalizeAlbumFromTrack(t));
      }
    });

    const newSingles = [...tracks]
      .filter((t) => t.releaseDate)
      .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
      .slice(0, 20);

    renderHomeView({
      topSongs,
      popularArtists: popularArtists.slice(0, 16),
      popularAlbums: popularAlbums.slice(0, 16),
      newSingles,
    });
    clearStatus();
  } catch (error) {
    // If the live charts feed is unreachable, fall back to a broad
    // search so the homepage still has something real to show.
    console.warn("Top charts feed unavailable, falling back to search:", error);
    try {
      const rawTracks = await searchTracksITunes("top hits");
      const tracks = rawTracks.filter((t) => t.trackName && t.artistName).map(normalizeTrack);
      renderHomeView({ topSongs: tracks, popularArtists: [], popularAlbums: [], newSingles: [] });
      clearStatus();
    } catch (fallbackError) {
      handleError(fallbackError, () => loadHomepage());
    }
  }
}

function renderHomeView({ topSongs, popularArtists, popularAlbums, newSingles }) {
  viewRoot.innerHTML = "";

  if (topSongs.length > 0) {
    const cards = topSongs.map((track) => createTrackCard(track, topSongs));
    viewRoot.appendChild(buildCarouselSection("Top Songs", cards));
  }

  if (popularArtists.length > 0) {
    const cards = popularArtists.map((artist) => createArtistCard(artist));
    viewRoot.appendChild(buildCarouselSection("Popular Artists", cards));
  }

  if (popularAlbums.length > 0) {
    const cards = popularAlbums.map((album) => createAlbumCard(album));
    viewRoot.appendChild(buildCarouselSection("Popular Albums", cards));
  }

  if (newSingles.length > 0) {
    const cards = newSingles.map((track) => createTrackCard(track, newSingles));
    viewRoot.appendChild(buildCarouselSection("New Singles", cards));
  }

  if (viewRoot.children.length === 0) {
    handleEmpty();
  }
}

// ==========================================================
// ARTIST PROFILE
// ==========================================================

async function openArtistProfile(artist) {
  handleLoading();
  try {
    const [rawTracks, rawAlbums] = await Promise.all([
      fetchArtistTracks(artist.id),
      fetchArtistAlbums(artist.id).catch(() => []),
    ]);

    const tracks = rawTracks.filter((t) => t.trackName).map(normalizeTrack);
    const albums = rawAlbums.map(normalizeAlbumFromLookup);

    renderArtistView(artist, tracks, albums);
    clearStatus();
  } catch (error) {
    handleError(error, () => openArtistProfile(artist));
  }
}

function renderArtistView(artist, tracks, albums) {
  viewRoot.innerHTML = "";

  const header = document.createElement("section");
  header.className = "artist-profile-header";

  const initials = getInitials(artist.name);

  const metaParts = [];
  if (artist.genre) metaParts.push(artist.genre);
  if (tracks.length > 0) metaParts.push(`${tracks.length} song${tracks.length === 1 ? "" : "s"}`);
  if (albums.length > 0) metaParts.push(`${albums.length} album${albums.length === 1 ? "" : "s"}`);

  header.innerHTML = `
    <div class="artist-profile-art monogram-art" style="background: ${monogramColor(artist.name)}">
      <span class="monogram-text">${escapeHtml(initials)}</span>
    </div>
    <div>
      <h2 class="artist-profile-name">${escapeHtml(artist.name)}</h2>
      <p class="artist-profile-meta">${escapeHtml(metaParts.join(" · "))}</p>
      <button type="button" class="play-all-btn" id="play-all-btn" ${tracks.length === 0 ? "disabled" : ""}>
        ▶ Play All
      </button>
    </div>
  `;

  header.querySelector("#play-all-btn").addEventListener("click", () => {
    if (tracks.length === 0) return;
    openPlayer(tracks[0], tracks);
    if (tracks[0].previewUrl) audioPlayer.play();
  });

  viewRoot.appendChild(header);

  if (tracks.length > 0) {
    const cards = tracks.map((track) => createTrackCard(track, tracks));
    viewRoot.appendChild(buildCarouselSection("Songs", cards));
  }

  if (albums.length > 0) {
    const cards = albums.map((album) => createAlbumCard(album));
    viewRoot.appendChild(buildCarouselSection("Albums", cards));
  }
}

// ==========================================================
// CARD BUILDERS
// ==========================================================

function createTrackCard(track, queue) {
  const card = document.createElement("article");
  card.className = "track-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open player for ${track.trackName} by ${track.artistName}`);

  const tags = [];
  if (track.genre) tags.push(track.genre);

  card.innerHTML = `
    <div class="track-art-wrap">
      <img
        class="track-art"
        src="${track.artworkUrl || "https://dummyimage.com/400x400/1e1d22/5f5b66.png&text=No+Artwork"}"
        alt="Artwork for ${escapeHtml(track.trackName)}"
        loading="lazy"
      />
      <span class="play-affordance" aria-hidden="true">▶</span>
    </div>
    <div class="track-body">
      <h3 class="track-name">${escapeHtml(track.trackName)}</h3>
      <p class="track-artist-album">${escapeHtml(track.artistName)}</p>
      <div class="track-tags">
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </div>
  `;

  applyArtworkGlow(card, track.artworkUrl);

  card.addEventListener("click", () => openPlayer(track, queue));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPlayer(track, queue);
    }
  });

  return card;
}

function createArtistCard(artist) {
  const card = document.createElement("article");
  card.className = "track-card artist-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View artist profile for ${artist.name}`);

  const [glowR, glowG, glowB] = hslToRgb(hashHue(artist.name), 55, 50);
  const initials = getInitials(artist.name);

  card.innerHTML = `
    <div class="track-art-wrap monogram-art" style="background: ${monogramColor(artist.name)}">
      <span class="monogram-text">${escapeHtml(initials)}</span>
    </div>
    <div class="track-body">
      <h3 class="track-name">${escapeHtml(artist.name)}</h3>
      <p class="track-artist-album">${escapeHtml(artist.genre || "Artist")}</p>
    </div>
  `;
  card.style.setProperty("--glow", `${glowR}, ${glowG}, ${glowB}`);

  const openProfile = () => openArtistProfile(artist);
  card.addEventListener("click", openProfile);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProfile();
    }
  });

  return card;
}

function createAlbumCard(album) {
  const card = document.createElement("article");
  card.className = "track-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Play album ${album.title} by ${album.artistName}`);

  card.innerHTML = `
    <div class="track-art-wrap">
      <img
        class="track-art"
        src="${album.artworkUrl || "https://dummyimage.com/400x400/1e1d22/5f5b66.png&text=Album"}"
        alt="Artwork for ${escapeHtml(album.title)}"
        loading="lazy"
      />
      <span class="play-affordance" aria-hidden="true">▶</span>
    </div>
    <div class="track-body">
      <h3 class="track-name">${escapeHtml(album.title)}</h3>
      <p class="track-artist-album">${escapeHtml(album.artistName)}</p>
      <div class="track-tags">
        ${album.trackCount ? `<span class="tag">${album.trackCount} tracks</span>` : ""}
      </div>
    </div>
  `;

  applyArtworkGlow(card, album.artworkUrl);

  const play = () => playAlbum(album);
  card.addEventListener("click", play);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      play();
    }
  });

  return card;
}

async function playAlbum(album) {
  if (album.tracks.length > 0) {
    openPlayer(album.tracks[0], album.tracks);
    return;
  }
  try {
    const rawTracks = await fetchAlbumTracks(album.id);
    const tracks = rawTracks.map(normalizeTrack);
    if (tracks.length === 0) {
      flashStatus("That album doesn't have any playable tracks.");
      return;
    }
    album.tracks = tracks; // cache so a re-click is instant
    openPlayer(tracks[0], tracks);
  } catch (error) {
    console.error("Failed to load album tracks:", error);
    flashStatus("Couldn't load that album right now.");
  }
}

// ==========================================================
// CAROUSEL SECTIONS (shared by Home, Search, and Artist views)
// ==========================================================

function buildCarouselSection(title, cardElements) {
  const section = document.createElement("section");
  section.className = "content-section";

  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = title;
  section.appendChild(heading);

  section.appendChild(buildCarouselRow(cardElements));
  return section;
}

function buildCarouselRow(cardElements) {
  const carousel = document.createElement("div");
  carousel.className = "track-carousel";

  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.className = "carousel-arrow";
  leftBtn.setAttribute("aria-label", "Scroll left");
  leftBtn.textContent = "‹";

  const row = document.createElement("div");
  row.className = "track-grid";
  cardElements.forEach((card) => row.appendChild(card));

  const rightBtn = document.createElement("button");
  rightBtn.type = "button";
  rightBtn.className = "carousel-arrow";
  rightBtn.setAttribute("aria-label", "Scroll right");
  rightBtn.textContent = "›";

  function scrollRow(direction) {
    const firstCard = row.querySelector(".track-card");
    const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : 180;
    row.scrollBy({ left: direction * (cardWidth * 2 + 28), behavior: "smooth" });
  }

  leftBtn.addEventListener("click", () => scrollRow(-1));
  rightBtn.addEventListener("click", () => scrollRow(1));

  carousel.append(leftBtn, row, rightBtn);
  return carousel;
}

function buildFilterableTracksSection(title, tracks) {
  flatTracksAll = tracks;
  flatActiveGenre = "all";

  const section = document.createElement("section");
  section.className = "content-section";

  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = title;
  section.appendChild(heading);

  const genreNav = document.createElement("nav");
  genreNav.className = "genre-filter";
  genreNav.setAttribute("aria-label", "Filter by genre");
  section.appendChild(genreNav);
  flatGenreNavEl = genreNav;

  flatTracksVisible = tracks;
  const carousel = buildCarouselRow(tracks.map((t) => createTrackCard(t, flatTracksVisible)));
  section.appendChild(carousel);
  flatTracksRowEl = carousel.querySelector(".track-grid");

  populateGenreFilter(tracks);

  return section;
}

function populateGenreFilter(tracks) {
  const genres = Array.from(new Set(tracks.map((t) => t.genre).filter(Boolean))).sort();

  flatGenreNavEl.innerHTML = "";
  flatGenreNavEl.appendChild(createGenreChip("All Genres", "all"));
  genres.forEach((genre) => flatGenreNavEl.appendChild(createGenreChip(genre, genre)));
}

function createGenreChip(label, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "genre-chip";
  chip.textContent = label;
  chip.setAttribute("aria-pressed", String(value === flatActiveGenre));
  chip.addEventListener("click", () => {
    flatActiveGenre = value;
    flatGenreNavEl.querySelectorAll(".genre-chip").forEach((el) => {
      el.setAttribute("aria-pressed", String(el.textContent === label));
    });
    filterFlatTracks();
  });
  return chip;
}

function filterFlatTracks() {
  flatTracksVisible =
    flatActiveGenre === "all"
      ? flatTracksAll
      : flatTracksAll.filter((t) => t.genre === flatActiveGenre);

  flatTracksRowEl.innerHTML = "";
  flatTracksVisible.forEach((track) => {
    flatTracksRowEl.appendChild(createTrackCard(track, flatTracksVisible));
  });
}

// ==========================================================
// ARTWORK-BASED HOVER GLOW
// ==========================================================

async function applyArtworkGlow(cardEl, artworkUrl) {
  if (!artworkUrl) return;
  const rgb = await getDominantColor(artworkUrl);
  if (rgb) cardEl.style.setProperty("--glow", rgb);
}

function getDominantColor(imageUrl) {
  if (artworkColorCache.has(imageUrl)) {
    return Promise.resolve(artworkColorCache.get(imageUrl));
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 12;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);

        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        const boosted = boostColor(r, g, b);
        const rgb = `${boosted.r}, ${boosted.g}, ${boosted.b}`;
        artworkColorCache.set(imageUrl, rgb);
        resolve(rgb);
      } catch (err) {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function boostColor(r, g, b) {
  const max = Math.max(r, g, b);
  if (max === 0) return { r: 180, g: 180, b: 180 };
  const scale = Math.min(255 / max, 1.9);
  return {
    r: Math.min(255, Math.round(r * scale)),
    g: Math.min(255, Math.round(g * scale)),
    b: Math.min(255, Math.round(b * scale)),
  };
}

// ==========================================================
// EXPANDED PLAYER (a plain <audio> element — no external player,
// no API key, no quota, no "blocked outside YouTube" errors)
// ==========================================================

function openPlayer(track, queue) {
  playerQueue = queue;
  currentTrackIndex = queue.indexOf(track);
  updatePlayer(track);
  playerOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  playerClose.focus();
}

function closePlayer() {
  playerOverlay.hidden = true;
  document.body.style.overflow = "";
  audioPlayer.pause();
  playBtn.textContent = "▶";
}

function updatePlayer(track) {
  playerArt.src = track.artworkUrl || "https://dummyimage.com/400x400/1e1d22/5f5b66.png&text=No+Artwork";
  playerArt.alt = `Artwork for ${track.trackName}`;
  playerTrackName.textContent = track.trackName;
  playerGenre.textContent = track.genre || "";
  const albumLabel = track.collectionName ? ` · ${track.collectionName}` : "";
  playerArtistAlbum.textContent = `${track.artistName}${albumLabel}`;

  const tags = [];
  if (track.genre) tags.push(track.genre);
  playerTags.innerHTML = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");

  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  playBtn.textContent = "▶";
  progressFill.style.width = "0%";
  timeCurrentEl.textContent = "0:00";

  if (track.previewUrl) {
    audioPlayer.src = track.previewUrl;
    playBtn.disabled = false;
    previewNote.hidden = true;
    timeTotalEl.textContent = formatTime(track.durationMs || 0);
  } else {
    audioPlayer.removeAttribute("src");
    playBtn.disabled = true;
    previewNote.hidden = false;
    timeTotalEl.textContent = "0:00";
  }
}

playerClose.addEventListener("click", closePlayer);

playerOverlay.addEventListener("click", (event) => {
  if (event.target === playerOverlay) closePlayer();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !playerOverlay.hidden) {
    closePlayer();
  }
});

playBtn.addEventListener("click", () => {
  if (!audioPlayer.src) return;
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
});

audioPlayer.addEventListener("play", () => {
  playBtn.textContent = "⏸";
});

audioPlayer.addEventListener("pause", () => {
  playBtn.textContent = "▶";
});

audioPlayer.addEventListener("ended", () => {
  playBtn.textContent = "▶";
  progressFill.style.width = "0%";
  timeCurrentEl.textContent = "0:00";
  // Continue to the next track, like a real playlist.
  if (playerQueue.length > 1) stepTrack(1, { autoplay: true });
});

audioPlayer.addEventListener("loadedmetadata", () => {
  if (audioPlayer.duration && isFinite(audioPlayer.duration)) {
    timeTotalEl.textContent = formatTime(audioPlayer.duration * 1000);
  }
});

audioPlayer.addEventListener("timeupdate", () => {
  timeCurrentEl.textContent = formatTime(audioPlayer.currentTime * 1000);
  if (audioPlayer.duration) {
    progressFill.style.width = `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`;
  }
});

prevBtn.addEventListener("click", () => stepTrack(-1));
nextBtn.addEventListener("click", () => stepTrack(1));

function stepTrack(direction, { autoplay = false } = {}) {
  if (currentTrackIndex === null || playerQueue.length === 0) return;
  const wasPlaying = autoplay || !audioPlayer.paused;
  const nextIndex = (currentTrackIndex + direction + playerQueue.length) % playerQueue.length;
  currentTrackIndex = nextIndex;
  updatePlayer(playerQueue[nextIndex]);
  if (wasPlaying && playerQueue[nextIndex].previewUrl) audioPlayer.play();
}

volumeSlider.addEventListener("input", () => {
  audioPlayer.volume = Number(volumeSlider.value) / 100;
});
audioPlayer.volume = Number(volumeSlider.value) / 100;

// ==========================================================
// LOADING / EMPTY / ERROR STATES
// ==========================================================

function handleLoading() {
  viewRoot.innerHTML = "";
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "Loading music…";
}

function handleEmpty() {
  viewRoot.innerHTML = "";
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "No tracks found. Try a different search.";
}

function handleError(error, retry) {
  console.error("Music Explorer request failed:", error);
  viewRoot.innerHTML = "";
  statusMessage.classList.add("is-error");
  statusMessage.innerHTML = `
    We couldn't load music right now. Check your connection and try again.
    <br />
    <button class="retry-btn" type="button">Try again</button>
  `;
  statusMessage.querySelector(".retry-btn").addEventListener("click", retry);
}

function clearStatus() {
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "";
}

let flashStatusTimeout = null;
function flashStatus(message) {
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = message;
  clearTimeout(flashStatusTimeout);
  flashStatusTimeout = setTimeout(clearStatus, 3000);
}

// ==========================================================
// SMALL HELPERS
// ==========================================================

function formatTime(ms) {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================================
// INITIAL LOAD
// ==========================================================
loadHomepage();