/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type AccountTabData, avatarUrl, displayName, routeToHash } from "shared/accountTabs";

/**
 * The tab bar is deliberately framework-free plain DOM.
 *
 * In swap mode it lives inside Discord's page; in parallel mode it lives in a
 * separate `testktop://` shell window. Neither has a React root we can rely on, and
 * injecting one is exactly the kind of thing that broke the old Tesktop tabs.
 */

export interface TabBarCallbacks {
    onSelect(tabId: string): void;
    onClose(tabId: string): void;
    onAdd(): void;
    onAddViaToken(): void;
    /** Long-press / right-click hook, used by parallel mode to offer "log in here". */
    onContextMenu?(tabId: string, x: number, y: number): void;
}

export interface TabBarOptions {
    showAvatars: boolean;
    /** Show the remembered guild/channel under the name. */
    showRoute?: boolean;
    emptyHint?: string;
}

const STYLE_ID = "tesktop-account-tabs-style";
const STRIP_ID = "tesktop-account-tabs-strip";

const CSS = `
:root { --tesktop-account-tabs-height: 38px; }

#${STRIP_ID} {
    display: flex;
    align-items: stretch;
    gap: 4px;
    padding: 0 8px;
    height: 38px;
    box-sizing: border-box;
    background: var(--tesktop-tabs-bg, #1e1f22);
    border-bottom: 1px solid var(--tesktop-tabs-border, rgba(255,255,255,0.06));
    font-family: var(--font-primary, "gg sans", "Noto Sans", sans-serif);
    font-size: 13px;
    color: var(--text-normal, #dbdee1);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    user-select: none;
    /*
     * Discord's own layout is position:fixed and paints above static content, so a
     * strip left in normal flow loses mouse hit-testing to the app underneath: the
     * buttons look real and silently swallow every click. Pin it to the top of the
     * viewport, above everything, which is also what the shell window expects.
     */
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483647;
    /* The window may be frameless, in which case the body is a drag region and
       anything inside it becomes undraggable-but-unclickable. */
    -webkit-app-region: no-drag;
}
#${STRIP_ID}::-webkit-scrollbar { display: none; }

.tesktop-account-tab {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
    max-width: 220px;
    min-width: 96px;
    padding: 0 8px 0 10px;
    margin: 5px 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted, #b5bac1);
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
    position: relative;
}
.tesktop-account-tab:hover { background: rgba(255,255,255,0.06); color: var(--text-normal, #f2f3f5); }
.tesktop-account-tab.active {
    background: var(--background-tertiary, #2b2d31);
    color: var(--text-normal, #f2f3f5);
}

.tesktop-account-tab-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex: 0 0 auto;
    object-fit: cover;
    background: var(--background-modifier-hover, #4e5058);
}
.tesktop-account-tab-avatar.letter {
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
}

.tesktop-account-tab-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.15;
}
.tesktop-account-tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    font-size: 13px;
}
.tesktop-account-tab-route {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: var(--text-muted, #949ba4);
}

.tesktop-account-tab-badge {
    margin-left: auto;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: #f23f43;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}

.tesktop-account-tab-close {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    opacity: 0;
    font-size: 15px;
    line-height: 1;
    color: var(--text-muted, #b5bac1);
}
.tesktop-account-tab:hover .tesktop-account-tab-close,
.tesktop-account-tab.active .tesktop-account-tab-close { opacity: 0.7; }
.tesktop-account-tab-close:hover { background: rgba(255,255,255,0.12); opacity: 1; }

.tesktop-account-tabs-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    flex: 0 0 auto;
}
.tesktop-account-tabs-button {
    width: 26px;
    height: 26px;
    margin: 5px 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted, #b5bac1);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
}
.tesktop-account-tabs-button:hover { background: rgba(255,255,255,0.1); color: var(--text-normal, #f2f3f5); }

.tesktop-account-tabs-spacer { flex: 1 1 auto; min-width: 8px; -webkit-app-region: drag; }

.tesktop-account-tabs-empty {
    display: flex;
    align-items: center;
    padding: 0 12px;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    white-space: nowrap;
}

/*
 * Push Discord's app clear of the fixed strip above. appMount is the container
 * Discord pins with position:fixed, so body padding alone does not move it — this
 * is the same selector the previous Tesktop tabs used, and the only part of that
 * approach that was known to work.
 */
body.tesktop-account-tabs-on { padding-top: var(--tesktop-account-tabs-height) !important; }
body.tesktop-account-tabs-on [class*="appMount"] { margin-top: var(--tesktop-account-tabs-height) !important; }
`;

/**
 * The renderer bundle executes before DOMContentLoaded, and on Discord's login page
 * neither `<head>` nor `<body>` exists yet. Callers await {@link whenDomReady} first.
 */
function ensureStyle() {
    if (!document.head) return;

    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

export function whenDomReady(): Promise<void> {
    if (document.body && document.head) return Promise.resolve();
    return new Promise<void>(resolve => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}

export function accountTabsStyleText() {
    return CSS;
}

function avatarElement(tab: AccountTabData, showAvatars: boolean): HTMLElement {
    if (!showAvatars) return document.createElement("span");

    const url = avatarUrl(tab);
    if (url) {
        const img = document.createElement("img");
        img.className = "tesktop-account-tab-avatar";
        img.src = url;
        img.alt = "";
        img.draggable = false;
        return img;
    }

    const fallback = document.createElement("span");
    fallback.className = "tesktop-account-tab-avatar letter";
    fallback.style.background = tab.accentColor ?? "#4e5058";
    fallback.textContent = (tab.username?.[0] ?? "?").toUpperCase();
    return fallback;
}

/** Human label for the remembered route, used as the tab tooltip and subtitle. */
export function routeLabel(tab: AccountTabData): string {
    const { guildId, channelId } = tab.route ?? { guildId: null, channelId: null };
    if (channelId && guildId) return `${guildId} / ${channelId}`;
    if (channelId) return `DM ${channelId}`;
    if (guildId) return guildId;
    return "Home";
}

export interface MountedTabBar {
    render(tabs: AccountTabData[], activeId: string | null): void;
    destroy(): void;
    element: HTMLElement;
}

export async function mountAccountTabBar(callbacks: TabBarCallbacks, options: TabBarOptions): Promise<MountedTabBar> {
    await whenDomReady();
    ensureStyle();

    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.setAttribute("role", "tablist");

    // The strip is injected into Discord's page, so it must not swallow clicks that
    // were meant for the app underneath.
    strip.addEventListener("mousedown", e => e.stopPropagation());
    strip.addEventListener("click", e => e.stopPropagation());

    const render = (tabs: AccountTabData[], activeId: string | null) => {
        strip.textContent = "";

        if (!tabs.length) {
            const hint = document.createElement("div");
            hint.className = "tesktop-account-tabs-empty";
            hint.textContent = options.emptyHint ?? "No accounts yet — press + to add one";
            strip.appendChild(hint);
        }

        for (const tab of tabs) {
            const el = document.createElement("div");
            el.className = `tesktop-account-tab${tab.id === activeId ? " active" : ""}`;
            el.setAttribute("role", "tab");
            el.setAttribute("aria-selected", String(tab.id === activeId));
            el.dataset.tabId = tab.id;

            const name = displayName(tab);
            el.title = options.showRoute ? `${name} — ${routeLabel(tab)}` : name;

            el.appendChild(avatarElement(tab, options.showAvatars));

            const text = document.createElement("div");
            text.className = "tesktop-account-tab-text";

            const nameEl = document.createElement("span");
            nameEl.className = "tesktop-account-tab-name";
            nameEl.textContent = name;
            text.appendChild(nameEl);

            if (options.showRoute) {
                const routeEl = document.createElement("span");
                routeEl.className = "tesktop-account-tab-route";
                routeEl.textContent = routeLabel(tab);
                text.appendChild(routeEl);
            }

            el.appendChild(text);

            if (tab.unread > 0 && tab.id !== activeId) {
                const badge = document.createElement("span");
                badge.className = "tesktop-account-tab-badge";
                badge.textContent = tab.unread > 99 ? "99+" : String(tab.unread);
                el.appendChild(badge);
            }

            // Never let the last tab be closed: that would leave nothing to switch to.
            if (tabs.length > 1) {
                const close = document.createElement("span");
                close.className = "tesktop-account-tab-close";
                close.textContent = "×";
                close.setAttribute("aria-label", `Close ${name}`);
                close.addEventListener("click", e => {
                    e.stopPropagation();
                    callbacks.onClose(tab.id);
                });
                el.appendChild(close);
            }

            el.addEventListener("click", () => callbacks.onSelect(tab.id));
            el.addEventListener("contextmenu", e => {
                if (!callbacks.onContextMenu) return;
                e.preventDefault();
                callbacks.onContextMenu(tab.id, e.clientX, e.clientY);
            });

            strip.appendChild(el);
        }

        const actions = document.createElement("div");
        actions.className = "tesktop-account-tabs-actions";

        const addButton = document.createElement("button");
        addButton.className = "tesktop-account-tabs-button";
        addButton.textContent = "+";
        addButton.title = "Add account";
        addButton.setAttribute("aria-label", "Add account");
        addButton.addEventListener("click", e => {
            e.stopPropagation();
            callbacks.onAdd();
        });
        actions.appendChild(addButton);

        const tokenButton = document.createElement("button");
        tokenButton.className = "tesktop-account-tabs-button";
        tokenButton.textContent = "⚿";
        tokenButton.title = "Add account with a user token";
        tokenButton.setAttribute("aria-label", "Add account with a user token");
        tokenButton.addEventListener("click", e => {
            e.stopPropagation();
            callbacks.onAddViaToken();
        });
        actions.appendChild(tokenButton);

        strip.appendChild(actions);
        strip.appendChild(Object.assign(document.createElement("div"), { className: "tesktop-account-tabs-spacer" }));
    };

    return {
        render,
        element: strip,
        destroy() {
            strip.remove();
        }
    };
}

/**
 * Turn the strip's offset rules on. The rules themselves live in the shared
 * stylesheet so there is a single source of truth for the layout.
 *
 * Waits for `<body>`: the renderer bundle runs before DOMContentLoaded, and on the
 * login page there is nothing to attach a class to yet.
 */
export async function offsetAppForTabBar(): Promise<void> {
    if (!document.body) {
        await new Promise<void>(resolve =>
            document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
        );
    }

    if (document.getElementById(STYLE_ID)) return;

    ensureStyle();
    document.body.classList.add("tesktop-account-tabs-on");
}

export { routeToHash };
