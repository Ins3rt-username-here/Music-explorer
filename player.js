/* ==========================================================
   player.js — the expanded Walkman-style player and everything
   that controls the <audio> element: opening/closing, loading a
   track, play/pause, progress, previous/next, volume.
   ========================================================== */

import { escapeHtml, formatTime } from "./utils.js";

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

// Player state: the list of tracks the player is stepping through
// (whichever row the user clicked from) and where we are in it.
let playerQueue = [];
let currentTrackIndex = null;

export function openPlayer(track, queue, { autoplay = false } = {}) {
  playerQueue = queue;
  currentTrackIndex = queue.indexOf(track);
  updatePlayer(track);
  playerOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  playerClose.focus();
  if (autoplay && track.previewUrl) audioPlayer.play();
}

function closePlayer() {
  playerOverlay.hidden = true;
  document.body.style.overflow = "";
  audioPlayer.pause();
  playBtn.textContent = "▶";
}

// Fills the player with one track's details and loads its audio.
function updatePlayer(track) {
  playerArt.src =
    track.artworkUrl || "https://dummyimage.com/400x400/1e1d22/5f5b66.png&text=No+Artwork";
  playerArt.alt = `Artwork for ${track.trackName}`;
  playerTrackName.textContent = track.trackName;
  playerGenre.textContent = track.genre || "";
  const albumLabel = track.collectionName ? ` · ${track.collectionName}` : "";
  playerArtistAlbum.textContent = `${track.artistName}${albumLabel}`;

  const tags = track.genre ? [track.genre] : [];
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

function stepTrack(direction, { autoplay = false } = {}) {
  if (currentTrackIndex === null || playerQueue.length === 0) return;
  const wasPlaying = autoplay || !audioPlayer.paused;
  currentTrackIndex = (currentTrackIndex + direction + playerQueue.length) % playerQueue.length;
  const nextTrack = playerQueue[currentTrackIndex];
  updatePlayer(nextTrack);
  if (wasPlaying && nextTrack.previewUrl) audioPlayer.play();
}

// ---- Event wiring ----

playerClose.addEventListener("click", closePlayer);

playerOverlay.addEventListener("click", (event) => {
  if (event.target === playerOverlay) closePlayer(); // click on the dark backdrop
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !playerOverlay.hidden) closePlayer();
});

playBtn.addEventListener("click", () => {
  if (!audioPlayer.src) return;
  if (audioPlayer.paused) audioPlayer.play();
  else audioPlayer.pause();
});

prevBtn.addEventListener("click", () => stepTrack(-1));
nextBtn.addEventListener("click", () => stepTrack(1));

// Keep the button icon and progress bar in sync with what the audio
// element is really doing.
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
  if (playerQueue.length > 1) stepTrack(1, { autoplay: true }); // like a real playlist
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

volumeSlider.addEventListener("input", () => {
  audioPlayer.volume = Number(volumeSlider.value) / 100;
});
audioPlayer.volume = Number(volumeSlider.value) / 100;
