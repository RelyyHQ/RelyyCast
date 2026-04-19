import { os } from "@neutralinojs/lib";

const TRAY_CLOSE_HINT_STORAGE_KEY = "relyycast.tray-close-hint-shown-v1";

function hasShownTrayCloseHint() {
  try {
    return window.localStorage.getItem(TRAY_CLOSE_HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markTrayCloseHintShown() {
  try {
    window.localStorage.setItem(TRAY_CLOSE_HINT_STORAGE_KEY, "1");
  } catch {
    // Ignore storage write failures.
  }
}

export async function showTrayCloseHintOnce() {
  if (typeof window === "undefined" || hasShownTrayCloseHint()) {
    return;
  }

  try {
    await os.showNotification(
      "RelyyCast is still running",
      "Use the tray icon and choose Exit to fully quit.",
    );
  } catch (error) {
    console.warn("[runtime] failed to show tray close hint notification:", error);
  } finally {
    markTrayCloseHintShown();
  }
}
