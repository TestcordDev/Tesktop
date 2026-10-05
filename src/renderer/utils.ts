/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord deletes these from the window so we need to capture them in variables.
// The renderer bundle is injected before Discord's own code runs, so this happens
// early enough — reaching for the bare globals later throws a ReferenceError.
export const { localStorage, sessionStorage } = window;

export const isFirstRun = (() => {
    const key = "VCD_FIRST_RUN";
    if (localStorage.getItem(key) !== null) return false;
    localStorage.setItem(key, "false");
    return true;
})();

function getPlatform() {
    const platform = VesktopNative.app.getPlatformSpoofInfo().originalPlatform.toLowerCase();
    if (platform.startsWith("win")) return "windows";
    if (platform.startsWith("mac")) return "macos";
    if (platform.startsWith("linux")) return "linux";
    return "unknown";
}

export const isWindows = getPlatform() === "windows";
export const isMac = getPlatform() === "macos";
export const isLinux = getPlatform() === "linux";
