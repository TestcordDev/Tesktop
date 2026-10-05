/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type AccountTabsMode = "swap" | "parallel";

/**
 * How much of Discord's "where am I" we remember per account.
 * `guildId` is null for DMs / the home view, `channelId` is null when we only know the guild.
 */
export interface AccountRoute {
    guildId: string | null;
    channelId: string | null;
}

export interface AccountTabData {
    /** Stable tab id. A uuid, because a tab exists before we know who is logged into it. */
    id: string;
    /** Discord snowflake of the logged in user, or null while the tab is still logging in. */
    userId: string | null;
    username: string | null;
    discriminator: string | null;
    /** Avatar hash. Combine with userId via `avatarUrl`. */
    avatar: string | null;
    /** CSS colour derived from the user id, used when there is no avatar. */
    accentColor: string | null;
    token: string | null;
    route: AccountRoute;
    /** Unread mentions/messages. Only meaningful in parallel mode, where background tabs stay connected. */
    unread: number;
    lastUsed: number;
}

export interface AccountTabsState {
    tabs: AccountTabData[];
    activeId: string | null;
}

export const ACCOUNT_TABS_FILE_VERSION = 1;

export const EMPTY_ROUTE: AccountRoute = { guildId: null, channelId: null };

/**
 * Discord is hash routed. `#/channels/<guild>/<channel>` for guilds,
 * `#/channels/@me/<channel>` for DMs, `#/channels/@me` for home.
 */
export function routeToHash(route: AccountRoute): string {
    if (route.channelId && route.guildId) return `#/channels/${route.guildId}/${route.channelId}`;
    if (route.channelId) return `#/channels/@me/${route.channelId}`;
    if (route.guildId) return `#/channels/${route.guildId}`;
    return "#/channels/@me";
}

/** Inverse of {@link routeToHash}. Unrecognised hashes fall back to the home view. */
export function routeFromHash(hash: string): AccountRoute {
    const path = hash.replace(/^#/, "");
    const match = /^\/channels\/(?:@me|(\d+))(?:\/(\d+))?\/?$/.exec(path);
    if (!match) return { ...EMPTY_ROUTE };

    const guildId = match[1] ?? null;
    const channelId = match[2] ?? null;

    return { guildId, channelId };
}

/**
 * Discord picks one of six default avatars based on the user id. Doing the same
 * keeps the tab looking right for accounts that never set an avatar.
 */
export function defaultAvatarIndex(userId: string): number {
    try {
        return Number((BigInt(userId) >> 22n) % 6n);
    } catch {
        return 0;
    }
}

export function avatarUrl(tab: Pick<AccountTabData, "userId" | "avatar">, size = 80): string | null {
    if (!tab.userId) return null;
    if (tab.avatar)
        return `https://cdn.discordapp.com/avatars/${tab.userId}/${tab.avatar}.webp?size=${size}&quality=lossless`;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(tab.userId)}.png?size=${size}`;
}

/** Deterministic hue per account, so a given user always gets the same tab colour. */
export function accentColorFor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = (Math.imul(31, hash) + userId.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(hash) % 360}, 62%, 52%)`;
}

/** `@me` is Discord's "no guild selected" sentinel. */
export function normalizeGuildId(guildId: string | null | undefined): string | null {
    if (!guildId || guildId === "@me") return null;
    return guildId;
}

export function displayName(tab: Pick<AccountTabData, "username" | "discriminator">): string {
    if (!tab.username) return "Add account";
    if (!tab.discriminator || tab.discriminator === "0") return tab.username;
    return `${tab.username}#${tab.discriminator}`;
}
