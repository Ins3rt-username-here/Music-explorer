/* ==========================================================
   utils.js — small, reusable helpers with no knowledge of the
   rest of the app: text/time formatting, the colored-initials
   avatar maths, and the artwork-colour glow.
   ========================================================== */

export function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 195000 -> "3:15"
export function formatTime(ms) {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// 8040000 -> "2 hr 14 min"  (used for an artist's total catalog length)
export function formatTotalDuration(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

// ---- Deterministic "monogram" avatar for artists ----
// iTunes doesn't provide artist photos, so each artist gets a colored
// circle with their initials. The colour is hashed from their name, so
// the same artist always gets the same colour.
export function hashHue(str) {
  let hash = 0;
  for (const char of str) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

export function monogramColor(name) {
  const [r, g, b] = hslToRgb(hashHue(name), 45, 22);
  return `rgb(${r}, ${g}, ${b})`;
}

// ---- Artwork-based hover glow ----
const artworkColorCache = new Map();

export async function applyArtworkGlow(cardEl, artworkUrl) {
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
        // Shrink the image to 12x12 and average its pixels.
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

        const boosted = boostColor(
          Math.round(r / count),
          Math.round(g / count),
          Math.round(b / count)
        );
        const rgb = `${boosted.r}, ${boosted.g}, ${boosted.b}`;
        artworkColorCache.set(imageUrl, rgb);
        resolve(rgb);
      } catch (err) {
        resolve(null); // canvas blocked by CORS -> fall back to the CSS default glow
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
