/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { safeStorage, session as electronSession } from "electron";
import {
    ACCOUNT_TABS_FILE_VERSION,
    type AccountRoute,
    type AccountTabData,
    type AccountTabsState,
    EMPTY_ROUTE
} from "shared/accountTabs";

import { DATA_DIR, SESSION_DATA_DIR } from "../constants";

const ACCOUNT_TABS_FILE = join(DATA_DIR, "accountTabs.json");

/**
 * These tokens are full account credentials, so they never hit disk in the clear.
 *
 * `safeStorage` is backed by the OS keychain. On Linux without a running keyring
 * it can be unavailable; rather than silently dropping the user's accounts we
 * still save (unencrypted) but remember that we did, so the UI can warn them.
 */
let encryptionAvailable: boolean | null = null;

export function isEncryptionAvailable(): boolean {
    if (encryptionAvailable === null) {
        try {
            encryptionAvailable = safeStorage.isEncryptionAvailable();
        } catch {
            encryptionAvailable = false;
        }
    }
    return encryptionAvailable;
}

function encodeToken(token: string): string {
    if (!isEncryptionAvailable()) return token;
    try {
        return `enc:${safeStorage.encryptString(token).toString("base64")}`;
    } catch (err) {
        console.error("[AccountTabs] Failed to encrypt token, saving it unprotected instead", err);
        return token;
    }
}

function decodeToken(stored: string): string | null {
    if (!stored) return null;
    if (!stored.startsWith("enc:")) return stored;
    if (!isEncryptionAvailable()) return null;
    try {
        return safeStorage.decryptString(Buffer.from(stored.slice("enc:".length), "base64"));
    } catch (err) {
        console.error("[AccountTabs] Failed to decrypt an account token; that account needs to log in again", err);
        return null;
    }
}

function coerceRoute(value: unknown): AccountRoute {
    if (!value || typeof value !== "object") return { ...EMPTY_ROUTE };
    const { guildId, channelId } = value as Partial<AccountRoute>;
    return {
        guildId: typeof guildId === "string" && guildId ? guildId : null,
        channelId: typeof channelId === "string" && channelId ? channelId : null
    };
}

/**
 * Trust nothing coming off disk. A truncated or hand-edited file should cost the
 * user their tab metadata at worst, never crash the app on startup.
 */
function coerceTab(raw: any): AccountTabData | null {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;

    return {
        id: raw.id,
        userId: typeof raw.userId === "string" && raw.userId ? raw.userId : null,
        username: typeof raw.username === "string" && raw.username ? raw.username : null,
        discriminator: typeof raw.discriminator === "string" && raw.discriminator ? raw.discriminator : null,
        avatar: typeof raw.avatar === "string" && raw.avatar ? raw.avatar : null,
        accentColor: typeof raw.accentColor === "string" && raw.accentColor ? raw.accentColor : null,
        token: typeof raw.token === "string" && raw.token ? decodeToken(raw.token) : null,
        route: coerceRoute(raw.route),
        unread: Number.isFinite(raw.unread) ? Number(raw.unread) : 0,
        lastUsed: Number.isFinite(raw.lastUsed) ? Number(raw.lastUsed) : 0
    };
}

let state: AccountTabsState = { tabs: [], activeId: null };
let loaded = false;

function persist() {
    try {
        mkdirSync(dirname(ACCOUNT_TABS_FILE), { recursive: true });
        writeFileSync(
            ACCOUNT_TABS_FILE,
            JSON.stringify(
                {
                    version: ACCOUNT_TABS_FILE_VERSION,
                    activeId: state.activeId,
                    tabs: state.tabs.map(tab => ({ ...tab, token: tab.token ? encodeToken(tab.token) : null }))
                },
                null,
                4
            )
        );
    } catch (err) {
        console.error("[AccountTabs] Failed to save account tabs", err);
    }
}

export function getAccountTabs(): AccountTabsState {
    if (loaded) return state;
    loaded = true;

    try {
        const raw = JSON.parse(readFileSync(ACCOUNT_TABS_FILE, "utf8"));
        const tabs = Array.isArray(raw?.tabs)
            ? raw.tabs.map(coerceTab).filter((tab: AccountTabData | null): tab is AccountTabData => !!tab)
            : [];

        const activeId =
            typeof raw?.activeId === "string" && tabs.some(tab => tab.id === raw.activeId) ? raw.activeId : null;

        state = { tabs, activeId };
    } catch {
        // No file yet, or unreadable. Either way we start clean.
        state = { tabs: [], activeId: null };
    }

    return state;
}

export function saveAccountTabs(next: AccountTabsState) {
    state = next;
    persist();
}

export function createAccountTab(partial: Partial<AccountTabData> = {}): AccountTabData {
    const { tabs } = getAccountTabs();

    const tab: AccountTabData = {
        id: partial.id ?? randomUUID(),
        userId: partial.userId ?? null,
        username: partial.username ?? null,
        discriminator: partial.discriminator ?? null,
        avatar: partial.avatar ?? null,
        accentColor: partial.accentColor ?? null,
        token: partial.token ?? null,
        route: partial.route ?? { ...EMPTY_ROUTE },
        unread: partial.unread ?? 0,
        lastUsed: partial.lastUsed ?? Date.now()
    };

    const { activeId } = getAccountTabs();

    // With no tabs there is nothing active, so the first one added becomes active.
    // Otherwise the user is left staring at a tab bar with nothing selected.
    const nextActiveId = !activeId || !tabs.some(t => t.id === activeId) ? tab.id : activeId;

    saveAccountTabs({ tabs: [...tabs, tab], activeId: nextActiveId });
    return tab;
}

export function updateAccountTab(id: string, patch: Partial<AccountTabData>): AccountTabData | null {
    const { tabs, activeId } = getAccountTabs();
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1) return null;

    const next = [...tabs];
    next[index] = { ...next[index], ...patch, id };

    saveAccountTabs({ tabs: next, activeId });
    return next[index];
}

export function removeAccountTab(id: string): AccountTabsState {
    const { tabs, activeId } = getAccountTabs();
    const index = tabs.findIndex(tab => tab.id === id);
    const next = tabs.filter(tab => tab.id !== id);

    // Keep the tab to the left of the removed one active, the way browsers do.
    let nextActive = activeId;
    if (!nextActive || !next.some(tab => tab.id === nextActive)) {
        nextActive = next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null;
    }

    const result = { tabs: next, activeId: nextActive };
    saveAccountTabs(result);
    return result;
}

export function setActiveAccountTab(id: string | null): AccountTabsState {
    const { tabs } = getAccountTabs();
    const result = { tabs, activeId: id && tabs.some(tab => tab.id === id) ? id : null };
    saveAccountTabs(result);
    return result;
}

export function getAccountToken(id: string): string | null {
    return getAccountTabs().tabs.find(tab => tab.id === id)?.token ?? null;
}

export function clearAccountTabs() {
    saveAccountTabs({ tabs: [], activeId: null });
}

/**
 * Session partitions for accounts that no longer exist. They outlive their tab
 * unless explicitly cleared, and each one holds a live login.
 */
export async function clearOrphanedSessions(liveTabIds: string[]) {
    const partitionRoot = join(SESSION_DATA_DIR, "Partitions");
    const live = new Set(liveTabIds.map(id => `tesktop-account-${id}`));

    let entries: string[];
    try {
        entries = await readdir(partitionRoot);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.startsWith("tesktop-account-") || live.has(entry)) continue;

        try {
            const ses = electronSession.fromPartition(`persist:${entry}`);
            await ses.clearStorageData();
            await ses.clearCache();
            console.log(`[AccountTabs] Cleared orphaned session partition ${entry}`);
        } catch (err) {
            console.error(`[AccountTabs] Failed to clear orphaned partition ${entry}`, err);
        }
    }
}
