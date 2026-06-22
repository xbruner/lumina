"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylist } from "@/hooks/usePlaylist";
import { AudioEngine } from "./AudioEngine";
import { VideoEngine } from "./VideoEngine";
import { Controls } from "./Controls";
import { TrackInfo } from "./TrackInfo";
import { LyricsPanel } from "./LyricsPanel";
import { PlaylistRail } from "./PlaylistRail";
import { VisualizerManager } from "../visualizer/VisualizerManager";
import { useLyrics } from "@/hooks/useLyrics";
import config from "@/lumina.config";

const IDLE_TIMEOUT_MS = 3000;

export function PlayerShell() {
  const isPlaylistOpen = usePlayerStore(s => s.isPlaylistOpen);
  const isLyricsVisible = usePlayerStore(s => s.isLyricsVisible);
  const togglePlaylist = usePlayerStore(s => s.togglePlaylist);
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics);
  const { hasLyrics } = useLyrics();
  const { nextTrack, prevTrack } = usePlaylist();

  // ── Mobile "scroll-to-hide" — collapse browser chrome on load ─────────────
  // Companion to the html { height: 110vh; overflow: hidden } CSS.
  // Issuing a tiny scroll triggers Android Chrome / iOS Safari to retract
  // the URL bar. We re-fire on orientation change because rotating brings
  // the chrome back. Desktop is unaffected (no chrome to hide).
  useEffect(() => {
    const hideUI = () => window.scrollTo(0, 1);

    // Run a few times — first paint, after first frame, and after a short
    // delay — because some mobile browsers reject the scroll if it lands
    // before layout has stabilised.
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(hideUI, 0));
    timers.push(setTimeout(hideUI, 100));
    timers.push(setTimeout(hideUI, 500));

    const onOrientationChange = () => {
      // Address bar reappears on rotate; wait for layout settle then hide again.
      setTimeout(hideUI, 300);
      setTimeout(hideUI, 700);
    };
    window.addEventListener("orientationchange", onOrientationChange);

    // Re-hide if the user taps anywhere — gives the chrome no excuse to linger.
    const onFirstTouch = () => setTimeout(hideUI, 100);
    document.addEventListener("touchstart", onFirstTouch, { passive: true, once: true });

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("orientationchange", onOrientationChange);
      document.removeEventListener("touchstart", onFirstTouch);
    };
  }, []);

  // ── Idle / auto-hide UI ───────────────────────────────────────────────────
  // (No AudioContext-unlock listener needed — audio plays through an HTML
  // <audio> element via Howler html5:true, which has no AudioContext.)
  const [isIdle, setIsIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdle = useCallback(() => {
    setIsIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIsIdle(true), IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    // Kick off the initial idle timer without touching state
    idleTimer.current = setTimeout(() => setIsIdle(true), IDLE_TIMEOUT_MS);

    const events = ["mousemove", "mousedown", "touchstart", "keydown"] as const;
    events.forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));

    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UI is visible when not idle, OR when a panel is open
  const uiVisible = !isIdle || isPlaylistOpen;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          const { isPlaying, setIsPlaying } = usePlayerStore.getState();
          setIsPlaying(!isPlaying);
          break;

        case 'ArrowLeft':
          e.preventDefault();
          const { progress, seekTo } = usePlayerStore.getState();
          seekTo(Math.max(0, progress - 0.05)); // Seek back 5%
          break;

        case 'ArrowRight':
          e.preventDefault();
          const { progress: currentProgress, seekTo: seekToRight } = usePlayerStore.getState();
          seekToRight(Math.min(1, currentProgress + 0.05)); // Seek forward 5%
          break;

        case 'ArrowUp':
          e.preventDefault();
          nextTrack();
          break;

        case 'ArrowDown':
          e.preventDefault();
          prevTrack();
          break;

        case 'Escape':
          e.preventDefault();
          if (isPlaylistOpen) togglePlaylist();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaylistOpen, togglePlaylist, nextTrack, prevTrack]);

  return (
    <div
      className="fixed inset-0 bg-background overflow-hidden"
      style={{
        cursor: isIdle ? "none" : "default",
      }}
    >
      {/* Background Layer - Visualizer or Video */}
      <VisualizerManager />

      {/* Audio/Video Engines */}
      <AudioEngine />
      <VideoEngine />

      {/* UI Overlays */}
      <motion.div
        className="relative z-10 w-full h-full pointer-events-none"
        animate={{ opacity: uiVisible ? 1 : 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
      >
        {/* Top Bar - Logo, Artist Info, Controls */}
        <div className="absolute top-0 left-0 right-0 p-6 pointer-events-auto">
          <div className="flex items-center justify-end">
            {/* Top Controls */}
            <div className="flex items-center gap-4">
              {/* Lyrics toggle — only show if current track has lyrics */}
              {hasLyrics && (
                <button
                  onClick={toggleLyrics}
                  title={isLyricsVisible ? "Hide lyrics" : "Show lyrics"}
                  className={`p-2 rounded-full transition-colors ${
                    isLyricsVisible
                      ? "bg-accent text-background"
                      : "bg-accent/20 hover:bg-accent/30"
                  }`}
                >
                  ♪
                </button>
              )}
              <button
                onClick={togglePlaylist}
                className="p-2 rounded-full bg-accent/20 hover:bg-accent/30 transition-colors"
              >
                📋
              </button>
              <button
                onClick={config.storeUrl ? () => window.open(config.storeUrl, '_blank') : undefined}
                className="p-2 rounded-full bg-accent/20 hover:bg-accent/30 transition-colors"
              >
                🛍️
              </button>
            </div>
          </div>
        </div>

        {/* Track Info - Animated in/out */}
        <TrackInfo />

        {/* Bottom Controls */}
        <div className="absolute bottom-0 left-0 right-0 p-6 pointer-events-auto">
          <Controls />
        </div>
      </motion.div>

      {/* Lyrics Panel - outside idle-fade so it stays visible when UI hides */}
      <LyricsPanel />

      {/* Playlist Rail - Outside UI overlays for proper z-index */}
      <PlaylistRail />
    </div>
  );
}
