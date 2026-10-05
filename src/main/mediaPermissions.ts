/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Session, session, systemPreferences } from "electron";

import { AppEvents } from "./events";

/**
 * macOS gates mic and camera access behind a system prompt. Electron's own prompt
 * is not shown, so we have to ask for the access ourselves.
 *
 * Applied to the default session and to every account tab partition.
 */
export function registerMediaPermissionsHandler() {
    if (process.platform !== "darwin") return;

    const onNewAccountSession = (ses: Session) => installPermissionHandler(ses);
    AppEvents.on("newAccountSession", onNewAccountSession);

    installPermissionHandler(session.defaultSession);
}

function installPermissionHandler(ses: Session) {
    ses.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
        let granted = true;

        if ("mediaTypes" in details) {
            if (details.mediaTypes?.includes("audio")) {
                granted &&= await systemPreferences.askForMediaAccess("microphone");
            }
            if (details.mediaTypes?.includes("video")) {
                granted &&= await systemPreferences.askForMediaAccess("camera");
            }
        }

        callback(granted);
    });
}
