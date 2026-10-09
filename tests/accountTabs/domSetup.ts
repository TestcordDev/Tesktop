/*
 * Shared DOM setup for the account-tabs renderer tests.
 *
 * `src/renderer/utils.ts` captures localStorage and sessionStorage at import time,
 * because Discord deletes both from the window. Every suite that imports code
 * depending on it therefore has to share a single Window: otherwise whichever file
 * bun runs first captures its own storage and the rest read a different window.
 */
import { Window } from "happy-dom";

export const win = new Window({ url: "https://discord.com/app" });

const g = globalThis as any;
g.window = win;
g.document = win.document;
g.location = win.location;
g.localStorage = win.localStorage;
g.sessionStorage = win.sessionStorage;

// renderer/utils.ts calls this at import time to detect the platform.
g.VesktopNative = {
    app: {
        getPlatformSpoofInfo: () => ({
            spoofed: false,
            originalPlatform: "Linux",
            spoofedPlatform: null
        })
    }
};

export default win;