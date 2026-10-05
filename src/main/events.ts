/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Session } from "electron";
import { EventEmitter } from "events";

import { UserAssetType } from "./userAssets";

export const AppEvents = new EventEmitter<{
    appLoaded: [];
    userAssetChanged: [UserAssetType];
    setTrayVariant: ["tray" | "trayUnread" | "traySpeaking" | "trayIdle" | "trayMuted" | "trayDeafened"];
    voiceCallStateChanged: [boolean];
    /**
     * A new session partition was created for an account tab. Handlers that are
     * registered per-session (screen share permissions, for one) subscribe to this
     * rather than being wired only into `session.defaultSession`.
     */
    newAccountSession: [Session];
}>();
