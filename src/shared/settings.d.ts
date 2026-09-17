/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Rectangle } from "electron";

export interface Settings {
    discordBranch: "stable" | "canary" | "ptb";
    transparencyOption: "none" | "mica" | "tabbed" | "acrylic";
    webRTCIPHandlingPolicy:
        | "default"
        | "default_public_interface_only"
        | "default_public_and_private_interfaces"
        | "disable_non_proxied_udp";
    tray: boolean;
    minimizeToTray: boolean;
    autoStartMinimized: boolean;
    middleClickAutoscroll: boolean;
    openLinksWithElectron: boolean;
    staticTitle: boolean;
    enableMenu: boolean;
    enableShadow: boolean;
    enableRoundedCorners: boolean;
    disableSmoothScroll: boolean;
    hardwareAcceleration: boolean;
    hardwareVideoAcceleration: boolean;
    arRPC: boolean;
    arRPCDisabled: boolean;
    arRPCDebug: boolean;
    arRPCProcessScanning: boolean;
    arRPCWebSocketAutoReconnect: boolean;
    arRPCWebSocketCustomHost?: string;
    arRPCWebSocketCustomPort?: number;
    appBadge: boolean;
    badgeOnlyForMentions: boolean;
    enableTaskbarFlashing: boolean;
    disableMinSize: boolean;
    clickTrayToShowHide: boolean;
    nativeTitleBar: boolean;

    enableSplashScreen: boolean;
    splashTheming: boolean;
    splashPixelated: boolean;
    splashColor?: string;
    splashBackground?: string;
    splashProgress: boolean;

    spellCheckLanguages?: string[];

    // === Tesktop GoofCord-inspired Privacy & Smoothness ===
    // Privacy
    firewall?: boolean;
    customFirewallRules?: boolean;
    blocklist?: string[];
    blockedStrings?: string[];
    allowedStrings?: string[];
    proxyEnabled?: boolean;
    proxyRules?: string;
    proxyBypassRules?: string;
    spoofChrome?: boolean;
    spoofWindows?: boolean;
    invidiousEmbeds?: boolean;
    invidiousInstance?: string;
    autoUpdateInvidiousInstance?: boolean;
    messageEncryption?: boolean;
    encryptionPasswords?: string[];
    encryptionCover?: string;
    encryptionMark?: string;

    // Performance & Smoothness
    domOptimizer?: boolean;
    renderingOptimizations?: boolean;
    forceDedicatedGPU?: boolean;
    performanceFlags?: boolean;
    vaapi?: boolean;
    disableGpuCompositing?: boolean;
    disableSettingsAnimations?: boolean;
    autoscroll?: boolean;
    popoutWindowAlwaysOnTop?: boolean;
    customIconPath?: string;
    trayIconStyle?: "default" | "symbolic_black" | "symbolic_white";

    // Innovative Tabs
    tabsEnabled?: boolean;
    tabsPosition?: "top" | "left" | "hidden";
    tabsShowNavigationButtons?: boolean;

    audio?: {
        workaround?: boolean;

        deviceSelect?: boolean;
        granularSelect?: boolean;

        ignoreVirtual?: boolean;
        ignoreDevices?: boolean;
        ignoreInputMedia?: boolean;

        mute?: boolean;
        onlySpeakers?: boolean;
        onlyDefaultSpeakers?: boolean;
    };
}

export interface State {
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;

    firstLaunch?: boolean;

    steamOSLayoutVersion?: number;
    linuxAutoStartEnabled?: boolean;

    testcordDir?: string;

    launchArguments?: string;

    lastElectronVersion?: string;

    updater?: {
        ignoredVersion?: string;
        snoozeUntil?: number;
    };
}
