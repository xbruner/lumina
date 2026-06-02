#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Lumina Setup Wizard
// Run with: npm run setup
// ─────────────────────────────────────────────────────────────────────────────

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let rl = readline.createInterface({ input, output });

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function print(msg = "") {
  console.log(msg);
}

function header(msg) {
  print(`\n${BOLD}${CYAN}${msg}${RESET}`);
}

function success(msg) {
  print(`${GREEN}✓ ${msg}${RESET}`);
}

function warn(msg) {
  print(`${YELLOW}⚠  ${msg}${RESET}`);
}

function dim(msg) {
  print(`${DIM}${msg}${RESET}`);
}

async function ask(question, fallback = "") {
  const hint = fallback ? ` ${DIM}(${fallback})${RESET}` : "";
  const answer = await rl.question(`  ${question}${hint}: `);
  return answer.trim() || fallback;
}

async function askYesNo(question, defaultYes = false) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`  ${question} ${DIM}(${hint})${RESET}: `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === "y" || normalized === "yes";
}

// ── Lyrics paste with raw mode stdin ─────────────────────────────────────────
// In cooked (default) mode the terminal holds the last pasted line in its own
// line editing buffer until Enter is pressed — our process can never read it.
// Raw mode bypasses that buffer: every character flows directly to stdin,
// including the final pasted line. After 500ms of silence we restore normal
// mode, recreate readline, and return the collected text.
async function readLyricsRaw() {
  rl.close();

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
    } catch {
      // Raw mode not supported (e.g., Windows cmd.exe)
      // Fall back to cooked mode - user may need to press Enter after paste
    }
  }

  return new Promise((resolve) => {
    let collected = "";
    let timer = null;

    const finish = () => {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      // Normalize \r\n and bare \r (raw mode sends \r for Enter) to \n
      const normalized = collected
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trimEnd();
      // Move to a clean line before continuing
      process.stdout.write("\n");
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      resolve(normalized);
    };

    const onData = (chunk) => {
      const str = chunk.toString();
      // Ctrl+C in raw mode sends \x03 instead of SIGINT
      if (str.includes("\x03")) {
        process.stdout.write("\n");
        process.exit(130);
      }
      collected += str;
      if (timer) clearTimeout(timer);
      // 500ms of silence = paste is complete
      timer = setTimeout(finish, 500);
    };

    process.stdin.on("data", onData);
    process.stdin.resume();

    // Safety: move on after 60s with no input
    setTimeout(() => {
      if (collected.length === 0) finish();
    }, 60000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

print("");
print(`${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`);
print(`${BOLD}${CYAN}║       Welcome to Lumina Setup        ║${RESET}`);
print(`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}`);
print("");
dim("This will configure your visualizer. Takes about 60 seconds.");
print("");

// ── Artist name ──────────────────────────────────────────────────────────────
header("Artist");
const artistName = await ask("Your artist name");

if (!artistName) {
  warn("Artist name is required. Please run npm run setup again.");
  rl.close();
  process.exit(1);
}

// ── Album title (optional) ────────────────────────────────────────────────────
header("Album (optional)");
dim("  If you're releasing a full album, enter its title. Otherwise press Enter to skip.");
const albumTitle = await ask("Album title", "");

// ── Visualizer Assignment System ─────────────────────────────────────────────
// Define the fixed visualizer sequence for MP3 tracks
const VISUALIZER_SEQUENCE = [
  "translation",   // Track 1
  "particles",     // Track 2
  "dimensional",   // Track 3
  "mandala",       // Track 4
  "flower",        // Track 5
  "auroraplanet",  // Track 6
  "sloworbit",     // Track 7
  "growth",        // Track 8
  "tesseract",     // Track 9
  "pillar",        // Track 10
  "animal"         // Track 11
];

header("Visualizer Assignment");
print(`  ${DIM}MP3 tracks will automatically get visualizers in this order:${RESET}`);
print(`  ${DIM}1. translation, 2. particles, 3. dimensional, 4. mandala, 5. flower, 6. auroraplanet, 7. sloworbit, 8. growth, 9. tesseract, 10. pillar, 11. animal${RESET}`);
print(`  ${DIM}The sequence repeats for additional MP3 tracks.${RESET}`);
print(`  ${DIM}Video tracks will use their video as the visualizer.${RESET}`);
print("");

// ── Tracks ────────────────────────────────────────────────────────────────────
header("Tracks");
const trackCountStr = await ask("How many tracks?", "1");
const trackCount = Math.max(1, Math.min(50, parseInt(trackCountStr, 10) || 1));

const trackEntries = [];
let mp3TrackCounter = 0; // Track only MP3 tracks for visualizer assignment

for (let i = 1; i <= trackCount; i++) {
  const name = await ask(`Track ${i} name`);
  const trackName = name || `Track ${i}`;

  const isVideo = await askYesNo(`  Is "${trackName}" a music video?`, false);
  let audioFile = null;
  let videoFile = null;
  let lyricsType = null;
  let lyricsContent = null;
  let assignedVisualizer = null;

  if (isVideo) {
    print(`  ${DIM}Paste a YouTube or Vimeo URL, or a direct MP4 link.${RESET}`);
    videoFile = await ask(`  Video URL`, ``);
    print(`  ${GREEN}✓ Video track will use video as visualizer${RESET}`);
  } else {
    audioFile = await ask(`  Audio filename`, `track${i}.mp3`);
    audioFile = audioFile.replace(/\.mp3$/i, "") + ".mp3";
    
    // Assign visualizer based on MP3 track position
    mp3TrackCounter++;
    const visualizerIndex = (mp3TrackCounter - 1) % VISUALIZER_SEQUENCE.length;
    assignedVisualizer = VISUALIZER_SEQUENCE[visualizerIndex];
    print(`  ${GREEN}✓ MP3 track ${mp3TrackCounter} assigned visualizer: ${assignedVisualizer}${RESET}`);

    const hasLyrics = await askYesNo(`  Does "${trackName}" have lyrics?`, false);
    if (hasLyrics) {
      print(`\n  ${BOLD}Paste your lyrics:${RESET}`);
      print(`  ${DIM}(Lumina will detect timed or plain lyrics automatically)${RESET}\n`);

      lyricsContent = await readLyricsRaw();

      if (lyricsContent.trim()) {
        const hasTimestamps = /\[\d{2}:\d{2}\.\d{2}\]/.test(lyricsContent);
        if (hasTimestamps) {
          lyricsType = "timed";
          const lrcFile = `track${i}.lrc`;
          writeFileSync(join(ROOT, "public/lyrics", lrcFile), lyricsContent, "utf-8");
          lyricsContent = `/lyrics/${lrcFile}`;
          success(`Timed lyrics detected — saved as ${lrcFile}`);
        } else {
          lyricsType = "static";
          success("Lyrics saved.");
        }
      }
    }
  }

  trackEntries.push({ 
    name: trackName, 
    isVideo, 
    audioFile, 
    videoFile, 
    lyricsType, 
    lyricsContent,
    assignedVisualizer 
  });
}

// ── File naming instructions ──────────────────────────────────────────────────
print("");
print(`${BOLD}────────────────────────────────────────────────────────${RESET}`);
header("Next: Add your files");
print("");

const audioTracks = trackEntries.filter(t => !t.isVideo);
if (audioTracks.length > 0) {
  print("  Copy and paste your MP3s into the public/tracks/ folder. The folder will be opened for you.");
  print("  Make sure each file is named exactly as shown:");
  print("");
  for (let i = 0; i < trackEntries.length; i++) {
    if (!trackEntries[i].isVideo) {
      print(`    ${CYAN}public/tracks/${trackEntries[i].audioFile}${RESET}  →  ${BOLD}${trackEntries[i].name}${RESET}`);
    }
  }
  print("");
}
print(`${BOLD}────────────────────────────────────────────────────────${RESET}`);

// ── Open tracks folder ────────────────────────────────────────────────────────
if (audioTracks.length > 0) {
  print("");
  const shouldOpenFolder = await askYesNo("Ready to add your MP3 files?", false);

  if (shouldOpenFolder) {
    const tracksPath = join(ROOT, "public/tracks");
    const openCmd = platform() === "win32"
      ? `explorer "${tracksPath.replace(/\//g, "\\")}"`
      : platform() === "darwin"
      ? `open "${tracksPath}"`
      : `xdg-open "${tracksPath}"`;

    try {
      execSync(openCmd);
      success("Opened public/tracks/ folder");
    } catch {
      warn("Could not open folder automatically. Please navigate to public/tracks/ manually.");
    }
  }
}

// ── Store link (optional) ─────────────────────────────────────────────────────
header("Store (optional)");
dim("  Got a merch or store link? Fans will see a store button in the player.");
const storeUrl = await ask("Store URL", "");

// ── Wait for confirmation ─────────────────────────────────────────────────────
print("");
await askYesNo("Done adding your files?", true);

// ── Pre-compute audio frequency data ─────────────────────────────────────────
// Generates a `.frames.bin` next to each MP3 so the visualizer can react to
// the music on iPhone Safari (where Web Audio's live AnalyserNode would
// silence audio when the silent switch is on).
//
// Retries up to 3 times and verifies that every expected .frames.bin file
// was actually produced.  Exits with a hard error if analysis still fails
// after all attempts — a silent failure here breaks the visualizer.
if (audioTracks.length > 0) {
  const expectedBins = audioTracks.map((t) =>
    join(ROOT, "public/tracks", `${t.audioFile}.frames.bin`)
  );

  function allBinsExist() {
    return expectedBins.every((p) => existsSync(p));
  }

  print("");
  header("Analyzing your audio");
  dim("  This produces the data the visualizer reacts to. ~1 second per minute of music.");

  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let analysisOk = false;

  while (attempt < MAX_ATTEMPTS && !analysisOk) {
    attempt++;
    if (attempt > 1) {
      print(`  Retrying analysis (attempt ${attempt} of ${MAX_ATTEMPTS})…`);
    }
    try {
      execSync("node scripts/analyze-tracks.mjs", { cwd: ROOT, stdio: "inherit" });
    } catch {
      // execSync threw — the script itself crashed; loop will retry.
    }
    analysisOk = allBinsExist();
  }

  if (!analysisOk) {
    print("");
    print("\x1b[31m✗ Audio analysis failed after 3 attempts.\x1b[0m");
    print("\x1b[31m  The visualizer will not react to your music.\x1b[0m");
    print("\x1b[31m  Fix the error above, then run:  npm run analyze\x1b[0m");
    rl.close();
    process.exit(1);
  }
}

// ── Build config ──────────────────────────────────────────────────────────────
const configContent = generateConfig({ artistName, albumTitle, trackEntries, storeUrl });

const configPath = join(ROOT, "lumina.config.ts");
writeFileSync(configPath, configContent, "utf-8");

print("");
success("lumina.config.ts saved.");

// ── Deploy ────────────────────────────────────────────────────────────────────
print("");
header("Deploy to Vercel");
dim("  Run this command to save your changes and trigger a Vercel deploy:");
print("");
print(`  ${BOLD}${CYAN}git add . && git commit -m "my tracks" && git push${RESET}`);
print("");

const shouldDeploy = await askYesNo("Run this now?", false);

if (shouldDeploy) {
  print("");
  print("  Deploying...");
  try {
    execSync('git add . && git commit -m "my tracks" && git push', {
      cwd: ROOT,
      stdio: "inherit",
    });
    print("");
    success("Pushed! Vercel will deploy automatically.");
  } catch {
    warn("Git push failed. You may need to run the command manually.");
    print(`  ${CYAN}git add . && git commit -m "my tracks" && git push${RESET}`);
  }
} else {
  print("  When you're ready, run:");
  print(`  ${BOLD}${CYAN}git add . && git commit -m "my tracks" && git push${RESET}`);
}

print("");
success("Setup complete. Enjoy Lumina!");
print("");

rl.close();

// ─────────────────────────────────────────────────────────────────────────────
// Config generator
// ─────────────────────────────────────────────────────────────────────────────

function generateConfig({ artistName, albumTitle, trackEntries, storeUrl }) {
  const hasAlbum = albumTitle && albumTitle.trim().length > 0;
  const hasStoreUrl = storeUrl && storeUrl.trim().length > 0;

  const tracksCode = trackEntries
    .map((entry, i) => {
      const id = `track-${String(i + 1).padStart(2, "0")}`;
      const title = entry.name;
      const srcLine = entry.isVideo ? "" : `      src: "/tracks/${escStr(entry.audioFile)}",\n`;
      const visualBlock = entry.isVideo
        ? `      visual: {\n        type: "video",\n        src: "${escStr(entry.videoFile)}",\n        loop: false,\n      },`
        : `      visual: {\n        type: "reactive",\n        scene: "${escStr(entry.assignedVisualizer)}",\n      },`;
      const lyricsBlock = entry.lyricsType
        ? `\n      lyrics: {\n        type: "${entry.lyricsType}",\n        ${entry.lyricsType === "timed" ? "src" : "text"}: "${escStr(entry.lyricsContent)}",\n      },`
        : "";
      return `    {\n      id: "${id}",\n      title: "${escStr(title)}",\n${srcLine}${visualBlock}${lyricsBlock}\n    }${i < trackEntries.length - 1 ? "," : ""}`;
    })
    .join("\n");

  const albumBlock = hasAlbum
    ? `\n  album: {\n    title: "${escStr(albumTitle)}",\n  },`
    : `\n  album: null,`;

  const storeUrlBlock = hasStoreUrl
    ? `\n  storeUrl: "${escStr(storeUrl)}",`
    : "";

  return `// lumina.config.ts
// Generated by npm run setup — edit freely.

import type { LuminaConfig } from "@/lib/config";

const config: LuminaConfig = {
  artist: {
    name: "${escStr(artistName)}",
  },
${albumBlock}

  theme: {
    accentColor: "#a78bfa",
    backgroundColor: "#080810",
    blurIntensity: "medium",
    fontDisplay: "inter",
  },

  tracks: [
${tracksCode}
  ],${storeUrlBlock}

  features: {
    showPlaylist: true,
    autoplayNext: true,
  },
};

export default config;
`;
}

function escStr(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");
}
