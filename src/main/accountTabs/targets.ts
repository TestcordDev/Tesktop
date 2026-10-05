/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { WebContents } from "electron";

import { mainWin } from "../mainWindow";
import { activeParallelWebContents, isParallelModeActive, parallelWebContents } from "./parallel";

/**
 * In parallel mode Discord does not live in `mainWin.webContents` any more, it lives
 * in per-account views. Main-process code that talks to the app (theme and quickCss
 * updates, arRPC, voice keybinds, devtools flags) has to ask here instead of
 * hardcoding `mainWin`.
 */

/** The Discord instance the user is currently looking at. */
export function activeAppWebContents(): WebContents | null {
    if (isParallelModeActive()) return activeParallelWebContents();
    if (mainWin && !mainWin.isDestroyed()) return mainWin.webContents;
    return null;
}

/** Every live Discord instance, for broadcasts. */
export function allAppWebContents(): WebContents[] {
    if (isParallelModeActive()) return parallelWebContents();
    if (mainWin && !mainWin.isDestroyed()) return [mainWin.webContents];
    return [];
}

export function sendToActiveApp(channel: string, ...args: any[]) {
    activeAppWebContents()?.send(channel, ...args);
}

export function sendToAllApps(channel: string, ...args: any[]) {
    for (const contents of allAppWebContents()) {
        if (!contents.isDestroyed()) contents.send(channel, ...args);
    }
}
