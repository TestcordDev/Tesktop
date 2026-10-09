/*
 * Persistence for account tabs.
 *
 * Each scenario runs in its own `bun test` process with a private
 * TESTCORD_USER_DATA_DIR. The store derives its file path from DATA_DIR at module
 * load and caches parsed state in a module-level variable, so process isolation is
 * the only honest way to test "what happens on the next launch".
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCENARIO = new URL("./store.scenario.ts", import.meta.url).pathname;
const STATE_FILE = "accountTabs.json";

async function run(scenario: string, opts: { seed?: (dir: string) => void; seedFrom?: string; noKeychain?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "acc-tabs-"));

    if (opts.seed) opts.seed(dir);
    if (opts.seedFrom) copyFileSync(join(opts.seedFrom, STATE_FILE), join(dir, STATE_FILE));

    const resultPath = join(dir, "result.json");

    const proc = Bun.spawn(["bun", "test", SCENARIO], {
        cwd: "/home/x2b/Documents/Testktop",
        env: {
            ...process.env,
            SCENARIO: scenario,
            TESTCORD_USER_DATA_DIR: dir,
            RESULT_PATH: resultPath,
            ...(opts.noKeychain ? { ACC_TABS_NO_KEYCHAIN: "1" } : {})
        },
        stdout: "pipe",
        stderr: "pipe"
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
    ]);

    if (exitCode !== 0) throw new Error(`scenario ${scenario} failed (${exitCode}):\n${stdout}\n${stderr}`);

    return { result: JSON.parse(readFileSync(resultPath, "utf8")), dir };
}

describe("token storage", () => {
    test("never writes a token to disk in the clear", async () => {
        const { result, dir } = await run("encrypt-at-rest");

        // Usable in memory...
        expect(result.inMemoryToken).toBe("SECRET_TOKEN");
        // ...but encrypted on disk.
        expect(result.encryptCalls).toContain("SECRET_TOKEN");

        const raw = readFileSync(join(dir, STATE_FILE), "utf8");
        expect(raw).not.toContain("SECRET_TOKEN");
        expect(raw).toContain("enc:");
    });

    test("restores accounts, tokens and routes on the next launch", async () => {
        const first = await run("encrypt-at-rest");
        const second = await run("read-back", { seedFrom: first.dir });

        expect(second.result.tabs).toHaveLength(1);
        expect(second.result.tabs[0].token).toBe("SECRET_TOKEN");
        expect(second.result.tabs[0].username).toBe("a");
    });

    test("keeps the account when the OS keychain is unavailable", async () => {
        const { result, dir } = await run("no-keychain", { noKeychain: true });

        expect(result.available).toBe(false);
        // Losing the account entirely would be worse than an unencrypted token, and
        // the settings UI warns about exactly this case.
        expect(readFileSync(join(dir, STATE_FILE), "utf8")).toContain("plain");
    });

    test("nulls a token it cannot decrypt so the account can log in again", async () => {
        const { result } = await run("undecryptable", {
            seed: d =>
                writeFileSync(
                    join(d, STATE_FILE),
                    JSON.stringify({
                        version: 1,
                        activeId: "t1",
                        tabs: [{ id: "t1", userId: "1", username: "a", token: "enc:!!!not-base64!!!" }]
                    })
                )
        });

        expect(result.tabs[0].token).toBeNull();
        // The tab itself survives, so the user keeps their identity and route.
        expect(result.tabs[0].username).toBe("a");
    });
});

describe("tab lifecycle", () => {
    test("starts empty", async () => {
        const { result } = await run("empty-start");
        expect(result.count).toBe(0);
        expect(result.activeId).toBeNull();
    });

    test("gives each tab a unique id", async () => {
        const { result } = await run("create-and-activate");
        expect(result.uniqueIds).toBe(true);
        expect(result.count).toBe(2);
    });

    test("refuses to activate a tab that does not exist", async () => {
        const { result } = await run("create-and-activate");
        expect(result.badActiveRejected).toBe(true);
        expect(result.activeId).toBeNull();
    });

    test("activating the first tab is what makes the tab bar useful", async () => {
        // With no active id the bar would render every tab with nothing selected.
        const { result } = await run("first-tab-becomes-active");
        expect(result.activeId).toBe(result.expected);
    });

    test("adding a later tab does not steal focus", async () => {
        const { result } = await run("second-tab-does-not-steal-focus");
        expect(result.activeId).toBe(result.expected);
    });

    test("removing the active tab activates the one to its left", async () => {
        const { result } = await run("remove-active");
        expect(result.order).toEqual(result.expected);
        expect(result.activeId).toBe(result.expectedActive);
    });

    test("removing the only tab leaves nothing active", async () => {
        const { result } = await run("remove-last");
        expect(result.count).toBe(0);
        expect(result.activeId).toBeNull();
    });

    test("getAccountToken is scoped to the requested account", async () => {
        const { result } = await run("token-scope");
        expect(result.a).toBe("ta");
        expect(result.b).toBe("tb");
        expect(result.missing).toBeNull();
    });

    test("updating a route keeps the rest of the tab intact", async () => {
        const { result } = await run("update");
        expect(result.updated.username).toBe("a");
        expect(result.updated.token).toBe("keepme");
        expect(result.updated.route).toEqual({ guildId: "5", channelId: "6" });
        expect(result.unknown).toBeNull();
    });

    test("clearing removes every account", async () => {
        const { result } = await run("clear");
        expect(result.count).toBe(0);
        expect(result.activeId).toBeNull();
    });
});

describe("orphaned session partitions", () => {
    test("clears partitions whose tab is gone, keeping live and unrelated ones", async () => {
        const { result } = await run("orphan-cleanup", {
            seed: d => {
                const partitions = join(d, "sessionData", "Partitions");
                for (const name of [
                    "tesktop-account-live",
                    "tesktop-account-dead",
                    "tesktop-account-gone",
                    "something-else"
                ]) {
                    mkdirSync(join(partitions, name), { recursive: true });
                }
            }
        });

        // Each partition holds a live login, so leftovers have to be swept up.
        expect(result.clearedSessions.sort()).toEqual(["persist:tesktop-account-dead", "persist:tesktop-account-gone"]);
        expect(result.clearedSessions).not.toContain("persist:tesktop-account-live");
        expect(result.clearedSessions).not.toContain("persist:something-else");
    });

    test("is a no-op when there are no partitions on disk", async () => {
        const { result } = await run("orphan-cleanup");
        expect(result.clearedSessions).toEqual([]);
    });
});

describe("corrupt or hostile state files", () => {
    test("unparseable json starts empty instead of crashing", async () => {
        const { result } = await run("garbage-file", {
            seed: d => writeFileSync(join(d, STATE_FILE), "{not json at all")
        });
        expect(result.count).toBe(0);
    });

    test("drops malformed entries but keeps the valid ones", async () => {
        const { result } = await run("partial-file", {
            seed: d =>
                writeFileSync(
                    join(d, STATE_FILE),
                    JSON.stringify({
                        version: 1,
                        activeId: "good",
                        tabs: [
                            { id: "good", userId: "1", username: "keep", route: { guildId: "9", channelId: "8" } },
                            { nope: true },
                            null,
                            { id: "" }
                        ]
                    })
                )
        });

        expect(result.tabs).toHaveLength(1);
        expect(result.tabs[0].id).toBe("good");
        expect(result.tabs[0].route).toEqual({ guildId: "9", channelId: "8" });
        expect(result.activeId).toBe("good");
    });

    test("repairs an activeId pointing at a tab that is gone", async () => {
        const { result } = await run("ghost-active", {
            seed: d =>
                writeFileSync(
                    join(d, STATE_FILE),
                    JSON.stringify({ version: 1, activeId: "ghost", tabs: [{ id: "real", userId: "1", username: "u" }] })
                )
        });
        expect(result.activeId).toBeNull();
    });

    test("fills in missing optional fields with safe defaults", async () => {
        const { result } = await run("sparse-file", {
            seed: d => writeFileSync(join(d, STATE_FILE), JSON.stringify({ tabs: [{ id: "only" }] }))
        });

        expect(result.tab.username).toBeNull();
        expect(result.tab.token).toBeNull();
        expect(result.tab.route).toEqual({ guildId: null, channelId: null });
        expect(result.tab.unread).toBe(0);
    });
});