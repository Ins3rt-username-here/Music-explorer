/* ==========================================================
   main.js — the entry point. Decides which "view" to show
   (Home, Search results, or an Artist profile), fetches the data
   for it, and hands that data to the builders in ui.js.

   Files:
     api.js     talks to iTunes + normalizes its data
     utils.js   formatting + colour helpers
     player.js  the expanded player and the <audio> element
     ui.js      cards, rows, genre filter, status messages
     main.js    this file
   ========================================================== */

import {
  searchTracksITunes,
  searchArtistsITunes,
  fetchArtistTracks,
  fetchArtistAlbums,
  fetchAlbumTracks,
  fetchTopChartTracks,
  normalizeTrack,
  normalizeArtist,
  normalizeAlbumFromTrack,
  normalizeAlbumFromLookup,
} from "./api.js";
import { openPlayer } from "./player.js";
import {
  handleLoading,
  handleEmpty,
  handleError,
  clearStatus,
  flashStatus,
  createTrackCard,
  createArtistCard,
  createAlbumCard,
  buildCarouselSection,
  buildFilterableTracksSection,
} from "./ui.js";
import { escapeHtml, getInitials, monogramColor, formatTotalDuration } from "./utils.js";

const homeLink = document.getElementById("home-link");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const viewRoot = document.getElementById("view-root");

// ==========================================================
// SEARCH VIEW
// ==========================================================

// The form's submit event: preventDefault() stops the browser from
// reloading the page, then we fetch and render the results ourselves.
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  performSearch(query);
});

async function performSearch(query) {
  handleLoading();
  try {
    // Fetch artists and songs at the same time rather than one after the other.
    const [rawArtists, rawTracks] = await Promise.all([
      searchArtistsITunes(query).catch(() => []),
      searchTracksITunes(query),
    ]);

    const artists = rawArtists.map(normalizeArtist);
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
    const cards = artists.map((artist) => createArtistCard(artist, openArtistProfile));
    viewRoot.appendChild(buildCarouselSection("Artists", cards));
  }

  if (tracks.length > 0) {
    viewRoot.appendChild(buildFilterableTracksSection("Tracks", tracks));
  }
}

// ==========================================================
// HOME VIEW
// ==========================================================
// One fetch of Apple's live chart feeds all four sections.

homeLink.addEventListener("click", () => loadHomepage());

// Keeps the first occurrence of each id, preserving order.
function uniqueBy(items, getId) {
  const seen = new Set();
  return items.filter((item) => {
    const id = getId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function loadHomepage() {
  handleLoading();
  try {
    const rawTracks = await fetchTopChartTracks();
    const tracks = rawTracks.filter((t) => t.trackName && t.artistName).map(normalizeTrack);

    const topSongs = tracks.slice(0, 20);

    // Popular Artists / Albums: the same chart, de-duplicated.
    const popularArtists = uniqueBy(tracks, (t) => t.artistId)
      .map((t) => normalizeArtist({ artistId: t.artistId, artistName: t.artistName, primaryGenreName: t.genre }))
      .slice(0, 16);

    const popularAlbums = uniqueBy(rawTracks.filter((t) => t.trackName), (t) => t.collectionId)
      .map(normalizeAlbumFromTrack)
      .slice(0, 16);

    // New Singles: the same chart, newest release first. The spread
    // copy matters — sort() changes the array it's called on.
    const newSingles = [...tracks]
      .filter((t) => t.releaseDate)
      .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
      .slice(0, 20);

    renderHomeView({ topSongs, popularArtists, popularAlbums, newSingles });
    clearStatus();
  } catch (error) {
    // If the chart feed is unreachable, fall back to a broad search.
    console.warn("Top charts feed unavailable, falling back to search:", error);
    try {
      const rawTracks = await searchTracksITunes("top hits");
      const topSongs = rawTracks.filter((t) => t.trackName && t.artistName).map(normalizeTrack);
      renderHomeView({ topSongs, popularArtists: [], popularAlbums: [], newSingles: [] });
      clearStatus();
    } catch (fallbackError) {
      handleError(fallbackError, () => loadHomepage());
    }
  }
}

// Object destructuring in the parameter list: pulls the four lists out
// of the one object passed in.
function renderHomeView({ topSongs, popularArtists, popularAlbums, newSingles }) {
  viewRoot.innerHTML = "";

  if (topSongs.length > 0) {
    const cards = topSongs.map((track) => createTrackCard(track, topSongs));
    viewRoot.appendChild(buildCarouselSection("Top Songs", cards));
  }

  if (popularArtists.length > 0) {
    const cards = popularArtists.map((artist) => createArtistCard(artist, openArtistProfile));
    viewRoot.appendChild(buildCarouselSection("Popular Artists", cards));
  }

  if (popularAlbums.length > 0) {
    const cards = popularAlbums.map((album) => createAlbumCard(album, playAlbum));
    viewRoot.appendChild(buildCarouselSection("Popular Albums", cards));
  }

  if (newSingles.length > 0) {
    const cards = newSingles.map((track) => createTrackCard(track, newSingles));
    viewRoot.appendChild(buildCarouselSection("New Singles", cards));
  }

  if (viewRoot.children.length === 0) handleEmpty();
}

// ==========================================================
// ARTIST VIEW
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

  // reduce() collapses a whole list into one value. Here: the combined
  // length of every song listed, starting the running total at 0.
  const totalMs = tracks.reduce((total, track) => total + track.durationMs, 0);

  const metaParts = [];
  if (artist.genre) metaParts.push(artist.genre);
  if (tracks.length > 0) {
    metaParts.push(`${tracks.length} song${tracks.length === 1 ? "" : "s"}`);
    if (totalMs > 0) metaParts.push(formatTotalDuration(totalMs));
  }
  if (albums.length > 0) metaParts.push(`${albums.length} album${albums.length === 1 ? "" : "s"}`);

  const header = document.createElement("section");
  header.className = "artist-profile-header";
  header.innerHTML = `
    <div class="artist-profile-art monogram-art" style="background: ${monogramColor(artist.name)}">
      <span class="monogram-text">${escapeHtml(getInitials(artist.name))}</span>
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
    openPlayer(tracks[0], tracks, { autoplay: true });
  });

  viewRoot.appendChild(header);

  if (tracks.length > 0) {
    const cards = tracks.map((track) => createTrackCard(track, tracks));
    viewRoot.appendChild(buildCarouselSection("Songs", cards));
  }

  if (albums.length > 0) {
    const cards = albums.map((album) => createAlbumCard(album, playAlbum));
    viewRoot.appendChild(buildCarouselSection("Albums", cards));
  }
}

// ==========================================================
// ALBUM PLAYBACK
// ==========================================================

async function playAlbum(album) {
  if (album.tracks.length > 0) {
    openPlayer(album.tracks[0], album.tracks);
    return;
  }
  try {
    // Album cards don't carry their track list, so fetch it on first click.
    const rawTracks = await fetchAlbumTracks(album.id);
    const tracks = rawTracks.map(normalizeTrack);
    if (tracks.length === 0) {
      flashStatus("That album doesn't have any playable tracks.");
      return;
    }
    album.tracks = tracks; // remember it so a second click is instant
    openPlayer(tracks[0], tracks);
  } catch (error) {
    console.error("Failed to load album tracks:", error);
    flashStatus("Couldn't load that album right now.");
  }
}

// ==========================================================
// START
// ==========================================================
loadHomepage();
