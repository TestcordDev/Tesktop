/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AccountTabData, AccountTabsState } from "shared/accountTabs";
import { IpcEvents } from "shared/IpcEvents";

import { handle, handleSync } from "../utils/ipcWrappers";
import {
    broadcastAccountState,
    isParallelModeActive,
    registerAccountReporter,
    removeParallelTab,
    setActiveParallelTab,
    syncParallelViews
} from "./parallel";
import {
    clearAccountTabs,
    clearOrphanedSessions,
    createAccountTab,
    getAccountTabs,
    getAccountToken,
    isEncryptionAvailable,
    removeAccountTab,
    setActiveAccountTab,
    updateAccountTab
} from "./store";

export { registerAccountReporter } from "./parallel";

/**
 * In swap mode the renderer drives persistence directly and only reads the token it
 * needs, so there is nothing to broadcast. In parallel mode the main process owns
 * the views and the shell has to hear about every change.
 */
function syncViews() {
    if (isParallelModeActive()) syncParallelViews();
    broadcastAccountState();
}

/**
 * Partitions outlive the tabs that created them, so anything left behind by a
 * removed or crashed tab is cleaned up on startup. Each one holds a live login.
 */
export function cleanUpOrphanedAccountSessions() {
    if (!isParallelModeActive()) return;
    void clearOrphanedSessions(getAccountTabs().tabs.map(tab => tab.id));
}

export function registerAccountTabsIpc() {
    registerAccountReporter();

    handleSync(IpcEvents.ACCOUNT_TABS_GET, () => getAccountTabs());

    handle(IpcEvents.ACCOUNT_TABS_SET_ACTIVE, (_, id: string | null) => {
        if (isParallelModeActive()) setActiveParallelTab(id);
        else setActiveAccountTab(id);
        return getAccountTabs();
    });

    handle(IpcEvents.ACCOUNT_TABS_CREATE, (_, partial?: Partial<AccountTabData>) => {
        const tab = createAccountTab(partial);
        syncViews();
        return tab;
    });

    handle(IpcEvents.ACCOUNT_TABS_REMOVE, (_, id: string) => {
        if (isParallelModeActive()) removeParallelTab(id);
        removeAccountTab(id);
        syncViews();
        return getAccountTabs();
    });

    handle(IpcEvents.ACCOUNT_TABS_UPDATE, (_, id: string, patch: Partial<AccountTabData>) => {
        const tab = updateAccountTab(id, patch);
        syncViews();
        return tab;
    });

    /**
     * Swap mode needs the token to drop into localStorage before reloading. Parallel
     * mode never asks: each partition already holds its own login.
     */
    handle(IpcEvents.ACCOUNT_TABS_GET_TOKEN, (_, id: string) => getAccountToken(id));

    handle(IpcEvents.ACCOUNT_TABS_CLEAR, () => {
        clearAccountTabs();
        syncViews();
        return getAccountTabs();
    });

    handleSync(IpcEvents.ACCOUNT_TABS_ENCRYPTION_AVAILABLE, () => isEncryptionAvailable());
}

export function getAccountTabsState(): AccountTabsState {
    return getAccountTabs();
}
