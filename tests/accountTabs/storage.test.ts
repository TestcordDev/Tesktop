/*
 * Reading Discord's login out of localStorage.
 *
 * Discord deletes `window.localStorage` as anti-tampering, which is why
 * `src/renderer/utils.ts` captures it at startup. Reading the bare global instead
 * throws a ReferenceError on a real page — which cost a launch where the tab bar
 * silently failed to mount.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { win } from "./domSetup.ts";

// Import renderer/utils the way the real bundle does: it grabs storage before
// anything can delete it.
const utils = await import("../../src/renderer/utils.ts");
const store = await import("../../src/renderer/accountTabs/store.ts");

beforeEach(() => {
    win.localStorage.clear();
});

describe("readCurrentUser", () => {
    test("reads the identity Discord cached for the current user", () => {
        win.localStorage.setItem("userId", "123456");
        win.localStorage.setItem("token", "tok");
        win.localStorage.setItem(
            "__dcache123456",
            JSON.stringify({ user: { username: "alice", discriminator: "0", avatar: "hash123" } })
        );

        expect(store.readCurrentUser()).toEqual({
            userId: "123456",
            username: "alice",
            discriminator: "0",
            avatar: "hash123"
        });
    });

    test("accepts a cache entry that is the user object itself", () => {
        win.localStorage.setItem("userId", "777");
        win.localStorage.setItem("token", "tok");
        win.localStorage.setItem("__dcache777", JSON.stringify({ username: "bob", discriminator: "1234", avatar: null }));

        expect(store.readCurrentUser()?.username).toBe("bob");
    });

    test("still identifies the account when the cache entry is corrupt", () => {
        win.localStorage.setItem("userId", "999");
        win.localStorage.setItem("token", "tok");
        win.localStorage.setItem("__dcache999", "{not json");

        const user = store.readCurrentUser();
        expect(user?.userId).toBe("999");
        // Falls back to the id rather than losing the account.
        expect(user?.username).toBe("999");
    });

    test("returns null when logged out", () => {
        expect(store.readCurrentUser()).toBeNull();
    });

    test("returns null when a user id is present but the token is gone", () => {
        win.localStorage.setItem("userId", "123");
        expect(store.readCurrentUser()).toBeNull();
    });

    test("works after the window globals are deleted, as they are on a real page", () => {
        win.localStorage.setItem("userId", "4242");
        win.localStorage.setItem("token", "tok");
        win.localStorage.setItem("__dcache4242", JSON.stringify({ user: { username: "carol", discriminator: "0" } }));

        // Emulate Discord's anti-tampering.
        delete (win as any).localStorage;
        delete (globalThis as any).localStorage;

        expect(store.readCurrentUser()?.username).toBe("carol");

        (globalThis as any).localStorage = utils.localStorage;
    });
});