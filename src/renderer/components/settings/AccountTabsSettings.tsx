/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Paragraph } from "@equicord/types/components";
import { useEffect, useState } from "@equicord/types/webpack/common";

import { type BooleanSetting, cl } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

function countAccounts() {
    try {
        return VesktopNative.accountTabs.get().tabs.length;
    } catch {
        return 0;
    }
}

export const accountTabsBooleanSettings: BooleanSetting[] = [
    {
        key: "accountTabsShowAvatars",
        title: "Show Avatars",
        description: "Display each account's avatar in its tab.",
        defaultValue: true
    },
    {
        key: "accountTabsRememberRoute",
        title: "Remember Where I Was",
        description: "Restore the last channel, DM or guild you were viewing in each account.",
        defaultValue: true
    },
    {
        key: "accountTabsConfirmClose",
        title: "Confirm Before Closing A Tab",
        description: "Ask for confirmation before removing an account tab.",
        defaultValue: false
    }
];

/**
 * Mode picker plus account management. Both modes share the same on-disk account
 * list, so switching between them keeps your tabs.
 */
export function AccountTabsModePicker({ settings }: { settings: Record<string, any> }) {
    const [count, setCount] = useState(countAccounts);
    const [encrypted, setEncrypted] = useState(true);
    const mode = settings.accountTabsMode ?? "swap";

    useEffect(() => {
        setCount(countAccounts());
        setEncrypted(VesktopNative.accountTabs.isEncryptionAvailable());
    }, [mode]);

    const clearAll = async () => {
        if (!count) return;
        if (
            !confirm(
                `Remove all ${count} account tab(s)?\n\n` +
                    "Each account stays logged in to Discord. You will have to sign in again if you add it back."
            )
        )
            return;

        await VesktopNative.accountTabs.clear();
        setCount(0);
    };

    return (
        <>
            <div className={cl("account-tabs-modes")}>
                <VesktopSettingsSwitch
                    title="Swap accounts in one Discord window"
                    description="Switching saves where you are, swaps the login and reloads Discord. Light on memory, but it takes a moment and background tabs cannot show live unread counts."
                    value={mode === "swap"}
                    onChange={v => {
                        settings.accountTabsMode = v ? "swap" : "parallel";
                        setCount(countAccounts());
                    }}
                />
                <VesktopSettingsSwitch
                    title="Run every account side by side"
                    description="Each account gets its own session and stays connected, so switching is instant and unread counts keep updating in the background. Uses more memory, and local app settings become per-account."
                    value={mode === "parallel"}
                    onChange={v => {
                        settings.accountTabsMode = v ? "parallel" : "swap";
                        setCount(countAccounts());
                    }}
                />
            </div>

            <div className={cl("account-tabs-footer")}>
                <Paragraph size="sm">
                    {count
                        ? `${count} account tab${count === 1 ? "" : "s"} saved. They persist across restarts.`
                        : "No account tabs saved yet."}
                </Paragraph>

                {!encrypted && (
                    <Paragraph size="sm" className={cl("account-tabs-warning")}>
                        Your system keychain is unavailable, so account tokens are saved without encryption. Avoid using
                        this on a shared machine.
                    </Paragraph>
                )}

                <div className={cl("account-tabs-actions")}>
                    <Button variant="dangerPrimary" disabled={!count} onClick={() => void clearAll()}>
                        Remove all accounts
                    </Button>
                </div>

                <Paragraph size="sm" className={cl("account-tabs-note")}>
                    Add accounts with the <b>+</b> button in the tab bar, or the <b>⚿</b> button to paste a user token.
                    Changing modes takes effect after restarting Tesktop.
                </Paragraph>
            </div>
        </>
    );
}
