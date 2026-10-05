/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "./settings";

export const DefaultEquibopSettings: Settings = {
    discordBranch: "stable",
    hardwareAcceleration: true,
    hardwareVideoAcceleration: false,
    // Tesktop fix: ensure Windows always has native titlebar by default so minimize/close never disappear
    // Upstream used `process.platform !== "win32"` (false on Windows -> frameless + Discord custom bar).
    // That relied on Discord's custom bar rendering correctly, which "sometimes" fails leaving no controls.
    // Force nativeTitleBar true on all platforms (especially Windows) as safe default; users can still opt-out via settings.
    nativeTitleBar: true,
    staticTitle: false,
    enableMenu: false,
    enableShadow: true,
    enableRoundedCorners: true,
    enableSplashScreen: true,
    splashTheming: true,
    splashProgress: false,
    splashPixelated: false,
    tray: true,
    minimizeToTray: true,
    clickTrayToShowHide: false,
    disableMinSize: false,
    disableSmoothScroll: false,
    enableTaskbarFlashing: false,
    arRPC: false,
    arRPCDisabled: false,
    arRPCDebug: false,
    arRPCProcessScanning: true,
    arRPCWebSocketAutoReconnect: true,
    openLinksWithElectron: false,
    middleClickAutoscroll: false,
    autoStartMinimized: false,
    webRTCIPHandlingPolicy: "default",
    appBadge: true,
    badgeOnlyForMentions: false,
    transparencyOption: "none",

    // Account Tabs
    accountTabs: false,
    accountTabsMode: "swap",
    accountTabsShowAvatars: true,
    accountTabsRememberRoute: true,
    accountTabsConfirmClose: false
};
