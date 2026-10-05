/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Shell for the parallel-mode tab bar.
 *
 * This runs in a tiny `testktop://` window stacked above the account views, not
 * inside Discord. It therefore builds the tab bar with plain DOM and talks to the
 * main process through the small `TesktopAccountTabs` preload surface.
 */

import { accountTabsStyleText, mountAccountTabBar, type MountedTabBar } from "./tabBar";

interface ShellApi {
    accountTabs: {
        get(): any;
        setActive(id: string | null): Promise<any>;
        create(partial?: any): Promise<any>;
        remove(id: string): Promise<any>;
        update(id: string, patch: any): Promise<any>;
        clear(): Promise<any>;
        isEncryptionAvailable(): boolean;
        onUpdate(cb: (state: any) => void): void;
    };
    settings: {
        get(): any;
        set(settings: any, path?: string): Promise<void>;
    };
}

const api = (globalThis as any).TesktopAccountTabs as ShellApi;

function styleText(): string {
    return accountTabsStyleText()
        .replace(/var\(--tesktop-tabs-bg,[^)]+\)/g, "#1e1f22")
        .replace(/var\(--tesktop-tabs-border,[^)]+\)/g, "rgba(255,255,255,0.06)");
}

function ensureStyle() {
    const style = document.createElement("style");
    style.id = "tesktop-account-tabs-style";
    style.textContent = styleText();
    document.head.appendChild(style);
}

async function fetchIdentity(token: string) {
    const res = await fetch("https://discord.com/api/v9/users/@me", { headers: { Authorization: token } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;
    return { id: user.id, username: user.username, discriminator: user.discriminator, avatar: user.avatar ?? null };
}

async function promptForToken(): Promise<string | null> {
    const token = prompt(
        "Paste a Discord user token to add an account.\n\n" +
            "It is stored encrypted via your system keychain and never leaves this machine."
    );
    return token?.trim() || null;
}

async function start() {
    ensureStyle();

    const host = document.getElementById("strip-host")!;

    const bar: MountedTabBar = await mountAccountTabBar(
        {
            onSelect: id => {
                void api.accountTabs.setActive(id);
            },
            onClose: id => {
                void api.accountTabs.remove(id);
            },
            onAdd: () => {
                // A placeholder tab opens as a login screen in its own view.
                void api.accountTabs.create({ route: { guildId: null, channelId: null } }).then(tab => {
                    if (tab?.id) void api.accountTabs.setActive(tab.id);
                });
            },
            onAddViaToken: () => {
                void (async () => {
                    const token = await promptForToken();
                    if (!token) return;

                    const identity = await fetchIdentity(token);
                    if (!identity) {
                        alert("That token was not accepted by Discord.");
                        return;
                    }

                    const state = api.accountTabs.get();
                    const existing = state.tabs.find((tab: any) => tab.userId === identity.id);

                    if (existing) {
                        await api.accountTabs.update(existing.id, { token });
                        await api.accountTabs.setActive(existing.id);
                    } else {
                        await api.accountTabs.create({ ...identity, token });
                    }
                })();
            }
        },
        {
            showAvatars: api.settings.get()?.accountTabsShowAvatars !== false,
            showRoute: true,
            emptyHint: "No accounts yet"
        }
    );

    host.appendChild(bar.element);

    const paint = (state: any) => bar.render(state.tabs ?? [], state.activeId ?? null);

    paint(api.accountTabs.get());
    api.accountTabs.onUpdate(paint);

    // Ctrl/Cmd+T, Ctrl/Cmd+W and Ctrl+Tab behave like they do in a browser.
    window.addEventListener("keydown", e => {
        const state = api.accountTabs.get();
        const tabs = state.tabs ?? [];
        if (!tabs.length) return;

        const index = tabs.findIndex((tab: any) => tab.id === state.activeId);
        const step = (delta: number) => {
            const next = tabs[(index + delta + tabs.length) % tabs.length];
            if (next) void api.accountTabs.setActive(next.id);
        };

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
            e.preventDefault();
            void api.accountTabs.create({ route: { guildId: null, channelId: null } }).then(tab => {
                if (tab?.id) void api.accountTabs.setActive(tab.id);
            });
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w" && index !== -1) {
            e.preventDefault();
            void api.accountTabs.remove(tabs[index].id);
        } else if (e.ctrlKey && e.key === "Tab") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
        }
    });
}

if (api) start();
