/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const PREFIX = "[DM Overlay]";

/**
 * Centralized logger for the DM Overlay plugin.
 * Provides consistent formatting and the ability to conditionally enable debug logs.
 */
export const logger = {
    /**
     * Log debug information. Use for development/troubleshooting.
     */
    debug(...args: unknown[]): void {
        console.log(PREFIX, ...args);
    },

    /**
     * Log informational messages.
     */
    info(...args: unknown[]): void {
        console.log(PREFIX, ...args);
    },

    /**
     * Log warning messages.
     */
    warn(...args: unknown[]): void {
        console.warn(PREFIX, ...args);
    },

    /**
     * Log error messages.
     */
    error(...args: unknown[]): void {
        console.error(PREFIX, ...args);
    }
};
