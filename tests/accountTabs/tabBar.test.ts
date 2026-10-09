/*
 * DOM behaviour of the account tab bar: what gets rendered and which handlers fire.
 *
 * See hitTesting.test.ts for the CSS-level regressions these cannot see.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { mountAccountTabBar, routeLabel } from "../../src/renderer/accountTabs/tabBar.ts";
import type { AccountTabData } from "../../src/shared/accountTabs.ts";

import { win } from "./domSetup.ts";

function tab(over: Partial<AccountTabData> = {}): AccountTabData {
    return {
        id: "t1",
        userId: "111",
        username: "alice",
        discriminator: "0",
        avatar: null,
        accentColor: null,
        token: null,
        route: { guildId: null, channelId: null },
        unread: 0,
        lastUsed: 0,
        ...over
    };
}

beforeEach(() => {
    win.document.body.textContent = "";
    win.document.head.textContent = "";
});

async function mount(over: { showAvatars?: boolean; showRoute?: boolean } = {}) {
    const events = { select: [] as string[], close: [] as string[], add: 0, token: 0 };

    const bar = await mountAccountTabBar(
        {
            onSelect: id => events.select.push(id),
            onClose: id => events.close.push(id),
            onAdd: () => events.add++,
            onAddViaToken: () => events.token++
        },
        { showAvatars: over.showAvatars ?? true, showRoute: over.showRoute ?? true }
    );

    win.document.body.appendChild(bar.element);
    return { bar, events, doc: win.document };
}

describe("rendering", () => {
    test("one element per tab, labelled with the display name", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a", username: "alice" }), tab({ id: "b", username: "bob", discriminator: "1234" })], "a");

        const tabs = doc.querySelectorAll(".tesktop-account-tab");
        expect(tabs.length).toBe(2);
        expect(tabs[0].textContent).toContain("alice");
        expect(tabs[1].textContent).toContain("bob#1234");
    });

    test("marks exactly one tab active, for screen readers too", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "b");

        const active = doc.querySelectorAll(".tesktop-account-tab.active");
        expect(active.length).toBe(1);
        expect(active[0].getAttribute("data-tab-id")).toBe("b");
        expect(active[0].getAttribute("aria-selected")).toBe("true");
    });

    test("is a tablist of tabs", async () => {
        const { bar, doc } = await mount();
        bar.render([tab()], "t1");

        expect(doc.querySelector("#tesktop-account-tabs-strip")!.getAttribute("role")).toBe("tablist");
        expect(doc.querySelectorAll('[role="tab"]').length).toBe(1);
    });

    test("shows the remembered route as a subtitle and tooltip", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ route: { guildId: "5", channelId: "6" } })], "t1");

        expect(doc.querySelector(".tesktop-account-tab-route")!.textContent).toContain("5 / 6");
        expect(doc.querySelector(".tesktop-account-tab")!.getAttribute("title")).toContain("alice");
    });

    test("labels a DM as a DM rather than showing a guild id", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ route: { guildId: null, channelId: "9" } })], "t1");
        expect(doc.querySelector(".tesktop-account-tab-route")!.textContent).toBe("DM 9");
    });

    test("labels a tab with no route as Home", () => expect(routeLabel(tab())).toBe("Home"));

    test("hides the route line when the option is off", async () => {
        const { bar, doc } = await mount({ showRoute: false });
        bar.render([tab()], "t1");

        expect(doc.querySelector(".tesktop-account-tab-route")).toBeNull();
        expect(doc.querySelector(".tesktop-account-tab-name")!.textContent).toBe("alice");
    });
});

describe("unread badges", () => {
    test("appear on background tabs only, since you are already looking at yours", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a", unread: 5 }), tab({ id: "b", unread: 3 })], "a");

        const badges = doc.querySelectorAll(".tesktop-account-tab-badge");
        expect(badges.length).toBe(1);
        expect(badges[0].textContent).toBe("3");
    });

    test("caps large counts", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a", unread: 500 })], "b");
        expect(doc.querySelector(".tesktop-account-tab-badge")!.textContent).toBe("99+");
    });

    test("are omitted at zero", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ unread: 0 })], "b");
        expect(doc.querySelector(".tesktop-account-tab-badge")).toBeNull();
    });
});

describe("avatars", () => {
    test("use the avatar hash when there is one", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ userId: "123", avatar: "abc" })], "123");
        expect(doc.querySelector<HTMLImageElement>("img.tesktop-account-tab-avatar")!.src).toContain("/avatars/123/abc");
    });

    test("fall back to a Discord default", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ userId: "123", avatar: null })], "123");
        expect(doc.querySelector("img.tesktop-account-tab-avatar")!.src).toContain("/embed/avatars/");
    });

    test("fall back to a letter when logged out", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ userId: null, username: null })], "t1");
        expect(doc.querySelector(".tesktop-account-tab-avatar.letter")!.textContent).toBe("?");
    });

    test("are omitted entirely when the option is off", async () => {
        const { bar, doc } = await mount({ showAvatars: false });
        bar.render([tab()], "t1");

        expect(doc.querySelector(".tesktop-account-tab-avatar")).toBeNull();
        expect(doc.querySelector(".tesktop-account-tab-name")!.textContent).toBe("alice");
    });
});

describe("interactions", () => {
    test("clicking a tab selects it", async () => {
        const { bar, doc, events } = await mount();
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "a");

        doc.querySelectorAll<HTMLElement>(".tesktop-account-tab")[1].click();
        expect(events.select).toEqual(["b"]);
    });

    test("clicking close does not also select the tab", async () => {
        const { bar, doc, events } = await mount();
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "a");

        doc
            .querySelectorAll<HTMLElement>(".tesktop-account-tab")[1]
            .querySelector<HTMLElement>(".tesktop-account-tab-close")!
            .click();

        expect(events.close).toEqual(["b"]);
        expect(events.select).toEqual([]);
    });

    test("the plus and key buttons add accounts", async () => {
        const { bar, doc, events } = await mount();
        bar.render([tab()], "t1");

        const [plus, key] = Array.from(doc.querySelectorAll<HTMLElement>(".tesktop-account-tabs-button"));
        plus.click();
        key.click();

        expect(events.add).toBe(1);
        expect(events.token).toBe(1);
    });

    test("clicks do not reach the app underneath", async () => {
        // The strip is injected into Discord's page, so a stray click must not be
        // interpreted by the app.
        const { bar, doc } = await mount();
        let bubbled = 0;
        doc.body.addEventListener("click", () => bubbled++);

        bar.render([tab()], "t1");
        doc.querySelector<HTMLElement>(".tesktop-account-tab")!.click();

        expect(bubbled).toBe(0);
    });
});

describe("the last tab", () => {
    test("has no close button, so you cannot end up with nothing to switch to", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "only" })], "only");
        expect(doc.querySelectorAll(".tesktop-account-tab-close").length).toBe(0);
    });

    test("gets them back once there are two", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "a");
        expect(doc.querySelectorAll(".tesktop-account-tab-close").length).toBe(2);
    });
});

describe("empty state", () => {
    test("explains what to do instead of showing a blank bar", async () => {
        const { bar, doc } = await mount();
        bar.render([], null);

        expect(doc.querySelector(".tesktop-account-tabs-empty")!.textContent).toContain("+");
        // The add button must still be reachable.
        expect(doc.querySelectorAll(".tesktop-account-tabs-button").length).toBe(2);
    });
});

describe("re-rendering", () => {
    test("does not duplicate tabs when called repeatedly", async () => {
        const { bar, doc } = await mount();
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "a");
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "a");
        bar.render([tab({ id: "a" }), tab({ id: "b" })], "b");

        expect(doc.querySelectorAll(".tesktop-account-tab").length).toBe(2);
    });

    test("injecting the stylesheet twice is a no-op", async () => {
        await mount();
        await mount();
        expect(win.document.querySelectorAll("#tesktop-account-tabs-style").length).toBe(1);
    });

    test("destroy removes the strip", async () => {
        const { bar, doc } = await mount();
        bar.render([tab()], "t1");

        bar.destroy();
        expect(doc.querySelector("#tesktop-account-tabs-strip")).toBeNull();
    });
});