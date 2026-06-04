// hooks/useAudio.ts
// ─────────────────────────────────────────────────────────────────────────────
// Plays audio through Howler in HTML5-mode (Howler internally uses an
// <audio> element).  This is critical on iPhone Safari:
//
//   - Web Audio output is routed to the iOS "Ringer" volume bucket and is
//     therefore SILENCED when the silent switch is on.  This is what users
//     reported as "audio doesn't play on iPhone".
//   - HTML <audio> output is routed to the iOS "Media" volume bucket and
//     ignores the silent switch — exactly like Spotify, Apple Music, and
//     every other music player.
//
// Because we no longer use Web Audio at all, there is no AudioContext to
// unlock and no AnalyserNode to wire up.  Visualizer reactivity comes from
// pre-computed frequency data (see scripts/analyze-tracks.mjs and
// hooks/useAudioData.ts) synchronised to the audio element's playback time
// via the singleton ref in lib/playbackTime.ts.
//
// What this hook still does:
//   - Loads / unloads tracks safely across rapid skips (generation counter +
//     `.off()` before `.unload()` to prevent decode-cancel errors).
//   - Drives a RAF-based progress poll so the seek bar and visualizer time
//     reference stay in sync.
//   - Exposes simple play / pause / seek / volume / mute / onEnd helpers.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import { Howl } from "howler";
import { usePlayerStore } from "@/store/playerStore";
import { playbackTime } from "@/lib/playbackTime";

interface UseAudioReturn {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  mute: (muted: boolean) => void;
  duration: number;
  currentTime: number;
  isLoaded: boolean;
  error: string | null;
  onEnd: (callback: () => void) => void;
}

export function useAudio(src: string): UseAudioReturn {
  const howlRef = useRef<Howl | null>(null);
  // Single slot for the "track ended" callback — replaces rather than stacks.
  const endCallbackRef = useRef<(() => void) | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generation counter: incremented on every src change so stale async
  // callbacks (onload from a previous track, retries, etc.) can detect they
  // are obsolete and bail out without touching the current howlRef.
  const generationRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const { volume, isMuted, setProgress } = usePlayerStore();

  // ─── Progress polling ──────────────────────────────────────────────────────
  // Polls the audio element's playback time on each animation frame while
  // playing, updating both React state (for the seek bar) and the singleton
  // playbackTime ref (read by useAudioData → visualizer).
  const startProgressPoll = useCallback(
    (howl: Howl) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

      const poll = () => {
        // Howler's HTML5 seek path can briefly report !playing() while it
        // internally pauses, updates currentTime, then resumes. Those internal
        // pause/play calls don't always emit public events, so if this RAF loop
        // self-terminates on that transient state, playbackTime freezes and the
        // precomputed visualizer frames stop tracking the real audio position.
        if (howlRef.current !== howl) return;

        if (howl.playing()) {
          const time = howl.seek() as number;
          const dur = howl.duration();

          playbackTime.current = time;
          playbackTime.duration = dur;

          setCurrentTime(time);
          if (dur > 0) setProgress(time / dur);
        }

        rafRef.current = requestAnimationFrame(poll);
      };

      rafRef.current = requestAnimationFrame(poll);
    },
    [setProgress],
  );

  // ─── Track loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!src) return;

    // Invalidate any in-flight callbacks from the previous track.
    const gen = ++generationRef.current;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Clean teardown of the previous Howl.  `.off()` MUST come BEFORE
    // `.unload()` to prevent "Decoding audio data failed" errors when the
    // user skips tracks mid-decode.
    if (howlRef.current) {
      howlRef.current.off();
      howlRef.current.unload();
      howlRef.current = null;
    }

    setError(null);
    setIsLoaded(false);
    setDuration(0);
    setCurrentTime(0);
    playbackTime.current = 0;
    playbackTime.duration = 0;

    // ── Build the new Howl ──────────────────────────────────────────────────
    // html5: true → Howler creates an <audio> element.  This is the iOS
    // silent-switch fix.  Audio plays from the Media bucket regardless of
    // whether the user has flipped the silent switch.
    const howl = new Howl({
      src: [src],
      html5: true,
      format: ["mp3", "wav", "ogg", "aac"],
      volume: isMuted ? 0 : volume,
      // Hint to the browser: keep the buffer warm so play() responds quickly.
      preload: true,

      onload: () => {
        if (generationRef.current !== gen) return;
        setDuration(howl.duration());
        playbackTime.duration = howl.duration();
        setIsLoaded(true);
        setError(null);
      },

      onloaderror: (_id, err) => {
        if (generationRef.current !== gen) return;
        console.error("[Lumina] Audio load error:", err);
        setError(`Failed to load audio: ${err}`);
      },

      onplayerror: (_id, err) => {
        if (generationRef.current !== gen) return;
        // With html5:true there's no AudioContext to resume; the most common
        // cause is iOS blocking a play() that didn't originate in a user
        // gesture.  Howler will retry on the next user-initiated play.
        console.warn("[Lumina] Audio play error:", err);
      },

      onplay: () => {
        if (generationRef.current !== gen) return;
        startProgressPoll(howl);
      },

      onpause: () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      },

      onstop: () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      },

      onend: () => {
        if (generationRef.current !== gen) return;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        endCallbackRef.current?.();
      },
    });

    howlRef.current = howl;

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Invalidate this generation so any pending callbacks are ignored.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional ref
      generationRef.current++;

      if (howlRef.current) {
        howlRef.current.off();
        howlRef.current.unload();
        howlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ─── Volume sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    howlRef.current?.volume(isMuted ? 0 : volume);
  }, [volume, isMuted]);

  // ─── Playback controls ─────────────────────────────────────────────────────
  const play = useCallback(() => {
    // Guard against double-play if some other code path already started it.
    if (howlRef.current && isLoaded && !howlRef.current.playing()) {
      howlRef.current.play();
    }
  }, [isLoaded]);

  const pause = useCallback(() => {
    howlRef.current?.pause();
  }, []);

  const seek = useCallback(
    (time: number) => {
      const howl = howlRef.current;
      if (!howl || !isLoaded) return;

      const wasPlaying = howl.playing();
      howl.seek(time);
      setCurrentTime(time);
      playbackTime.current = time;
      if (duration > 0) setProgress(time / duration);

      // Re-arm the progress poll after seeks while playing. This covers the
      // same Howler HTML5 transient pause path described above and keeps the
      // visualizer frame cursor locked to the real audio position.
      if (wasPlaying) {
        setTimeout(() => {
          if (howlRef.current === howl) startProgressPoll(howl);
        }, 0);
      }
    },
    [isLoaded, duration, setProgress, startProgressPoll],
  );

  const setVolumeLevel = useCallback((vol: number) => {
    howlRef.current?.volume(vol);
  }, []);

  const muteAudio = useCallback((muted: boolean) => {
    howlRef.current?.mute(muted);
  }, []);

  const onEnd = useCallback((callback: () => void) => {
    endCallbackRef.current = callback;
  }, []);

  return {
    play,
    pause,
    seek,
    setVolume: setVolumeLevel,
    mute: muteAudio,
    duration,
    currentTime,
    isLoaded,
    error,
    onEnd,
  };
}
