/*
 * Swap mode: switching accounts by writing a token into localStorage and reloading.
 *
 * This is the risky half of account tabs — a bug here logs you out of the wrong
 * account — so the ordering of "remember where I was, swap, persist active, reload"
 * is asserted explicitly.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { AccountTabData } from "../../src/shared/accountTabs.ts";

import { win } from "./domSetup.ts";

/** In-memory stand-in for the main-process store. */
let serverTabs: AccountTabData[] = [];
let serverActive: string | null = null;
const created: Partial<AccountTabData>[] = [];
const updates: Array<{ id: string; patch: Partial<AccountTabData> }> = [];

function persist() {
    return { tabs: serverTabs.map(t => ({ ...t })), activeId: serverActive };
}

const api = {
    get: () => persist(),
    setActive: async (id: string | null) => {
        serverActive = id;
        return persist();
    },
    create: async (partial: Partial<AccountTabData> = {}) => {
        const tab: AccountTabData = {
            id: `tab-${serverTabs.length + 1}`,
            userId: null,
            username: null,
            discriminator: null,
            avatar: null,
            accentColor: null,
            token: null,
            route: { guildId: null, channelId: null },
            unread: 0,
            lastUsed: 0,
            ...partial
        };
        created.push(partial);
        serverTabs = [...serverTabs, tab];

        // Mirrors the store: the first tab added also becomes active.
        if (!serverActive || !serverTabs.some(t => t.id === serverActive)) serverActive = tab.id;

        return { ...tab };
    },
    remove: async (id: string) => {
        const index = serverTabs.findIndex(t => t.id === id);
        serverTabs = serverTabs.filter(t => t.id !== id);
        if (serverActive === id || !serverTabs.some(t => t.id === serverActive)) {
            serverActive = serverTabs[Math.max(0, index - 1)]?.id ?? serverTabs[0]?.id ?? null;
        }
        return persist();
    },
    update: async (id: string, patch: Partial<AccountTabData>) => {
        updates.push({ id, patch });
        serverTabs = serverTabs.map(t => (t.id === id ? { ...t, ...patch } : t));
        return serverTabs.find(t => t.id === id) ?? null;
    },
    getToken: async (id: string) => serverTabs.find(t => t.id === id)?.token ?? null,
    clear: async () => {
        serverTabs = [];
        serverActive = null;
        return persist();
    },
    isEncryptionAvailable: () => true,
    onUpdate: () => {},
    report: () => {}
};

const g = globalThis as any;
g.VesktopNative.accountTabs = api;
g.Vencord = { Api: { Notifications: { show: () => {}, addToast: () => {} } } };
g.prompt = () => null;
g.confirm = () => true;
g.fetch = async () => ({ ok: false, status: 401 });

mock.module("../../src/renderer/logger.ts", () => ({
    VesktopLogger: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} }
}));

// A stable object with getters: mock.module may only evaluate the factory once, so
// capturing a snapshot of `settings` would leave the module on a stale copy.
let settings: Record<string, any>;
mock.module("../../src/renderer/settings.ts", () => ({
    Settings: {
        get store() {
            return settings;
        }
    },
    useSettings: () => settings,
    getValueAndOnChange: () => ({ value: undefined, onChange: () => {} })
}));

let reloads = 0;
Object.defineProperty(g.location, "reload", {
    value: () => {
        reloads++;
    },
    configurable: true
});

let counter = 0;
/** Re-import so the module-level `switching` guard starts clean. */
async function freshSwap() {
    counter++;
    return await import(`../../src/renderer/accountTabs/swap.ts?v=${counter}`);
}

function seed(tabs: Array<Partial<AccountTabData>>, activeId: string | null = null) {
    serverTabs = tabs.map((t, i) => ({
        id: t.id ?? `tab-${i + 1}`,
        userId: t.userId ?? null,
        username: t.username ?? null,
        discriminator: t.discriminator ?? null,
        avatar: t.avatar ?? null,
        accentColor: t.accentColor ?? null,
        token: t.token ?? null,
        route: t.route ?? { guildId: null, channelId: null },
        unread: t.unread ?? 0,
        lastUsed: t.lastUsed ?? 0,
        ...t
    })) as AccountTabData[];

    serverActive = activeId ?? serverTabs[0]?.id ?? null;
    created.length = 0;
    updates.length = 0;
    reloads = 0;
}

function loggedInAs(userId: string, token = `tok${userId}`) {
    win.localStorage.setItem("userId", userId);
    win.localStorage.setItem("token", token);
    win.localStorage.setItem(
        `__dcache${userId}`,
        JSON.stringify({ user: { username: `name${userId}`, discriminator: "1234", avatar: "av" } })
    );
}

beforeEach(() => {
    settings = { accountTabsRememberRoute: true, accountTabsConfirmClose: false, accountTabsShowAvatars: true };
    win.localStorage.clear();
    win.sessionStorage.clear();
    win.document.body.textContent = "";
    win.document.head.textContent = "";
    win.location.hash = "";
    seed([]);
});

describe("first launch", () => {
    test("adopts whoever is already logged in as the first tab", async () => {
        loggedInAs("111", "tok111");
        win.location.hash = "#/channels/222/333";

        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(serverTabs).toHaveLength(1);
        expect(serverTabs[0].userId).toBe("111");
        expect(serverTabs[0].username).toBe("name111");
        expect(serverTabs[0].token).toBe("tok111");
        expect(serverTabs[0].route).toEqual({ guildId: "222", channelId: "333" });
    });

    test("does not invent a tab when Discord is logged out", async () => {
        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(serverTabs).toHaveLength(0);
    });
});

describe("switching accounts", () => {
    const twoAccounts = () =>
        seed(
            [
                { id: "a", userId: "1", username: "a", token: "tokA", route: { guildId: "10", channelId: "11" } },
                { id: "b", userId: "2", username: "b", token: "tokB", route: { guildId: "20", channelId: "21" } }
            ],
            "a"
        );

    test("writes the target token and reloads", async () => {
        twoAccounts();
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        await Bun.sleep(20);

        expect(win.localStorage.getItem("token")).toBe("tokB");
        expect(win.localStorage.getItem("userId")).toBe("2");
        expect(serverActive).toBe("b");
        expect(reloads).toBe(1);
    });

    test("saves where you were before switching away", async () => {
        twoAccounts();
        loggedInAs("1", "tokA");
        win.location.hash = "#/channels/55/66";

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        await Bun.sleep(20);

        expect(updates.find(u => u.id === "a" && u.patch.route)?.patch.route).toEqual({ guildId: "55", channelId: "66" });
    });

    test("stages the target route so it can be restored after the reload", async () => {
        twoAccounts();
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        await Bun.sleep(20);

        expect(win.sessionStorage.getItem("tesktop-account-tabs-pending-route")).toBe("#/channels/20/21");
    });

    test("clears the session when switching to a tab that never logged in", async () => {
        seed(
            [
                { id: "a", userId: "1", username: "a", token: "tokA" },
                { id: "b", userId: null, username: null, token: null }
            ],
            "a"
        );
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        await Bun.sleep(20);

        expect(win.sessionStorage.getItem("tesktop-account-tabs-pending-route")).toBeNull();
        expect(win.localStorage.getItem("token")).toBeNull();
    });

    test("skips staging a route when remembering is turned off", async () => {
        settings.accountTabsRememberRoute = false;
        twoAccounts();
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        await Bun.sleep(20);

        expect(win.sessionStorage.getItem("tesktop-account-tabs-pending-route")).toBeNull();
    });

    test("clicking the active tab does nothing", async () => {
        seed([{ id: "a", userId: "1", username: "a", token: "tokA" }], "a");
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelector<HTMLElement>(".tesktop-account-tab")!.click();
        expect(reloads).toBe(0);
    });

    test("restores the staged route on the next load, then forgets it", async () => {
        seed([{ id: "b", userId: "2", username: "b", token: "tokB" }], "b");
        loggedInAs("2", "tokB");
        win.sessionStorage.setItem("tesktop-account-tabs-pending-route", "#/channels/20/21");

        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(win.location.hash).toBe("#/channels/20/21");
        // Consumed, so it cannot fire again on some later reload.
        expect(win.sessionStorage.getItem("tesktop-account-tabs-pending-route")).toBeNull();
    });
});

describe("identity changes", () => {
    test("a logged-out session clears the active tab's identity", async () => {
        seed([{ id: "a", userId: "1", username: "a", token: "tokA" }], "a");

        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(updates.find(u => u.id === "a" && u.patch.userId === null)).toBeDefined();
    });

    test("a tab that just logged in adopts that identity", async () => {
        seed([{ id: "a", userId: null, username: null, token: null }], "a");
        loggedInAs("777", "tok777");

        const swap = await freshSwap();
        await swap.initSwapMode();

        const adopted = updates.find(u => u.id === "a" && u.patch.userId === "777");
        expect(adopted?.patch.username).toBe("name777");
        expect(adopted?.patch.token).toBe("tok777");
    });

    test("logging into an account that already has a tab reuses it", async () => {
        seed(
            [
                { id: "a", userId: "1", username: "one", token: "tokA" },
                { id: "b", userId: "2", username: "two", token: "tokB" }
            ],
            "a"
        );
        loggedInAs("2", "tokB");

        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(serverTabs).toHaveLength(2);
        expect(serverActive).toBe("b");
    });

    test("an unknown account takes over the active tab rather than duplicating it", async () => {
        seed([{ id: "a", userId: "1", username: "one", token: "tokA" }], "a");
        loggedInAs("555", "tok555");

        const swap = await freshSwap();
        await swap.initSwapMode();

        expect(serverTabs).toHaveLength(1);
        expect(serverTabs[0].userId).toBe("555");
    });
});

describe("route memory", () => {
    test("records the route when the hash changes", async () => {
        seed([{ id: "a", userId: "1", username: "a", token: "tokA" }], "a");
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();
        updates.length = 0;

        win.location.hash = "#/channels/31/32";
        win.dispatchEvent(new win.Event("hashchange"));
        await Bun.sleep(20);

        expect(updates.find(u => u.patch.route)?.patch.route).toEqual({ guildId: "31", channelId: "32" });
    });

    test("records nothing when remembering is turned off", async () => {
        settings.accountTabsRememberRoute = false;
        seed([{ id: "a", userId: "1", username: "a", token: "tokA" }], "a");
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();
        updates.length = 0;

        win.location.hash = "#/channels/41/42";
        win.dispatchEvent(new win.Event("hashchange"));
        await Bun.sleep(20);

        expect(updates.some(u => u.patch.route)).toBe(false);
    });
});

describe("adding accounts", () => {
    test("the plus button works when adding the first tab, which also auto-activates it", async () => {
        // Regression: creating the first tab also makes it active, so selectTab's
        // "already selected" guard bailed out and left an inert tab with no login
        // screen. This is the very first thing a new user does.
        seed([], null);

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelector<HTMLElement>(".tesktop-account-tabs-button")!.click();
        await Bun.sleep(20);

        expect(created).toHaveLength(1);
        expect(serverTabs).toHaveLength(1);
        expect(serverActive).toBe(serverTabs[0].id);
        // It has to actually reload into Discord's login screen.
        expect(reloads).toBe(1);
    });

    test("the plus button works after first run adopted an existing login", async () => {
        seed([], null);
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();
        expect(serverTabs).toHaveLength(1);

        win.document.querySelector<HTMLElement>(".tesktop-account-tabs-button")!.click();
        await Bun.sleep(20);

        expect(serverTabs).toHaveLength(2);
        expect(serverActive).toBe(serverTabs[1].id);
        expect(reloads).toBe(1);
        expect(win.localStorage.getItem("token")).toBeNull();
    });

    test("a valid token with zero tabs switches to the new account", async () => {
        // Regression: the create branch stored the token without switching, leaving
        // it attached to an account nobody was looking at.
        seed([], null);
        g.prompt = () => "good-token";
        g.fetch = async () => ({
            ok: true,
            json: async () => ({ id: "888", username: "pasted", discriminator: "0", avatar: "av" })
        });

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tabs-button")[1].click();
        await Bun.sleep(30);

        expect(serverTabs).toHaveLength(1);
        expect(serverTabs[0].userId).toBe("888");
        expect(win.localStorage.getItem("token")).toBe("good-token");
    });

    test("a rejected token is reported and nothing is added", async () => {
        seed([{ id: "a", userId: "1", username: "a", token: "tokA" }], "a");
        loggedInAs("1", "tokA");
        g.prompt = () => "definitely-not-a-token";
        g.fetch = async () => ({ ok: false, status: 401 });

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document.querySelectorAll<HTMLElement>(".tesktop-account-tabs-button")[1].click();
        await Bun.sleep(30);

        expect(created).toHaveLength(0);
    });
});

describe("closing tabs", () => {
    const twoAccounts = (active: string) =>
        seed(
            [
                { id: "a", userId: "1", username: "a", token: "tokA" },
                { id: "b", userId: "2", username: "b", token: "tokB" }
            ],
            active
        );

    test("removes a background tab without switching", async () => {
        twoAccounts("a");
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document
            .querySelectorAll<HTMLElement>(".tesktop-account-tab")[1]
            .querySelector<HTMLElement>(".tesktop-account-tab-close")!
            .click();
        await Bun.sleep(20);

        expect(serverTabs.map(t => t.id)).toEqual(["a"]);
        expect(serverActive).toBe("a");
        expect(reloads).toBe(0);
    });

    test("closing the active tab hands over to the one on its left, with its token", async () => {
        // Regression: the store moves activeId on its own, so selectTab saw "already
        // selected" and left localStorage holding the closed account's token.
        twoAccounts("b");
        loggedInAs("2", "tokB");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document
            .querySelector<HTMLElement>(".tesktop-account-tab.active")!
            .querySelector<HTMLElement>(".tesktop-account-tab-close")!
            .click();
        await Bun.sleep(20);

        // A real reload re-runs initSwapMode, which is what clears the switch guard.
        const afterReload = await freshSwap();
        win.document.body.textContent = "";
        await afterReload.initSwapMode();
        await Bun.sleep(20);

        expect(serverTabs.map(t => t.id)).toEqual(["a"]);
        expect(serverActive).toBe("a");
        expect(win.localStorage.getItem("token")).toBe("tokA");
    });

    test("asks first when confirmation is on, and honours a refusal", async () => {
        settings.accountTabsConfirmClose = true;
        let asked = 0;
        g.confirm = () => {
            asked++;
            return false;
        };

        twoAccounts("a");
        loggedInAs("1", "tokA");

        const swap = await freshSwap();
        await swap.initSwapMode();

        win.document
            .querySelectorAll<HTMLElement>(".tesktop-account-tab")[1]
            .querySelector<HTMLElement>(".tesktop-account-tab-close")!
            .click();
        await Bun.sleep(20);

        expect(asked).toBe(1);
        expect(serverTabs).toHaveLength(2);
    });
});