/* ==========================================================
   ui.js — building things on the page: track/artist/album cards,
   horizontally scrolling rows, the genre filter, and the loading /
   empty / error messages.

   Cards that need to start something bigger (opening an artist
   profile, playing an album) take that action as a parameter
   (onSelect), so this file doesn't need to know how those work.
   ========================================================== */

import { openPlayer } from "./player.js";
import {
  escapeHtml,
  applyArtworkGlow,
  monogramColor,
  getInitials,
  hashHue,
  hslToRgb,
} from "./utils.js";

const statusMessage = document.getElementById("status-message");
const viewRoot = document.getElementById("view-root");

// ==========================================================
// STATUS MESSAGES (loading / empty / error)
// ==========================================================

export function handleLoading() {
  viewRoot.innerHTML = "";
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "Loading music…";
}

export function handleEmpty() {
  viewRoot.innerHTML = "";
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "No tracks found. Try a different search.";
}

export function handleError(error, retry) {
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

export function clearStatus() {
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "";
}

// A brief note for small failures that shouldn't replace the whole page.
let flashStatusTimeout = null;
export function flashStatus(message) {
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = message;
  clearTimeout(flashStatusTimeout);
  flashStatusTimeout = setTimeout(clearStatus, 3000);
}

// ==========================================================
// CARDS
// ==========================================================

// Space/Enter should "click" a card for keyboard users.
function makeCardActivatable(card, action) {
  card.addEventListener("click", action);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  });
}

export function createTrackCard(track, queue) {
  const card = document.createElement("article");
  card.className = "track-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open player for ${track.trackName} by ${track.artistName}`);

  const tags = track.genre ? [track.genre] : [];

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
  makeCardActivatable(card, () => openPlayer(track, queue));
  return card;
}

export function createArtistCard(artist, onSelect) {
  const card = document.createElement("article");
  card.className = "track-card artist-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View artist profile for ${artist.name}`);

  card.innerHTML = `
    <div class="track-art-wrap monogram-art" style="background: ${monogramColor(artist.name)}">
      <span class="monogram-text">${escapeHtml(getInitials(artist.name))}</span>
    </div>
    <div class="track-body">
      <h3 class="track-name">${escapeHtml(artist.name)}</h3>
      <p class="track-artist-album">${escapeHtml(artist.genre || "Artist")}</p>
    </div>
  `;

  const [glowR, glowG, glowB] = hslToRgb(hashHue(artist.name), 55, 50);
  card.style.setProperty("--glow", `${glowR}, ${glowG}, ${glowB}`);

  makeCardActivatable(card, () => onSelect(artist));
  return card;
}

export function createAlbumCard(album, onSelect) {
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
  makeCardActivatable(card, () => onSelect(album));
  return card;
}

// ==========================================================
// CAROUSEL ROWS (used by Home, Search, and Artist views)
// ==========================================================

export function buildCarouselSection(title, cardElements) {
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

  // Scroll by about two cards, measured from the real card width so it
  // stays right at every screen size.
  const scrollRow = (direction) => {
    const firstCard = row.querySelector(".track-card");
    const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : 180;
    row.scrollBy({ left: direction * (cardWidth * 2 + 28), behavior: "smooth" });
  };

  leftBtn.addEventListener("click", () => scrollRow(-1));
  rightBtn.addEventListener("click", () => scrollRow(1));

  carousel.append(leftBtn, row, rightBtn);
  return carousel;
}

// ==========================================================
// GENRE-FILTERABLE TRACKS SECTION (search results)
// ==========================================================

let filterAllTracks = [];
let filterActiveGenre = "all";
let filterRowEl = null;
let filterNavEl = null;

export function buildFilterableTracksSection(title, tracks) {
  filterAllTracks = tracks;
  filterActiveGenre = "all";

  const section = document.createElement("section");
  section.className = "content-section";

  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = title;
  section.appendChild(heading);

  filterNavEl = document.createElement("nav");
  filterNavEl.className = "genre-filter";
  filterNavEl.setAttribute("aria-label", "Filter by genre");
  section.appendChild(filterNavEl);

  const carousel = buildCarouselRow(tracks.map((t) => createTrackCard(t, tracks)));
  section.appendChild(carousel);
  filterRowEl = carousel.querySelector(".track-grid");

  populateGenreFilter(tracks);
  return section;
}

// Genres come from the results themselves; none are hard-coded.
function populateGenreFilter(tracks) {
  const genres = Array.from(new Set(tracks.map((t) => t.genre).filter(Boolean))).sort();

  filterNavEl.innerHTML = "";
  filterNavEl.appendChild(createGenreChip("All Genres", "all"));
  genres.forEach((genre) => filterNavEl.appendChild(createGenreChip(genre, genre)));
}

function createGenreChip(label, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "genre-chip";
  chip.textContent = label;
  chip.setAttribute("aria-pressed", String(value === filterActiveGenre));
  chip.addEventListener("click", () => {
    filterActiveGenre = value;
    filterNavEl.querySelectorAll(".genre-chip").forEach((el) => {
      el.setAttribute("aria-pressed", String(el.textContent === label));
    });
    filterTracks();
  });
  return chip;
}

// Filters the tracks already in memory — no new network request.
function filterTracks() {
  const visible =
    filterActiveGenre === "all"
      ? filterAllTracks
      : filterAllTracks.filter((t) => t.genre === filterActiveGenre);

  filterRowEl.innerHTML = "";
  visible.forEach((track) => filterRowEl.appendChild(createTrackCard(track, visible)));
}
