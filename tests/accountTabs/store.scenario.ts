/*
 * Scenario runner for the account-tabs store.
 *
 * Runs under `bun test` because that provides mock.module, which is how we stand in
 * for Electron's safeStorage without a real Electron process.
 *
 * The store derives its file path from DATA_DIR at module load and caches parsed
 * state in a module-level variable, so each scenario must run in its own process
 * with its own TESTCORD_USER_DATA_DIR.
 *
 * Env: SCENARIO, TESTCORD_USER_DATA_DIR, RESULT_PATH, optional ACC_TABS_NO_KEYCHAIN.
 * Writes the scenario result as JSON to RESULT_PATH.
 */
import { expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = "/home/x2b/Documents/Testktop/src";

// Defined by the main process bundle at build time.
(globalThis as any).IS_DEV = false;
(globalThis as any).TESKTOP_GIT_HASH = "test";

const dataDir = process.env.TESTCORD_USER_DATA_DIR!;
mkdirSync(dataDir, { recursive: true });

let encryptionAvailable = process.env.ACC_TABS_NO_KEYCHAIN !== "1";
const encryptCalls: string[] = [];
const clearedSessions: string[] = [];

/**
 * Mock constants by absolute path. The store imports it as a relative specifier,
 * which mock.module does not alias-match, and the real module drags in
 * `process.versions.chrome` and the single-instance lock.
 */
mock.module(`${ROOT}/main/constants.ts`, () => ({
    DATA_DIR: dataDir,
    SESSION_DATA_DIR: `${dataDir}/sessionData`,
    DISCORD_HOSTNAMES: ["discord.com", "canary.discord.com", "ptb.discord.com"],
    PORTABLE: false
}));

mock.module("electron", () => ({
    app: {
        getPath: () => dataDir,
        getVersion: () => "0.0.0",
        setPath: () => {},
        getLoginItemSettings: () => ({})
    },
    session: {
        fromPartition: (partition: string) => ({
            clearStorageData: async () => {
                clearedSessions.push(partition);
            },
            clearCache: async () => {}
        })
    },
    safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (s: string) => {
            encryptCalls.push(s);
            return Buffer.from(`valid:${s}`, "utf8");
        },
        // Real safeStorage throws on anything it did not produce, which is the case
        // the store has to survive: a keychain reset, or a hand-edited file.
        decryptString: (b: Buffer) => {
            const text = b.toString("utf8");
            if (!text.startsWith("valid:")) throw new Error("invalid ciphertext");
            return text.replace(/^valid:/, "");
        }
    }
}));

test("scenario", async () => {
    const store = await import(`${ROOT}/main/accountTabs/store.ts`);

    const out = (value: unknown) => writeFileSync(process.env.RESULT_PATH!, JSON.stringify(value));

    switch (process.env.SCENARIO!) {
        case "encrypt-at-rest": {
            const tab = store.createAccountTab({ userId: "1", username: "a", token: "SECRET_TOKEN" });
            out({ inMemoryToken: tab.token, encryptCalls });
            break;
        }

        case "read-back": {
            out({ tabs: store.getAccountTabs().tabs });
            break;
        }

        case "no-keychain": {
            encryptionAvailable = false;
            const available = store.isEncryptionAvailable();
            store.createAccountTab({ userId: "7", username: "c", token: "plain" });
            out({ available });
            break;
        }

        case "undecryptable": {
            out({ tabs: store.getAccountTabs().tabs });
            break;
        }

        case "create-and-activate": {
            const a = store.createAccountTab({ userId: "1", username: "one" });
            const b = store.createAccountTab({ userId: "2", username: "two" });
            store.setActiveAccountTab(b.id);
            store.setActiveAccountTab("does-not-exist");
            const state = store.getAccountTabs();
            out({
                uniqueIds: a.id !== b.id,
                count: state.tabs.length,
                activeId: state.activeId,
                badActiveRejected: state.activeId === null
            });
            break;
        }

        case "first-tab-becomes-active": {
            const only = store.createAccountTab({ userId: "1", username: "one" });
            out({ activeId: store.getAccountTabs().activeId, expected: only.id });
            break;
        }

        case "second-tab-does-not-steal-focus": {
            const first = store.createAccountTab({ userId: "1", username: "one" });
            store.setActiveAccountTab(first.id);
            store.createAccountTab({ userId: "2", username: "two" });
            out({ activeId: store.getAccountTabs().activeId, expected: first.id });
            break;
        }

        case "remove-active": {
            const a = store.createAccountTab({ userId: "1", username: "a" });
            const b = store.createAccountTab({ userId: "2", username: "b" });
            const c = store.createAccountTab({ userId: "3", username: "c" });

            store.setActiveAccountTab(c.id);
            store.removeAccountTab(c.id);

            const state = store.getAccountTabs();
            out({ order: state.tabs.map(t => t.id), expected: [a.id, b.id], activeId: state.activeId, expectedActive: b.id });
            break;
        }

        case "remove-last": {
            const only = store.createAccountTab({ userId: "1", username: "a" });
            store.setActiveAccountTab(only.id);
            store.removeAccountTab(only.id);
            const state = store.getAccountTabs();
            out({ count: state.tabs.length, activeId: state.activeId });
            break;
        }

        case "token-scope": {
            const a = store.createAccountTab({ userId: "1", username: "a", token: "ta" });
            const b = store.createAccountTab({ userId: "2", username: "b", token: "tb" });
            out({
                a: store.getAccountToken(a.id),
                b: store.getAccountToken(b.id),
                missing: store.getAccountToken("nope")
            });
            break;
        }

        case "update": {
            const a = store.createAccountTab({ userId: "1", username: "a", token: "keepme" });
            const updated = store.updateAccountTab(a.id, { route: { guildId: "5", channelId: "6" } });
            out({ updated, unknown: store.updateAccountTab("nope", { username: "x" }) });
            break;
        }

        case "clear": {
            store.createAccountTab({ userId: "1", username: "a", token: "t" });
            store.createAccountTab({ userId: "2", username: "b", token: "t" });
            store.clearAccountTabs();
            const state = store.getAccountTabs();
            out({ count: state.tabs.length, activeId: state.activeId });
            break;
        }

        case "orphan-cleanup": {
            store.createAccountTab({ id: "live", userId: "1", username: "a", token: "t" });
            await store.clearOrphanedSessions(["live"]);
            out({ clearedSessions });
            break;
        }

        case "empty-start": {
            const state = store.getAccountTabs();
            out({ count: state.tabs.length, activeId: state.activeId });
            break;
        }

        case "garbage-file": {
            const state = store.getAccountTabs();
            out({ count: state.tabs.length, activeId: state.activeId });
            break;
        }

        case "partial-file": {
            const state = store.getAccountTabs();
            out({ tabs: state.tabs, activeId: state.activeId });
            break;
        }

        case "ghost-active": {
            out({ activeId: store.getAccountTabs().activeId });
            break;
        }

        case "sparse-file": {
            out({ tab: store.getAccountTabs().tabs[0] });
            break;
        }

        default:
            throw new Error(`unknown scenario: ${process.env.SCENARIO}`);
    }

    expect(true).toBe(true);
});