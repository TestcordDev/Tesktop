/*
 * Parallel mode semantics, expressed against a plain model of the tab list.
 *
 * Parallel mode's view management lives in src/main/accountTabs/parallel.ts, which
 * needs Electron to import. These tests pin the rules that module implements —
 * which view is attached, whose route gets written, whose unread count it is — so
 * the decisions are checkable without booting the app.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { AccountTabData } from "../../src/shared/accountTabs.ts";

let tabs: AccountTabData[] = [];
let activeId: string | null = null;

function tab(id: string, over: Partial<AccountTabData> = {}): AccountTabData {
    return {
        id,
        userId: id,
        username: id,
        discriminator: "0",
        avatar: null,
        accentColor: null,
        token: `tok-${id}`,
        route: { guildId: null, channelId: null },
        unread: 0,
        lastUsed: 0,
        ...over
    };
}

function setState(next: AccountTabData[], active: string | null) {
    tabs = next;
    activeId = active;
}

beforeEach(() => setState([], null));

describe("which account is on screen", () => {
    /** Mirrors relayout(): attached views are exactly the active one. */
    const attached = () => tabs.filter(t => t.id === activeId).map(t => t.id);

    test("only the active account is attached", () => {
        setState([tab("a"), tab("b"), tab("c")], "b");
        expect(attached()).toEqual(["b"]);
    });

    test("switching moves the attached view", () => {
        setState([tab("a"), tab("b")], "a");
        activeId = "b";
        expect(attached()).toEqual(["b"]);
    });

    test("background accounts stay in the list", () => {
        // Detached, not destroyed: they keep their session and keep receiving events.
        setState([tab("a"), tab("b")], "b");
        expect(tabs).toHaveLength(2);
    });

    test("no active account means nothing is attached", () => {
        setState([tab("a"), tab("b")], null);
        expect(attached()).toEqual([]);
    });
});

describe("route ownership", () => {
    /** Mirrors the did-navigate handler in parallel.ts. */
    function reportRoute(tabId: string, hash: string) {
        const match = /^\/channels\/(?:@me|(\d+))(?:\/(\d+))?\/?$/.exec(hash.replace(/^#/, ""));
        if (!match) return;

        const target = tabs.find(t => t.id === tabId);
        if (!target) return;

        target.route = { guildId: match[1] ?? null, channelId: match[2] ?? null };
        target.lastUsed = Date.now();
    }

    test("a background account's navigation is saved against it, not the active one", () => {
        setState([tab("a"), tab("b")], "a");

        reportRoute("b", "#/channels/55/66");

        expect(tabs.find(t => t.id === "b")!.route).toEqual({ guildId: "55", channelId: "66" });
        // The account you are looking at is untouched.
        expect(tabs.find(t => t.id === "a")!.route).toEqual({ guildId: null, channelId: null });
    });

    test("DM navigation is attributed correctly", () => {
        setState([tab("a"), tab("b")], "a");
        reportRoute("b", "#/channels/@me/77");
        expect(tabs.find(t => t.id === "b")!.route).toEqual({ guildId: null, channelId: "77" });
    });

    test("an unrecognised hash is ignored rather than wiping a saved route", () => {
        setState([tab("a", { route: { guildId: "1", channelId: "2" } })], "a");

        reportRoute("a", "#/settings");
        expect(tabs[0].route).toEqual({ guildId: "1", channelId: "2" });
    });

    test("a report from an unknown view is dropped", () => {
        setState([tab("a")], "a");
        reportRoute("ghost", "#/channels/1/2");
        expect(tabs[0].route).toEqual({ guildId: null, channelId: null });
    });
});

describe("unread reporting", () => {
    /** Mirrors the reporter in parallel.ts, including the clamp. */
    function reportUnread(tabId: string, unread: number) {
        const target = tabs.find(t => t.id === tabId);
        if (!target) return;
        if (Number.isFinite(unread)) target.unread = Math.max(0, unread);
    }

    test("per-account counts do not bleed between views", () => {
        setState([tab("a"), tab("b")], "a");

        reportUnread("b", 7);
        reportUnread("a", 0);

        expect(tabs.find(t => t.id === "b")!.unread).toBe(7);
        expect(tabs.find(t => t.id === "a")!.unread).toBe(0);
    });

    test("a negative count is clamped rather than shown", () => {
        setState([tab("a")], "a");
        reportUnread("a", -1);
        expect(tabs[0].unread).toBe(0);
    });
});

describe("removing a tab", () => {
    /** Mirrors removeParallelTab plus the store's activeId repair. */
    function remove(id: string) {
        const index = tabs.findIndex(t => t.id === id);
        tabs = tabs.filter(t => t.id !== id);

        if (!activeId || !tabs.some(t => t.id === activeId)) {
            activeId = tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null;
        }
    }

    test("removing a background tab keeps the active one", () => {
        setState([tab("a"), tab("b"), tab("c")], "b");
        remove("c");
        expect(activeId).toBe("b");
    });

    test("removing the active tab falls back to a neighbour", () => {
        setState([tab("a"), tab("b"), tab("c")], "b");
        remove("b");
        expect(activeId).toBe("a");
    });

    test("removing the last tab leaves nothing attached", () => {
        setState([tab("a")], "a");
        remove("a");
        expect(activeId).toBeNull();
        expect(tabs).toHaveLength(0);
    });
});