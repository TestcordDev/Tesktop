/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { accentColorFor, routeFromHash, routeToHash } from "shared/accountTabs";

import { VesktopLogger } from "../logger";
import { Settings } from "../settings";
// Discord deletes `window.localStorage` and `window.sessionStorage`;
// renderer/utils captured both at startup.
import { localStorage, sessionStorage } from "../utils";
import {
    createAccountTab,
    currentAccountTab,
    getAccountTabsState,
    readCurrentUser,
    refreshAccountTabs,
    removeAccountTab,
    setActiveAccountTab,
    subscribeAccountTabs,
    updateAccountTab
} from "./store";
import { mountAccountTabBar, type MountedTabBar, offsetAppForTabBar } from "./tabBar";

/**
 * Swap mode keeps one Discord instance and changes which account it is logged in as.
 *
 * Switching is: remember where we are, write the target account's token into
 * localStorage, reload, then restore the target's remembered route once Discord is
 * back up. That reload is the cost of this mode — background tabs are not connected,
 * so their badges show remembered state rather than live unread.
 */

const TOKEN_KEY = "token";
const USER_ID_KEY = "userId";
const ROUTE_KEY = "tesktop-account-tabs-pending-route";

let bar: MountedTabBar | null = null;
let switching = false;

function showToast(message: string, type: "success" | "error" | "info" = "info") {
    try {
        const api = (globalThis as any).Vencord?.Api?.Notifications;
        if (!api) return;
        if (type === "error") api.show?.(message);
        else
            api.addToast?.(message, {
                type: type === "success" ? 2 : 1,
                timeout: 4000,
                showCloseButton: true
            });
    } catch {
        // Notifications are a nicety, not a requirement.
    }
}

async function promptForToken(): Promise<string | null> {
    const token = prompt(
        "Paste a Discord user token to add an account.\n\n" +
            "Grab it with Developer Tools → Network → any request → Authorization header.\n" +
            "It is stored encrypted and never leaves this machine."
    );
    return token?.trim() || null;
}

/**
 * Verify a pasted token and pull the identity out of it, so a tab can be labelled
 * before Discord is ever loaded.
 */
async function fetchIdentity(
    token: string
): Promise<{ id: string; username: string; discriminator: string; avatar: string | null } | null> {
    try {
        const res = await fetch("https://discord.com/api/v9/users/@me", {
            headers: { Authorization: token }
        });
        if (!res.ok) return null;
        const user = await res.json();
        if (!user?.id) return null;
        return { id: user.id, username: user.username, discriminator: user.discriminator, avatar: user.avatar ?? null };
    } catch (err) {
        VesktopLogger.error("Failed to verify token", err);
        return null;
    }
}

/** Bring the current page back to where the user left it after a reload. */
function restorePendingRoute() {
    const pending = sessionStorage.getItem(ROUTE_KEY);
    if (!pending) return;

    sessionStorage.removeItem(ROUTE_KEY);
    try {
        location.hash = pending;
    } catch {}
}

/** Where Discord is right now, so we can remember it. */
function captureRoute() {
    return routeFromHash(location.hash);
}

async function adoptCurrentUser() {
    const user = readCurrentUser();
    const state = getAccountTabsState();

    // First run: whatever Discord is already logged into becomes the first tab.
    if (!state.tabs.length) {
        if (!user) return;
        const tab = await createAccountTab({
            userId: user.userId,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accentColor: accentColorFor(user.userId),
            token: localStorage.getItem(TOKEN_KEY),
            route: captureRoute()
        });
        await setActiveAccountTab(tab.id);
        return;
    }

    const active = currentAccountTab();

    // Logged out of everything: the active tab needs to become a login tab again.
    if (!user) {
        if (active) await updateAccountTab(active.id, { userId: null, username: null, token: null });
        return;
    }

    // We are on a placeholder tab that just finished logging in.
    if (active && !active.userId) {
        await updateAccountTab(active.id, {
            userId: user.userId,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accentColor: accentColorFor(user.userId),
            token: localStorage.getItem(TOKEN_KEY)
        });
        return;
    }

    // A tab we know about, but Discord's identity changed (manual account swap).
    if (active?.userId && active.userId !== user.userId) {
        const existing = state.tabs.find(tab => tab.userId === user.userId);
        if (existing) {
            await setActiveAccountTab(existing.id);
        } else {
            await updateAccountTab(active.id, {
                userId: user.userId,
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.avatar,
                accentColor: accentColorFor(user.userId),
                token: localStorage.getItem(TOKEN_KEY),
                route: captureRoute()
            });
        }
    }
}

/**
 * `force` is needed when the target already looks active but Discord is not logged
 * in as it yet. Closing the current tab is the case that matters: the main process
 * moves `activeId` to a neighbour on its own, but our localStorage still holds the
 * token of the account we just closed.
 */
async function selectTab(tabId: string, force = false) {
    const state = getAccountTabsState();
    if (switching) return;
    if (!force && state.activeId === tabId) return;

    const target = state.tabs.find(tab => tab.id === tabId);
    if (!target) return;

    switching = true;

    try {
        // Remember where we are before we throw this session away.
        const from = currentAccountTab();
        if (from) await updateAccountTab(from.id, { route: captureRoute() });

        if (!target.token) {
            // A tab that has never been logged into: just clear and let Discord show login.
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_ID_KEY);
        } else {
            localStorage.setItem(TOKEN_KEY, target.token);
            localStorage.setItem(USER_ID_KEY, target.userId ?? "");
        }

        if (Settings.store.accountTabsRememberRoute && (target.route.channelId || target.route.guildId)) {
            sessionStorage.setItem(ROUTE_KEY, routeToHash(target.route));
        }

        await setActiveAccountTab(tabId);
        location.reload();
    } catch (err) {
        VesktopLogger.error("Failed to switch account", err);
        switching = false;
        showToast("Could not switch accounts: " + ((err as Error).message ?? String(err)), "error");
    }
}

async function closeTab(tabId: string) {
    const state = getAccountTabsState();

    if (Settings.store.accountTabsConfirmClose && state.tabs.length > 1) {
        const tab = state.tabs.find(t => t.id === tabId);
        const name = tab?.username ?? "this account";
        if (!confirm(`Remove ${name} from your account tabs?\n\nYou will stay logged in to it on Discord.`)) return;
    }

    const wasActive = state.activeId === tabId;
    await removeAccountTab(tabId);

    // Closing the tab we are looking at has to actually move us somewhere.
    if (wasActive) {
        const next = getAccountTabsState();
        if (next.activeId) await selectTab(next.activeId, true);
        else location.reload();
    }
}

async function addAccount() {
    // Add a placeholder tab and switch to it, which shows Discord's login screen.
    //
    // `force` matters here: creating the first tab also makes it active, so without
    // it selectTab would see "already selected" and do nothing — leaving an inert
    // tab and no login screen.
    const tab = await createAccountTab({ route: { guildId: null, channelId: null } });
    await selectTab(tab.id, true);
}

async function addAccountViaToken() {
    const token = await promptForToken();
    if (!token) return;

    showToast("Checking token…", "info");
    const identity = await fetchIdentity(token);
    if (!identity) {
        showToast("That token was not accepted by Discord.", "error");
        return;
    }

    const state = getAccountTabsState();
    const existing = state.tabs.find(tab => tab.userId === identity.id);
    if (existing) {
        await updateAccountTab(existing.id, { token });
        await selectTab(existing.id);
        showToast("Token updated.", "success");
        return;
    }

    const tab = await createAccountTab({
        userId: identity.id,
        username: identity.username,
        discriminator: identity.discriminator,
        avatar: identity.avatar,
        accentColor: accentColorFor(identity.id),
        token
    });

    // Switch to it, or the token gets stored for an account nobody is looking at.
    await selectTab(tab.id, true);

    showToast(`Added ${identity.username}.`, "success");
}

/** Persist the route as the user moves around, so closing the app remembers it. */
function watchRoute() {
    let last = location.hash;

    const record = () => {
        if (location.hash === last) return;
        last = location.hash;

        const tab = currentAccountTab();
        if (!tab?.id) return;

        const route = routeFromHash(location.hash);
        if (Settings.store.accountTabsRememberRoute) void updateAccountTab(tab.id, { route, lastUsed: Date.now() });
    };

    window.addEventListener("hashchange", record);

    // Also catch SPA navigation that does not fire hashchange.
    const timer = window.setInterval(record, 4000);
    window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true });
}

export async function initSwapMode() {
    await refreshAccountTabs();
    restorePendingRoute();
    await adoptCurrentUser();

    bar = await mountAccountTabBar(
        {
            onSelect: tabId => void selectTab(tabId),
            onClose: tabId => void closeTab(tabId),
            onAdd: () => void addAccount(),
            onAddViaToken: () => void addAccountViaToken()
        },
        { showAvatars: Settings.store.accountTabsShowAvatars !== false, showRoute: true }
    );

    // Resolves once <body> exists; the renderer bundle runs before DOMContentLoaded.
    await offsetAppForTabBar();
    document.body.prepend(bar.element);

    subscribeAccountTabs(state => bar?.render(state.tabs, state.activeId));

    const state = getAccountTabsState();
    bar.render(state.tabs, state.activeId);

    watchRoute();
    switching = false;

    VesktopLogger.log(`Account tabs (swap) ready with ${state.tabs.length} tab(s)`);
}
