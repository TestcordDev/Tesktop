/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./updater";
import "./ipc";
import "./userAssets";
import "./vesktopProtocol";

import { app, BrowserWindow, nativeTheme } from "electron";
import { rmSync } from "fs";
import { join } from "path";

import { DATA_DIR, SESSION_DATA_DIR } from "./constants";
import { createFirstLaunchTour } from "./firstLaunch";
import { createWindows } from "./mainWindow";
import { registerMediaPermissionsHandler } from "./mediaPermissions";
import { registerScreenShareHandler } from "./screenShare";
import { Settings, State } from "./settings";
import { setAsDefaultProtocolClient } from "./utils/setAsDefaultProtocolClient";
import { isDeckGameMode } from "./utils/steamOS";

console.log("Testktop v" + app.getVersion());

process.env.TESTCORD_USER_DATA_DIR = DATA_DIR;

const isLinux = process.platform === "linux";

export let enableHardwareAcceleration = true;

function clearStaleWasmCodeCache() {
    const { electron } = process.versions;
    if (State.store.lastElectronVersion === electron) return;

    try {
        rmSync(join(SESSION_DATA_DIR, "Code Cache", "wasm"), { recursive: true, force: true });
        console.log(`Electron version changed to ${electron}, cleared WebAssembly code cache`);
    } catch (err) {
        console.error("Failed to clear code cache:", err);
        return;
    }

    State.store.lastElectronVersion = electron;
}

function init() {
    clearStaleWasmCodeCache();
    setAsDefaultProtocolClient("discord");

    // Tesktop GoofCord-inspired: ensure defaults for privacy/smoothness
    if (Settings.store.firewall === undefined) Settings.store.firewall = true;
    if (Settings.store.spoofChrome === undefined) Settings.store.spoofChrome = true;
    if (Settings.store.domOptimizer === undefined) Settings.store.domOptimizer = true;
    // RenderingOptimizations was breaking account switcher positioning — force disabled for now
    Settings.store.renderingOptimizations = false;
    // Tabs force-disabled for now (wrongly integrated)
    Settings.store.tabsEnabled = false;
    if (Settings.store.tabsPosition === undefined) Settings.store.tabsPosition = "top";

    // Apply GoofCord performance flags early
    try {
        const { applyPerformanceFlags } = require("./modules/performance");
        applyPerformanceFlags();
    } catch (e) {
        console.warn("[Tesktop] Failed to apply performance flags", e);
    }

    const { disableSmoothScroll, hardwareAcceleration, hardwareVideoAcceleration } = Settings.store;
    const { launchArguments } = State.store;

    const enabledFeatures = new Set(app.commandLine.getSwitchValue("enable-features").split(","));
    const disabledFeatures = new Set(app.commandLine.getSwitchValue("disable-features").split(","));
    app.commandLine.removeSwitch("enable-features");
    app.commandLine.removeSwitch("disable-features");

    if (!hardwareAcceleration || process.argv.includes("--disable-gpu")) {
        enableHardwareAcceleration = false;
        app.disableHardwareAcceleration();
    } else {
        if (hardwareVideoAcceleration) {
            enabledFeatures.add("AcceleratedVideoEncoder");
            enabledFeatures.add("AcceleratedVideoDecoder");

            if (isLinux) {
                enabledFeatures.add("AcceleratedVideoDecodeLinuxGL");
                enabledFeatures.add("AcceleratedVideoDecodeLinuxZeroCopyGL");
            }
        }
    }

    if (disableSmoothScroll) {
        app.commandLine.appendSwitch("disable-smooth-scrolling");
    }

    if (launchArguments) {
        const args = launchArguments.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        for (const arg of args) {
            const cleanArg = arg.replace(/^["']|["']$/g, "");
            if (cleanArg.startsWith("--")) {
                const eqIndex = cleanArg.indexOf("=");
                if (eqIndex !== -1) {
                    const key = cleanArg.slice(2, eqIndex);
                    const value = cleanArg.slice(eqIndex + 1);
                    if (key === "enable-features") {
                        value.split(",").forEach(feature => enabledFeatures.add(feature));
                    } else if (key === "disable-features") {
                        value.split(",").forEach(feature => disabledFeatures.add(feature));
                    } else {
                        app.commandLine.appendSwitch(key, value);
                    }
                } else {
                    app.commandLine.appendSwitch(cleanArg.slice(2));
                }
            }
        }
        console.log("Applied launch arguments:", launchArguments);
    }

    // work around chrome 66 disabling autoplay by default
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

    // Prevent Discord from registering as a media service.
    disabledFeatures.add("HardwareMediaKeyHandling");
    disabledFeatures.add("MediaSessionService");

    if (isLinux) {
        app.commandLine.appendSwitch("log-level", "3");

        // This is needed to fix washed out colours - https://github.com/electron/electron/issues/49566
        // Supposed to be fixed already according to comments there, but it's just not lol, I can repro on Electron 43.0.0
        // when moving the window from my main monitor (HDR - not sure if this is relevant lol) to second monitor (SDR) and back
        disabledFeatures.add("WaylandWpColorManagerV1");
    }

    // Ensure Vulkan is disabled on Wayland regardless of how Wayland was requested
    const isWaylandEnv = process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY;
    const wantsWayland =
        isWaylandEnv ||
        (launchArguments && launchArguments.includes("wayland")) ||
        app.commandLine.getSwitchValue("ozone-platform") === "wayland" ||
        process.argv.includes("--wayland");
    if (isLinux && wantsWayland) {
        disabledFeatures.add("Vulkan");
        enabledFeatures.delete("Vulkan");
    }

    disabledFeatures.forEach(feat => enabledFeatures.delete(feat));

    const enabledFeaturesArray = [...enabledFeatures].filter(Boolean);
    const disabledFeaturesArray = [...disabledFeatures].filter(Boolean);

    if (enabledFeaturesArray.length) {
        app.commandLine.appendSwitch("enable-features", enabledFeaturesArray.join(","));
        console.log("Enabled Chromium features:", enabledFeaturesArray.join(", "));
    }

    if (disabledFeaturesArray.length) {
        app.commandLine.appendSwitch("disable-features", disabledFeaturesArray.join(","));
        console.log("Disabled Chromium features:", disabledFeaturesArray.join(", "));
    }

    if (isDeckGameMode) nativeTheme.themeSource = "dark";

    app.whenReady().then(async () => {
        if (process.platform === "win32") app.setAppUserModelId("org.testcord.testktop");

        // GoofCord-inspired privacy: firewall + proxy + CSP
        try {
            const { initFirewall, unstrictCSP, initProxy } = await import("./modules/privacyFirewall");
            initFirewall();
            unstrictCSP();
            initProxy();
        } catch (e) {
            console.warn("[Tesktop] Privacy modules failed", e);
        }

        registerScreenShareHandler();
        registerMediaPermissionsHandler();

        bootstrap();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindows();
        });
    });
}

init();

async function bootstrap() {
    if (!Object.hasOwn(State.store, "firstLaunch")) {
        createFirstLaunchTour();
    } else {
        createWindows();
    }
}

export let darwinURL: string | undefined;
app.on("open-url", (_, url) => {
    darwinURL = url;
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy(Settings.store.webRTCIPHandlingPolicy ?? "default");
});
Settings.addChangeListener("webRTCIPHandlingPolicy", () => {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.setWebRTCIPHandlingPolicy(Settings.store.webRTCIPHandlingPolicy ?? "default");
    }
});
