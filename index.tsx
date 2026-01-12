/// <reference path="../../globals.d.ts" />

import { Devs } from "../../utils/constants";
import definePlugin from "../../utils/types";
import { findByPropsLazy } from "../../webpack/webpack";
import { FluxDispatcher, RelationshipStore, UserStore } from "../../webpack/common";

import { logger } from "./logger";
import { NotificationData, PRIME_TTL_MS } from "./types";

// ============================================================================
// Native Bridge
// ============================================================================

const Native = VencordNative.pluginHelpers.dmOverlay as unknown as {
    showNotification: (data: NotificationData) => void;
    closeNotification: (id: string) => void;
    closeAll: () => void;
};

// ============================================================================
// Discord Module References
// ============================================================================

const MessageActions = findByPropsLazy("sendMessage", "receiveMessage");
const ChannelStore = findByPropsLazy("getChannel", "getDMFromUserId");
const SoundModule = findByPropsLazy("playUISound", "playSound", "createSound", "getSound") as any;

// ============================================================================
// Sound Handling
// ============================================================================

/** Plays a notification sound using Discord's built-in UI sounds. */
function playOverlaySound(): void {
    const candidates = [
        "activity_user_leave",
        "user_leave",
        "activity_leave",
        "leave",
    ];

    for (const key of candidates) {
        try {
            if (typeof SoundModule?.playUISound === "function") {
                SoundModule.playUISound(key);
                return;
            }
            if (typeof SoundModule?.playSound === "function") {
                SoundModule.playSound(key);
                return;
            }
        } catch {
            // Try next key
        }
    }
}

// ============================================================================
// Channel Priming
// ============================================================================

/** Cache of last primed timestamps per channel. */
const lastPrimedAt = new Map<string, number>();

/**
 * Primes a DM channel to reduce latency when sending messages.
 * Fetches messages and marks the channel as ready.
 */
async function primeChannel(channelId: string): Promise<void> {
    const now = Date.now();
    const last = lastPrimedAt.get(channelId) ?? 0;
    if (now - last < PRIME_TTL_MS) return;
    lastPrimedAt.set(channelId, now);

    const actions = MessageActions as any;
    try {
        if (typeof actions?.jumpToPresent === "function") {
            try { actions.jumpToPresent(channelId); } catch { /* best effort */ }
        }
        if (typeof actions?.fetchMessages === "function") {
            try { await actions.fetchMessages({ channelId, limit: 50 }); } catch { /* best effort */ }
        }
        if (typeof actions?.fetchLocalMessages === "function") {
            try { await actions.fetchLocalMessages(channelId); } catch { /* best effort */ }
        }
        if (typeof actions?.fetchNewLocalMessages === "function") {
            try { await actions.fetchNewLocalMessages(channelId); } catch { /* best effort */ }
        }
    } catch {
        // Best effort only
    }
}

// ============================================================================
// Message Sending
// ============================================================================

/** Generates a Discord snowflake-like nonce for messages. */
function generateNonce(): string {
    return ((BigInt(Date.now() - 1420070400000) << 22n)).toString();
}

/**
 * Attempts to send a message using Discord's MessageActions.
 * Tries multiple calling conventions for compatibility.
 */
async function sendMessageSafe(channelId: string, content: string): Promise<boolean> {
    logger.debug("Attempting to send message:", { channelId, content });

    if (!MessageActions?.sendMessage) {
        logger.error("MessageActions.sendMessage not found");
        return false;
    }

    const nonce = generateNonce();
    const messageData = {
        content,
        nonce,
        tts: false,
        invalidEmojis: [],
        validNonShortcutEmojis: [],
    };

    const send = MessageActions.sendMessage.bind(MessageActions) as any;
    const options = { nonce };

    // Prime the channel before sending
    logger.debug("Priming channel (best-effort)...");
    await primeChannel(channelId);

    // Try different calling conventions for compatibility
    const attempts: Array<() => any> = [
        () => send(channelId, messageData, true, options),
        () => send(channelId, messageData, false, options),
        () => send(channelId, messageData, true),
        () => send(channelId, messageData),
    ];

    for (const [idx, fn] of attempts.entries()) {
        try {
            logger.debug(`sendMessage attempt #${idx + 1}`, { channelId, nonce });
            const res = fn();
            if (res && typeof res.then === "function") await res;
            logger.debug("Message sent successfully");
            return true;
        } catch (err: any) {
            logger.error(`sendMessage attempt #${idx + 1} failed:`, err?.message || err);
        }
    }

    return false;
}

// ============================================================================
// Global Send Function
// ============================================================================

/**
 * Sets up the global send function accessible from the overlay window.
 */
function setupSendFunction(): void {
    (window as any).__dmOverlaySendMessage = async (channelId: string, content: string): Promise<boolean> => {
        logger.debug("Sending message to:", channelId);
        const ok = await sendMessageSafe(channelId, content);
        logger.debug("Send result:", ok);
        return ok;
    };

    logger.info("Send function ready");
}

// ============================================================================
// Avatar URL Generation
// ============================================================================

/**
 * Constructs the CDN URL for a user's avatar.
 */
function getAvatarUrl(userId: string, avatar?: string): string {
    if (avatar) {
        const ext = avatar.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=128`;
    }
    // Default avatar based on user ID
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
}

// ============================================================================
// Message Event Handler
// ============================================================================

/**
 * Handles incoming messages from Discord's Flux dispatcher.
 * Filters for friend DMs and shows overlay notifications.
 */
function onMessageCreate(event: any): void {
    // Ignore optimistic and invalid messages
    if (event.optimistic || !event.message) return;

    const msg = event.message;

    // Only handle DMs (no guild_id)
    if (msg.guild_id) return;

    // Ignore messages from self
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || msg.author.id === currentUser.id) return;

    // Only show notifications for friends
    if (!RelationshipStore.isFriend(msg.author.id)) return;

    logger.debug("Friend DM from:", msg.author.username);

    try {
        // Play notification sound
        playOverlaySound();

        // Show overlay notification
        Native.showNotification({
            id: msg.channel_id,
            authorId: msg.author.id,
            authorName: msg.author.global_name || msg.author.username,
            authorAvatar: getAvatarUrl(msg.author.id, msg.author.avatar),
            content: msg.content || "[Attachment/Embed]",
            channelId: msg.channel_id,
            timestamp: Date.now(),
            messageId: msg.id,
        });

        // Prime channel for faster replies
        void primeChannel(msg.channel_id);
    } catch (err) {
        logger.error("Failed to show notification:", err);
    }
}

// ============================================================================
// Plugin Definition
// ============================================================================

export default definePlugin({
    name: "dmOverlay",
    description: "Shows overlay notifications for friend DMs on top of games",
    authors: [Devs.Ven],

    start() {
        logger.info("Starting...");
        setupSendFunction();
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        logger.info("Started");
    },

    stop() {
        logger.info("Stopping...");
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        delete (window as any).__dmOverlaySendMessage;
        try { Native.closeAll(); } catch { /* best effort */ }
        logger.info("Stopped");
    },
});
