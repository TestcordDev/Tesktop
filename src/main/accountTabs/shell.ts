/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "node:path";

import type { BrowserWindow } from "electron";

import { AppEvents } from "../events";

/**
 * In parallel mode the main window's own page is a small `testktop://` shell that
 * draws the tab bar. Real Discord lives in per-account `WebContentsView`s stacked on
 * top of it, so the shell window uses a minimal preload instead of the one that
 * injects Vencord and the Tesktop renderer bundle.
 */

/**
 * `tesktop://` rather than `testktop://` — the IPC sender validator allows the
 * former, and the shell is privileged enough to talk to the account store.
 */
export const ACCOUNT_SHELL_URL = "tesktop://static/views/accountShell.html";

/** Built next to the main preload by scripts/build/build.mts. */
export function accountShellPreloadPath() {
    return join(__dirname, "accountTabsShellPreload.js");
}

export async function loadAccountShellUrl(win: BrowserWindow) {
    await win.loadURL(ACCOUNT_SHELL_URL);

    // The stock `appLoaded` listener closes the splash. In parallel mode Discord is
    // not what finished loading, so the shell appearing is the equivalent milestone.
    AppEvents.emit("appLoaded");
}
