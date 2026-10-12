/* ==========================================================
   api.js — everything that talks to the iTunes API, plus the
   "normalize" functions that turn iTunes' raw field names into
   the shape the rest of the app uses.

   iTunes endpoints (free, no API key):
     /search  — find things by term
     /lookup  — fetch by a known ID (an artist's songs/albums,
                or one album's tracks)
   ========================================================== */

// One shared helper does the fetch, the error check, the JSON parsing,
// and logs the result to the console. Every API function below uses it,
// so the async/await + error-handling pattern lives in exactly one place.
async function fetchJson(url, label) {
  const response = await fetch(url);

  if (!response.ok) {
    // Handles unsuccessful HTTP responses (e.g. 404, 500).
    // Network failures make fetch() itself throw. Both are caught by
    // whichever caller wraps this in try/catch.
    throw new Error(`${label} responded with status ${response.status}`);
  }

  const data = await response.json();
  console.log(`[${label}]`, data);
  return data;
}

export async function searchTracksITunes(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&media=music&entity=song&limit=40`;
  const data = await fetchJson(url, "iTunes song search");
  return data.results;
}

export async function searchArtistsITunes(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&entity=musicArtist&limit=10`;
  const data = await fetchJson(url, "iTunes artist search");
  return data.results;
}

export async function fetchArtistTracks(artistId) {
  const data = await fetchJson(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=50`,
    "iTunes artist songs"
  );
  // The first item of a lookup-by-artist result is the artist record
  // itself; wrapperType tells us which entries are actually tracks.
  return data.results.filter((r) => r.wrapperType === "track");
}

export async function fetchArtistAlbums(artistId) {
  const data = await fetchJson(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=50`,
    "iTunes artist albums"
  );
  return data.results.filter((r) => r.wrapperType === "collection");
}

export async function fetchAlbumTracks(collectionId) {
  const data = await fetchJson(
    `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&limit=50`,
    "iTunes album tracks"
  );
  return data.results.filter((r) => r.wrapperType === "track");
}

// Apple's live "most played" chart gives chart order + catalog IDs; we
// pass those IDs to /lookup in one batched request to get full records.
export async function fetchTopChartTracks() {
  const chartData = await fetchJson(
    "https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/songs.json",
    "Apple most-played chart"
  );
  const chartEntries = chartData?.feed?.results || [];
  if (chartEntries.length === 0) throw new Error("Charts feed returned no entries");

  const ids = chartEntries
    .slice(0, 40)
    .map((entry) => entry.id)
    .filter(Boolean)
    .join(",");

  const lookupData = await fetchJson(
    `https://itunes.apple.com/lookup?id=${ids}&entity=song`,
    "iTunes chart lookup"
  );
  return lookupData.results;
}

// ---------- Normalizers: iTunes' raw fields -> this app's shape ----------

function getHighResArtwork(artworkUrl100) {
  if (!artworkUrl100) return null;
  return artworkUrl100.replace("100x100bb", "600x600bb");
}

export function normalizeTrack(t) {
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

// A track record and an artist-search record both carry the same three
// artist fields, so one function covers both.
export function normalizeArtist(a) {
  return { id: a.artistId, name: a.artistName, genre: a.primaryGenreName || null };
}

export function normalizeAlbumFromTrack(t) {
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

export function normalizeAlbumFromLookup(c) {
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
