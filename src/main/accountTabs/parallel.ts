/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "node:path";

import {
    BrowserWindow,
    ipcMain,
    type Session,
    session as electronSession,
    type WebContents,
    WebContentsView
} from "electron";
import { normalizeGuildId, routeToHash } from "shared/accountTabs";
import { IpcEvents } from "shared/IpcEvents";

import { BrowserUserAgent, DISCORD_HOSTNAMES } from "../constants";
import { AppEvents } from "../events";
import { Settings } from "../settings";
import { getAccountTabs, setActiveAccountTab, updateAccountTab } from "./store";

/**
 * Parallel mode: every account gets its own Electron session partition and its own
 * `WebContentsView` inside the one window. Background tabs stay connected, so
 * unread badges and voice keep working while you are on another tab.
 *
 * The trade-off is that each partition gets its own copy of Discord's storage, so
 * localStorage-backed preferences are per-account. Anything on disk (quickCss,
 * themes, settings.json) is still shared.
 */

export const TAB_BAR_HEIGHT = 38;

interface AccountView {
    tabId: string;
    view: WebContentsView;
    ses: Session;
}

const views = new Map<string, AccountView>();

let host: BrowserWindow | null = null;
let activeId: string | null = null;

function partitionFor(tabId: string): string {
    // `persist:` is what makes the login survive restarts. Without it the partition
    // lives in memory only and every launch would ask you to log in again.
    return `persist:tesktop-account-${tabId}`;
}

function discordUrl(hash?: string): string {
    return `https://discord.com/app${hash ?? ""}`;
}

/** How much room is left under the tab bar for account content. */
function contentBounds() {
    const bounds = host!.getContentBounds();
    return {
        x: 0,
        y: TAB_BAR_HEIGHT,
        width: Math.max(0, bounds.width),
        height: Math.max(0, bounds.height - TAB_BAR_HEIGHT)
    };
}

function destroyEntry(entry: AccountView) {
    views.delete(entry.tabId);
    if (host && !host.isDestroyed()) {
        try {
            host.contentView.removeChildView(entry.view);
        } catch {}
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
}

function relayout() {
    if (!host || host.isDestroyed()) return;

    const bounds = contentBounds();
    for (const entry of views.values()) {
        entry.view.setBounds(bounds);

        if (entry.tabId === activeId) {
            // Background tabs stay alive but detached: still logged in, still
            // receiving gateway events, just not painted.
            host.contentView.addChildView(entry.view);
        } else {
            host.contentView.removeChildView(entry.view);
        }
    }
}

function sendToHost(channel: string, ...args: any[]) {
    if (host && !host.isDestroyed()) host.webContents.send(channel, ...args);
}

export function broadcastAccountState() {
    sendToHost(IpcEvents.ACCOUNT_TABS_STATE, getAccountTabs());
}

function tabIdForWebContents(id: number): string | undefined {
    for (const [tabId, entry] of views) {
        if (!entry.view.webContents.isDestroyed() && entry.view.webContents.id === id) return tabId;
    }
    return undefined;
}

function createView(tabId: string): AccountView {
    const partition = partitionFor(tabId);
    const ses = electronSession.fromPartition(partition, { cache: true });

    // Each partition needs the spellchecker language list too, since the shell
    // window is the one whose initSpellCheckLanguages call we skipped.
    if (Settings.store.spellCheckLanguages?.length) {
        const available = ses.availableSpellCheckerLanguages;
        const applicable = Settings.store.spellCheckLanguages.filter(lang => available.includes(lang)).slice(0, 5);
        if (applicable.length) ses.setSpellCheckerLanguages(applicable);
    }

    // Per-session setup (screen share picker, media permissions) listens for this.
    AppEvents.emit("newAccountSession", ses);

    const view = new WebContentsView({
        webPreferences: {
            // Each account needs the full preload: Vencord patches, VesktopNative, the lot.
            preload: join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
            partition
        }
    });

    const entry: AccountView = { tabId, view, ses };
    views.set(tabId, entry);
    setupWebContents(entry);
    return entry;
}

function setupWebContents(entry: AccountView) {
    const { webContents } = entry.view;
    webContents.setUserAgent(BrowserUserAgent);

    webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url);
            // Discord voice / stream popouts stay inside this window's session.
            if (DISCORD_HOSTNAMES.includes(parsed.hostname)) return { action: "allow" };
        } catch {}

        return { action: "deny" };
    });

    webContents.on("did-navigate", (_e, url) => {
        let hash: string;
        try {
            const parsed = new URL(url);
            if (!DISCORD_HOSTNAMES.includes(parsed.hostname)) return;
            hash = parsed.hash;
        } catch {
            return;
        }

        const match = /^\/channels\/(?:@me|(\d+))(?:\/(\d+))?\/?$/.exec(hash.replace(/^#/, ""));
        if (!match) return;

        updateAccountTab(entry.tabId, {
            route: { guildId: normalizeGuildId(match[1] ?? null), channelId: match[2] ?? null },
            lastUsed: Date.now()
        });
    });
}

/**
 * Make sure a view exists for every stored tab, and that exactly the active one is
 * on screen. Called on startup and whenever the tab list changes.
 */
export function syncParallelViews() {
    if (!host || host.isDestroyed()) return;

    const state = getAccountTabs();
    activeId = state.activeId;

    for (const tabId of [...views.keys()]) {
        if (state.tabs.some(tab => tab.id === tabId)) continue;
        destroyEntry(views.get(tabId)!);
    }

    for (const tab of state.tabs) {
        if (views.has(tab.id)) continue;

        const entry = createView(tab.id);
        const hash = routeToHash(tab.route);
        // An account with no remembered route just opens on the home view.
        const target = tab.route.channelId || tab.route.guildId ? discordUrl(hash) : discordUrl();

        entry.view.webContents.loadURL(target).catch(err => {
            console.error(`[AccountTabs] Failed to load Discord for tab ${tab.id}`, err);
        });
    }

    relayout();
}

export function initParallelMode(win: BrowserWindow) {
    host = win;
    activeId = getAccountTabs().activeId;

    win.on("resize", relayout);
    win.on("maximize", relayout);
    win.on("unmaximize", relayout);
    win.on("enter-full-screen", relayout);
    win.on("leave-full-screen", relayout);
    win.on("closed", destroyParallelMode);
}

export function destroyParallelMode() {
    for (const entry of [...views.values()]) destroyEntry(entry);
    host = null;
    activeId = null;
}

export function isParallelModeActive() {
    return host !== null;
}

/** Every account's webContents, so main-process senders can reach all of them. */
export function parallelWebContents(): WebContents[] {
    return [...views.values()].map(entry => entry.view.webContents).filter(wc => !wc.isDestroyed());
}

export function activeParallelWebContents() {
    if (!activeId) return null;
    const entry = views.get(activeId);
    return entry && !entry.view.webContents.isDestroyed() ? entry.view.webContents : null;
}

export function setActiveParallelTab(tabId: string | null) {
    if (!host || host.isDestroyed()) return;

    setActiveAccountTab(tabId);
    activeId = getAccountTabs().activeId;
    relayout();
    broadcastAccountState();
}

export function removeParallelTab(tabId: string) {
    const entry = views.get(tabId);
    if (entry) {
        const { ses } = entry;
        destroyEntry(entry);
        // Closing the tab has to revoke the login, otherwise the partition sits on
        // disk holding a live token with nothing left pointing at it.
        void ses
            .clearStorageData()
            .then(() => ses.clearCache())
            .catch(err => console.error(`[AccountTabs] Failed to clear session for tab ${tabId}`, err));
    }
    syncParallelViews();
}

/**
 * Each account's renderer reports who it is, where it is and how much is unread, so
 * the shell can label the tab and we can restore the route next launch.
 */
export function registerAccountReporter() {
    ipcMain.on(IpcEvents.ACCOUNT_TAB_REPORT, (event, payload: any) => {
        if (!payload || typeof payload !== "object") return;

        const tabId = tabIdForWebContents(event.sender.id);
        if (!tabId) return;

        const patch: Parameters<typeof updateAccountTab>[1] = {};

        if (typeof payload.userId === "string") patch.userId = payload.userId;
        if (typeof payload.username === "string") patch.username = payload.username;
        if (typeof payload.discriminator === "string") patch.discriminator = payload.discriminator;
        if (typeof payload.avatar === "string") patch.avatar = payload.avatar;
        if (payload.avatar === null) patch.avatar = null;
        // Clamp: a negative count would render as a nonsense badge.
        if (Number.isFinite(payload.unread)) patch.unread = Math.max(0, Number(payload.unread));
        if (payload.route && typeof payload.route === "object") patch.route = payload.route;

        if (Object.keys(patch).length === 0) return;

        updateAccountTab(tabId, patch);
        broadcastAccountState();
    });
}
