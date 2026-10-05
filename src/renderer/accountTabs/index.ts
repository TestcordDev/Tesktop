/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { VesktopLogger } from "../logger";
import { Settings } from "../settings";

let started = false;

export async function initAccountTabs() {
    if (started) return;
    started = true;

    if (!Settings.store.accountTabs) return;

    try {
        if (Settings.store.accountTabsMode === "parallel") {
            const { initParallelRenderer } = await import("./parallel");
            await initParallelRenderer();
        } else {
            const { initSwapMode } = await import("./swap");
            await initSwapMode();
        }
    } catch (err) {
        started = false;
        VesktopLogger.error("Account tabs failed to start", err);
    }
}
