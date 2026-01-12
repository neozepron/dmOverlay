/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BrowserWindow } from "electron";

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Data structure for a notification to be displayed in the overlay.
 */
export interface NotificationData {
    id: string;
    authorId?: string;
    authorName: string;
    authorAvatar: string;
    content: string;
    channelId: string;
    timestamp: number;
    messageId?: string;
}

/**
 * Represents a single message in the overlay window.
 */
export interface OverlayMessage {
    id: string;
    content: string;
    timestamp: number;
}

/**
 * Internal state for an active overlay window.
 */
export interface WindowState {
    win: BrowserWindow;
    channelId: string;
    authorName: string;
    authorAvatar: string;
    messages: OverlayMessage[];
    lastTimestamp: number;
    currentHeight: number;
    manualPos?: { x: number; y: number };
}

// ============================================================================
// Configuration Constants
// ============================================================================

/** Width of the overlay window (in pixels). */
export const WINDOW_WIDTH = 494;

/** Minimum height of the overlay window (in pixels). */
export const WINDOW_MIN_HEIGHT = 160;

/** Maximum height of the overlay window (in pixels). */
export const WINDOW_MAX_HEIGHT = 420;

/** Margin from screen edge (in pixels). */
export const WINDOW_MARGIN = 20;

/** Spacing between stacked overlay windows (in pixels). */
export const WINDOW_SPACING = 10;

/** Opacity when the overlay is focused. */
export const ACTIVE_OPACITY = 1;

/** Opacity when the overlay is not focused. */
export const INACTIVE_OPACITY = 0.5;

/** Gap between message rows in the overlay (in pixels). */
export const MESSAGE_ROW_GAP = 6;

/** Maximum number of messages to keep in memory per overlay. */
export const MAX_RENDERED_MESSAGES = 200;

/** Maximum number of visible messages before scrolling. */
export const MAX_VISIBLE_MESSAGES = 4;

/** Approximate maximum height per message block (in pixels). */
export const MESSAGE_BLOCK_MAX_PX = 52;

/** Maximum height for the messages viewport (calculated). */
export const MESSAGES_VIEWPORT_MAX_HEIGHT =
    MAX_VISIBLE_MESSAGES * MESSAGE_BLOCK_MAX_PX + (MAX_VISIBLE_MESSAGES - 1) * MESSAGE_ROW_GAP;

/** Time-to-live for channel priming cache (in milliseconds). */
export const PRIME_TTL_MS = 60_000;

/** Maximum number of concurrent overlay windows. */
export const MAX_OVERLAY_WINDOWS = 5;

/** Filename for persisted state. */
export const STATE_FILE = "dm-overlay-state.json";
