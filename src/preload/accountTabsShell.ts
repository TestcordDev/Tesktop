/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Preload for the parallel-mode tab bar shell.
 *
 * Deliberately *not* the main preload: that one injects Vencord and the Tesktop
 * renderer bundle, both of which expect to be running inside Discord. The shell is a
 * plain `testktop://` page, so it gets a much smaller surface.
 */

import { contextBridge, ipcRenderer } from "electron/renderer";

import type { AccountTabData, AccountTabsState } from "../shared/accountTabs";
import { IpcEvents } from "../shared/IpcEvents";

const invoke = <T = any>(event: string, ...args: any[]) => ipcRenderer.invoke(event, ...args) as Promise<T>;
const sendSync = <T = any>(event: string, ...args: any[]) => ipcRenderer.sendSync(event, ...args) as T;

const accountTabs = {
    get: () => sendSync<AccountTabsState>(IpcEvents.ACCOUNT_TABS_GET),
    setActive: (id: string | null) => invoke<AccountTabsState>(IpcEvents.ACCOUNT_TABS_SET_ACTIVE, id),
    create: (partial?: Partial<AccountTabData>) => invoke<AccountTabData>(IpcEvents.ACCOUNT_TABS_CREATE, partial),
    remove: (id: string) => invoke<AccountTabsState>(IpcEvents.ACCOUNT_TABS_REMOVE, id),
    update: (id: string, patch: Partial<AccountTabData>) =>
        invoke<AccountTabData | null>(IpcEvents.ACCOUNT_TABS_UPDATE, id, patch),
    clear: () => invoke<AccountTabsState>(IpcEvents.ACCOUNT_TABS_CLEAR),
    isEncryptionAvailable: () => sendSync<boolean>(IpcEvents.ACCOUNT_TABS_ENCRYPTION_AVAILABLE),
    onUpdate(cb: (state: AccountTabsState) => void) {
        ipcRenderer.on(IpcEvents.ACCOUNT_TABS_STATE, (_, state: AccountTabsState) => cb(state));
    }
};

contextBridge.exposeInMainWorld("TesktopAccountTabs", {
    accountTabs,

    settings: {
        get: () => sendSync<any>(IpcEvents.GET_SETTINGS),
        set: (settings: any, path?: string) => invoke<void>(IpcEvents.SET_SETTINGS, settings, path)
    },

    win: {
        minimize: () => invoke<void>(IpcEvents.MINIMIZE),
        close: () => invoke<void>(IpcEvents.CLOSE),
        maximize: () => invoke<void>(IpcEvents.MAXIMIZE)
    }
});

export type TesktopAccountTabsApi = typeof accountTabs;
