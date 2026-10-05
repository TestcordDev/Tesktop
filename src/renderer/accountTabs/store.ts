/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AccountRoute, AccountTabData, AccountTabsState } from "shared/accountTabs";

// Discord deletes `window.localStorage` as part of its anti-tampering, so the bare
// global throws on a real page. renderer/utils captures it at startup.
import { localStorage } from "../utils";

const listeners = new Set<(state: AccountTabsState) => void>();

let state: AccountTabsState = { tabs: [], activeId: null };
let synced = false;

function emit() {
    for (const listener of listeners) {
        try {
            listener(state);
        } catch (err) {
            console.error("[AccountTabs] Listener threw", err);
        }
    }
}

export function subscribeAccountTabs(listener: (state: AccountTabsState) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getAccountTabsState(): AccountTabsState {
    return state;
}

/** The tab this window is showing, if any. */
export function currentAccountTab(): AccountTabData | undefined {
    return state.tabs.find(tab => tab.id === state.activeId);
}

export function setAccountTabsState(next: AccountTabsState) {
    state = next;
    emit();
}

export async function refreshAccountTabs(): Promise<AccountTabsState> {
    const next = VesktopNative.accountTabs.get();
    setAccountTabsState(next);
    return next;
}

/** Load once and start listening for main-process pushes. */
export async function syncAccountTabs() {
    if (synced) return state;
    synced = true;

    VesktopNative.accountTabs.onUpdate(next => setAccountTabsState(next));
    return refreshAccountTabs();
}

export async function createAccountTab(partial: Partial<AccountTabData> = {}) {
    const tab = await VesktopNative.accountTabs.create(partial);
    await refreshAccountTabs();
    return tab;
}

export async function removeAccountTab(id: string) {
    await VesktopNative.accountTabs.remove(id);
    await refreshAccountTabs();
}

export async function updateAccountTab(id: string, patch: Partial<AccountTabData>) {
    const tab = await VesktopNative.accountTabs.update(id, patch);
    await refreshAccountTabs();
    return tab;
}

export async function setActiveAccountTab(id: string | null) {
    setAccountTabsState(await VesktopNative.accountTabs.setActive(id));
}

export interface CurrentUser {
    userId: string;
    username: string;
    discriminator: string;
    avatar: string | null;
}

/**
 * Ask Discord who we are.
 *
 * Discord keeps the token in `localStorage.token` and mirrors the current user into
 * a per-user cache key, which is the only place we can read a username and avatar
 * from without waiting for the store to initialise.
 *
 * Returns null when logged out, which is how a fresh "add account" tab is detected.
 */
export function readCurrentUser(): CurrentUser | null {
    try {
        const userId = localStorage.getItem("userId") ?? "";
        if (!userId) return null;

        const token = localStorage.getItem("token") ?? "";
        if (!token) return null;

        let username = userId;
        let discriminator = "0";
        let avatar: string | null = null;

        const raw = localStorage.getItem(`__dcache${userId}`);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                const user = parsed?.user ?? parsed;
                username = user?.username ?? username;
                discriminator = user?.discriminator ?? discriminator;
                avatar = user?.avatar ?? null;
            } catch {
                // A corrupt cache entry should not stop us identifying the account.
            }
        }

        return { userId, username, discriminator, avatar };
    } catch (err) {
        console.error("[AccountTabs] Failed to read the current user", err);
        return null;
    }
}

export { type AccountRoute };
