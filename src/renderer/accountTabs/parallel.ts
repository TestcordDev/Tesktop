/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { accentColorFor, routeFromHash } from "shared/accountTabs";

import { VesktopLogger } from "../logger";
import { getAccountTabsState, readCurrentUser, syncAccountTabs, updateAccountTab } from "./store";

/**
 * Parallel mode: every account is a separate `WebContentsView` in the main process,
 * so this file only has to identify the view it is running in and report upwards.
 * The tab bar itself lives in the shell window.
 *
 * Routing happens through the hash, which Discord owns, so the remembered route is
 * restored by the view navigating to it on load — nothing to inject here.
 */

function unreadCount(): number {
    try {
        const wc = (globalThis as any).Webpack?.findByType?.("ReadStateStore") as any;
        const store = wc?.prototype ?? wc;
        if (!store?.getState) return 0;

        const state = store.getState();
        const mentions = typeof state.getMentionsCount === "function" ? state.getMentionsCount() : 0;
        const badges = typeof state.getBadgeCount === "function" ? state.getBadgeCount() : 0;
        return Number(mentions ?? 0) + Number(badges ?? 0);
    } catch {
        return 0;
    }
}

function report() {
    const user = readCurrentUser();

    VesktopNative.accountTabs.report({
        userId: user?.userId ?? null,
        username: user?.username ?? null,
        discriminator: user?.discriminator ?? null,
        avatar: user?.avatar ?? null,
        unread: unreadCount(),
        route: routeFromHash(location.hash)
    });
}

/**
 * Adopt the identity Discord reports for this view. Without this the tab would stay
 * a nameless placeholder even after a successful login.
 */
async function adoptIdentity() {
    const state = await syncAccountTabs();

    // In parallel mode a view's own partition holds its login, so the token is never
    // handed to the renderer. All we do is make sure the main process knows who this is.
    const placeholder = state.tabs.find(tab => !tab.userId && tab.id === state.activeId);
    const user = readCurrentUser();
    if (placeholder && user) {
        await updateAccountTab(placeholder.id, {
            userId: user.userId,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accentColor: accentColorFor(user.userId)
        });
    }
}

export async function initParallelRenderer() {
    await adoptIdentity();

    report();

    let lastHash = location.hash;

    const tick = () => {
        const changed = location.hash !== lastHash;
        lastHash = location.hash;
        if (changed) report();
    };

    window.addEventListener("hashchange", tick);

    // Unread counts change without any navigation, so poll gently.
    const timer = window.setInterval(() => {
        const user = readCurrentUser();
        if (!user) return;
        report();
    }, 15000);

    window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true });

    const state = getAccountTabsState();
    VesktopLogger.log(`Account tabs (parallel) view ready, ${state.tabs.length} tab(s) known`);
}
