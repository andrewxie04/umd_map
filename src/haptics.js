import { haptics } from "bzzz";

function safePlay(playback) {
  try {
    playback?.();
  } catch (_) {
    // Ignore unsupported environments; bzzz already falls back internally.
  }
}

export function playSelectionHaptic() {
  safePlay(() => haptics.selection());
}

export function playToggleHaptic() {
  safePlay(() => haptics.toggle());
}

export function playSuccessHaptic() {
  safePlay(() => haptics.success());
}

export function playErrorHaptic() {
  safePlay(() => haptics.error());
}

export function playMapTapHaptic() {
  playSelectionHaptic();
}

export function playMapFocusHaptic() {
  playSelectionHaptic();
}

export function playRecenterHaptic() {
  playSelectionHaptic();
}

export function playNavigationStartHaptic() {
  playToggleHaptic();
}

export function playNavigationClearHaptic() {
  playToggleHaptic();
}

export function playNavigationSuccessHaptic() {
  playSuccessHaptic();
}

export function playNavigationErrorHaptic() {
  playErrorHaptic();
}
