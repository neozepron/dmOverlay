/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, screen, ipcMain, app } from "electron";
import * as path from "path";
import * as fs from "fs";

import { logger } from "./logger";
import { escapeJs, generateHTML } from "./template";
import {
    ACTIVE_OPACITY,
    INACTIVE_OPACITY,
    MAX_OVERLAY_WINDOWS,
    MAX_RENDERED_MESSAGES,
    NotificationData,
    OverlayMessage,
    STATE_FILE,
    WINDOW_MARGIN,
    WINDOW_MAX_HEIGHT,
    WINDOW_MIN_HEIGHT,
    WINDOW_SPACING,
    WINDOW_WIDTH,
    WindowState
} from "./types";

// ============================================================================
// State Management
// ============================================================================

/** Active overlay windows keyed by DM channelId (one overlay per DM). */
const activeWindows = new Map<string, WindowState>();

/** Last manually dragged position, persisted across sessions. */
let lastDraggedPos: { x: number; y: number } | null = null;

/** Timer for debouncing state persistence. */
let savePosTimer: NodeJS.Timeout | null = null;

/** Path to the preload script (created on first use). */
let preloadPath: string | null = null;

// ============================================================================
// State Persistence
// ============================================================================

function getStatePath(): string {
    return path.join(app.getPath("userData"), STATE_FILE);
}

function loadPersistedState(): void {
    try {
        const statePath = getStatePath();
        if (!fs.existsSync(statePath)) return;

        const raw = fs.readFileSync(statePath, "utf8");
        const json = JSON.parse(raw);
        const x = Number(json?.lastDraggedPos?.x);
        const y = Number(json?.lastDraggedPos?.y);

        if (Number.isFinite(x) && Number.isFinite(y)) {
            lastDraggedPos = { x, y };
            logger.debug("Loaded lastDraggedPos:", lastDraggedPos);
        }
    } catch (e) {
        logger.warn("Failed to load persisted state:", e);
    }
}

function scheduleSaveState(): void {
    if (savePosTimer) clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
        try {
            const data = {
                version: 1,
                lastDraggedPos,
                savedAt: Date.now(),
            };
            fs.writeFileSync(getStatePath(), JSON.stringify(data, null, 2), "utf8");
        } catch (e) {
            logger.warn("Failed to persist state:", e);
        }
    }, 250);
}

// Load persisted state on module initialization
loadPersistedState();

// ============================================================================
// Utility Functions
// ============================================================================

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function normalizeRequestedHeight(h: unknown): number {
    const n = typeof h === "number" ? h : Number(h);
    if (!Number.isFinite(n)) return WINDOW_MIN_HEIGHT;
    return clamp(Math.ceil(n), WINDOW_MIN_HEIGHT, WINDOW_MAX_HEIGHT);
}

// ============================================================================
// Window Management
// ============================================================================

function enforceAlwaysOnTop(win: BrowserWindow): void {
    try {
        win.setAlwaysOnTop(true, "screen-saver", 1);
    } catch {
        try { win.setAlwaysOnTop(true); } catch { /* best effort */ }
    }
    try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
        try { win.setVisibleOnAllWorkspaces(true); } catch { /* best effort */ }
    }
    try {
        win.setFullScreenable(false);
    } catch { /* best effort */ }
}

function applyFocusOpacity(win: BrowserWindow): void {
    try {
        win.setOpacity(win.isFocused() ? ACTIVE_OPACITY : INACTIVE_OPACITY);
    } catch { /* best effort */ }
}

function getWindowPosition(index: number, winHeight: number, stackedHeightBelow: number): { x: number; y: number } {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    return {
        x: width - WINDOW_WIDTH - WINDOW_MARGIN,
        y: height - WINDOW_MARGIN - stackedHeightBelow - winHeight - (index * WINDOW_SPACING)
    };
}

function repositionWindows(): void {
    let index = 0;
    let stackedBelow = 0;

    for (const [, st] of activeWindows) {
        const win = st.win;
        if (win && !win.isDestroyed()) {
            // Don't override user-dragged positions
            if (st.manualPos) continue;

            const pos = getWindowPosition(index, st.currentHeight, stackedBelow);
            win.setPosition(pos.x, pos.y, true);
            stackedBelow += st.currentHeight;
            index++;
        }
    }
}

function updateDraggedPosition(key: string, win: BrowserWindow): void {
    try {
        const [x, y] = win.getPosition();
        lastDraggedPos = { x, y };
        const st = activeWindows.get(key);
        if (st) st.manualPos = { x, y };
        scheduleSaveState();
    } catch { /* best effort */ }
}

function getDiscordWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows().find((w: BrowserWindow) => {
        if (w.isDestroyed()) return false;

        // Exclude overlay windows
        for (const [, st] of activeWindows) {
            if (w === st.win) return false;
        }

        try {
            const url = w.webContents.getURL();
            return url.includes("discord");
        } catch {
            return false;
        }
    });
}

// ============================================================================
// Preload Script Management
// ============================================================================

const preloadCode = `
const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dmOverlay', {
    close: (id) => ipcRenderer.send('DMOVERLAY_CLOSE', id),
    reply: (data) => ipcRenderer.send('DMOVERLAY_REPLY', data),
    resize: (id, height) => ipcRenderer.send('DMOVERLAY_RESIZE', { id, height }),
    onAppend: (callback) => ipcRenderer.on('DMOVERLAY_APPEND', (e, msg) => callback(msg)),
    onResult: (callback) => ipcRenderer.on('DMOVERLAY_RESULT', (e, success) => callback(success))
});
`;

function getPreloadPath(): string {
    if (!preloadPath) {
        const tempDir = app.getPath("temp");
        preloadPath = path.join(tempDir, "dm-overlay-preload.js");
        fs.writeFileSync(preloadPath, preloadCode, "utf8");
        logger.debug("Preload script written to:", preloadPath);
    }
    return preloadPath;
}

// ============================================================================
// IPC Handlers
// ============================================================================

let ipcInitialized = false;

function initIpc(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;

    ipcMain.on("DMOVERLAY_CLOSE", (_event: Electron.IpcMainEvent, notifId: string) => {
        logger.debug("Close received:", notifId);
        closeNotification(null, notifId);
    });

    ipcMain.on("DMOVERLAY_REPLY", async (_event: Electron.IpcMainEvent, data: { channelId: string; content: string; notificationId: string }) => {
        logger.debug("Reply received:", data.content);

        const discordWin = getDiscordWindow();
        const notifWin = activeWindows.get(data.notificationId)?.win;

        if (!discordWin) {
            logger.error("Discord window not found");
            if (notifWin && !notifWin.isDestroyed()) {
                notifWin.webContents.send("DMOVERLAY_RESULT", false);
            }
            return;
        }

        try {
            const result = await discordWin.webContents.executeJavaScript(
                `(async function() {
                    try {
                        if (window.__dmOverlaySendMessage) {
                            return await window.__dmOverlaySendMessage('${escapeJs(data.channelId)}', '${escapeJs(data.content)}');
                        }
                        return false;
                    } catch(e) {
                        return false;
                    }
                })()`
            );

            logger.debug("Reply result:", result);

            if (notifWin && !notifWin.isDestroyed()) {
                notifWin.webContents.send("DMOVERLAY_RESULT", result === true);
            }
        } catch (err) {
            logger.error("Execute error:", err);
            if (notifWin && !notifWin.isDestroyed()) {
                notifWin.webContents.send("DMOVERLAY_RESULT", false);
            }
        }
    });

    ipcMain.on("DMOVERLAY_RESIZE", (_event: Electron.IpcMainEvent, payload: { id: string; height: number }) => {
        try {
            const key = payload?.id;
            const st = key ? activeWindows.get(key) : undefined;
            if (!st?.win || st.win.isDestroyed()) return;

            const h = normalizeRequestedHeight(payload.height);
            if (st.currentHeight === h) return;

            st.currentHeight = h;
            st.win.setSize(WINDOW_WIDTH, h, true);
            repositionWindows();
        } catch { /* best effort */ }
    });

    logger.info("IPC handlers registered");
}

// Initialize IPC on module load
initIpc();

// ============================================================================
// Exported API
// ============================================================================

/**
 * Shows a notification overlay for a friend DM.
 * If an overlay already exists for the channel, appends the message to it.
 */
export function showNotification(_: unknown, data: NotificationData): void {
    logger.debug("Showing notification for:", data.authorName);

    const key = data.channelId;
    const msg: OverlayMessage = {
        id: data.messageId || data.id || `${Date.now()}`,
        content: data.content || "",
        timestamp: data.timestamp || Date.now()
    };

    // If we already have a window for this DM, append message to it
    const existing = activeWindows.get(key);
    if (existing?.win && !existing.win.isDestroyed()) {
        existing.messages.push(msg);
        if (existing.messages.length > MAX_RENDERED_MESSAGES) {
            existing.messages.splice(0, existing.messages.length - MAX_RENDERED_MESSAGES);
        }
        existing.lastTimestamp = msg.timestamp;

        // Move to top of stack (most recent)
        activeWindows.delete(key);
        activeWindows.set(key, existing);
        repositionWindows();

        try {
            existing.win.webContents.send("DMOVERLAY_APPEND", msg);
        } catch { /* best effort */ }

        // Show without stealing focus
        try {
            (existing.win as any).showInactive?.() ?? existing.win.showInactive();
        } catch { /* best effort */ }

        enforceAlwaysOnTop(existing.win);
        applyFocusOpacity(existing.win);
        return;
    }

    // Limit concurrent overlays
    if (activeWindows.size >= MAX_OVERLAY_WINDOWS) {
        const oldest = activeWindows.keys().next().value;
        if (oldest) closeNotification(null, oldest);
    }

    // Determine initial position
    const defaultPos = getWindowPosition(activeWindows.size, WINDOW_MIN_HEIGHT, 0);
    const pos = lastDraggedPos ?? defaultPos;
    const initialHeight = WINDOW_MIN_HEIGHT;

    // Create the overlay window
    const win = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: initialHeight,
        x: pos.x,
        y: pos.y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: getPreloadPath()
        }
    });

    enforceAlwaysOnTop(win);

    const html = generateHTML(
        { ...data, id: key, timestamp: msg.timestamp },
        [msg]
    );
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    win.webContents.on("did-finish-load", () => {
        logger.debug("Window loaded");
        // Show without stealing focus
        try {
            (win as any).showInactive?.() ?? win.showInactive?.() ?? win.show();
        } catch {
            win.show();
        }
        repositionWindows();
        enforceAlwaysOnTop(win);
        applyFocusOpacity(win);
    });

    // Opacity and always-on-top management
    win.on("show", () => enforceAlwaysOnTop(win));
    win.on("focus", () => { enforceAlwaysOnTop(win); applyFocusOpacity(win); });
    win.on("blur", () => { enforceAlwaysOnTop(win); applyFocusOpacity(win); });

    // Track manual drag position
    win.on("moved", () => updateDraggedPosition(key, win));

    // Store window state
    activeWindows.set(key, {
        win,
        channelId: key,
        authorName: data.authorName,
        authorAvatar: data.authorAvatar,
        messages: [msg],
        lastTimestamp: msg.timestamp,
        currentHeight: initialHeight,
        manualPos: lastDraggedPos ? { ...lastDraggedPos } : undefined
    });

    win.on("closed", () => {
        activeWindows.delete(key);
        repositionWindows();
    });
}

/**
 * Closes a specific notification overlay by its ID (channelId).
 */
export function closeNotification(_: unknown, id: string): void {
    logger.debug("Closing:", id);
    const st = activeWindows.get(id);
    const win = st?.win;
    if (win && !win.isDestroyed()) win.close();
    activeWindows.delete(id);
    repositionWindows();
}

/**
 * Closes all active notification overlays.
 */
export function closeAll(): void {
    for (const [, st] of activeWindows) {
        const win = st.win;
        if (win && !win.isDestroyed()) win.close();
    }
    activeWindows.clear();
}
