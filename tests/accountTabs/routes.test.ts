/*
 * Route serialization: how we remember where you were in each account.
 *
 * Discord is hash routed, so this is the mapping between a stored
 * `{ guildId, channelId }` and the URL fragment that gets restored.
 */
import { describe, expect, test } from "bun:test";

import {
    accentColorFor,
    avatarUrl,
    defaultAvatarIndex,
    displayName,
    normalizeGuildId,
    routeFromHash,
    routeToHash
} from "../../src/shared/accountTabs.ts";

describe("routeToHash", () => {
    test("guild channel", () => expect(routeToHash({ guildId: "111", channelId: "222" })).toBe("#/channels/111/222"));
    test("dm", () => expect(routeToHash({ guildId: null, channelId: "222" })).toBe("#/channels/@me/222"));
    test("guild only", () => expect(routeToHash({ guildId: "111", channelId: null })).toBe("#/channels/111"));
    test("home", () => expect(routeToHash({ guildId: null, channelId: null })).toBe("#/channels/@me"));
});

describe("routeFromHash", () => {
    test("guild channel", () => expect(routeFromHash("#/channels/111/222")).toEqual({ guildId: "111", channelId: "222" }));
    test("dm", () => expect(routeFromHash("#/channels/@me/222")).toEqual({ guildId: null, channelId: "222" }));
    test("home", () => expect(routeFromHash("#/channels/@me")).toEqual({ guildId: null, channelId: null }));
    test("tolerates a missing hash prefix", () => expect(routeFromHash("/channels/@me/9")).toEqual({ guildId: null, channelId: "9" }));
    test("tolerates a trailing slash", () => expect(routeFromHash("#/channels/111/222/")).toEqual({ guildId: "111", channelId: "222" }));

    test("falls back to home for anything it does not recognise", () => {
        // Settings, the friends page and future routes must not wipe a saved route.
        for (const hash of ["#/nonsense", "#/settings", "#/channels", ""]) {
            expect(routeFromHash(hash)).toEqual({ guildId: null, channelId: null });
        }
    });
});

describe("round trip", () => {
    test("preserves every route shape", () => {
        for (const route of [
            { guildId: "1", channelId: "2" },
            { guildId: null, channelId: "3" },
            { guildId: "4", channelId: null },
            { guildId: null, channelId: null }
        ]) {
            expect(routeFromHash(routeToHash(route))).toEqual(route);
        }
    });
});

describe("normalizeGuildId", () => {
    test("treats @me as no guild", () => {
        expect(normalizeGuildId("@me")).toBeNull();
        expect(normalizeGuildId("7")).toBe("7");
        expect(normalizeGuildId(null)).toBeNull();
        expect(normalizeGuildId(undefined)).toBeNull();
    });
});

describe("displayName", () => {
    test("appends a legacy discriminator", () => expect(displayName({ username: "a", discriminator: "1234" })).toBe("a#1234"));
    test("omits discriminator 0, the modern equivalent", () => expect(displayName({ username: "a", discriminator: "0" })).toBe("a"));
    test("handles a logged out tab", () => expect(displayName({ username: null, discriminator: null })).toBe("Add account"));
});

describe("avatars", () => {
    test("uses the avatar hash when there is one", () => {
        expect(avatarUrl({ userId: "123", avatar: "abc" })).toContain("/avatars/123/abc.webp");
    });

    test("falls back to one of Discord's six defaults", () => {
        expect(avatarUrl({ userId: "123", avatar: null })).toContain("/embed/avatars/");
    });

    test("has no avatar to show when logged out", () => {
        expect(avatarUrl({ userId: null, avatar: null })).toBeNull();
    });

    test("default index stays in range for any id", () => {
        for (const id of ["1", "999999999999999999", "1234567890123456789"]) {
            const index = defaultAvatarIndex(id);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThanOrEqual(5);
        }
    });
});

describe("accentColorFor", () => {
    test("is deterministic, so an account keeps the same tab colour", () => {
        expect(accentColorFor("12345")).toBe(accentColorFor("12345"));
    });

    test("produces valid css", () => {
        expect(accentColorFor("12345")).toMatch(/^hsl\(\d+, 62%, 52%\)$/);
    });
});