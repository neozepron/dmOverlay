/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    MESSAGE_ROW_GAP,
    MESSAGES_VIEWPORT_MAX_HEIGHT,
    MAX_RENDERED_MESSAGES,
    NotificationData,
    OverlayMessage
} from "./types";

// ============================================================================
// HTML Escaping Utilities
// ============================================================================

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Escapes characters for safe inclusion in JavaScript strings.
 */
export function escapeJs(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
}

/**
 * Formats a timestamp to a localized time string (HH:MM).
 */
export function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Safely serializes JSON for inline script injection.
 */
export function safeJsonForInlineScript(obj: unknown): string {
    return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ============================================================================
// CSS Styles
// ============================================================================

const CSS_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: transparent;
    overflow: hidden;
}
.notification {
    background: rgba(30, 32, 36, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 16px;
    margin: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideIn {
    from { opacity: 0; transform: translateX(100px); }
    to { opacity: 1; transform: translateX(0); }
}
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.header { -webkit-app-region: no-drag; }
body.shift-drag .header { -webkit-app-region: drag; cursor: move; }
.close-btn, .avatar, .reply-input, .send-btn, .messages { -webkit-app-region: no-drag; }
.avatar {
    width: 40px; height: 40px; border-radius: 50%;
    border: 2px solid rgba(88, 101, 242, 0.5); object-fit: cover;
}
.author-info { flex: 1; min-width: 0; }
.author-name {
    color: #fff; font-weight: 600; font-size: 14px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.timestamp { color: rgba(255,255,255,0.5); font-size: 11px; }
.close-btn {
    width: 28px; height: 28px; border: none;
    background: rgba(255,255,255,0.1); border-radius: 6px;
    color: rgba(255,255,255,0.7); cursor: pointer;
    font-size: 18px; line-height: 28px; text-align: center;
}
.close-btn:hover { background: rgba(237,66,69,0.8); color: #fff; }
.messages {
    display: flex;
    flex-direction: column;
    gap: ${MESSAGE_ROW_GAP}px;
    margin-top: 2px;
    max-height: ${MESSAGES_VIEWPORT_MAX_HEIGHT}px;
    overflow-y: auto;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.22) transparent;
}
.messages::-webkit-scrollbar { width: 8px; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.18);
    border-radius: 8px;
}
.messages::-webkit-scrollbar-thumb:hover {
    background: rgba(255,255,255,0.28);
}
.msg {
    color: rgba(255,255,255,0.92);
    font-size: 13px;
    line-height: 1.35;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0;
}
.msg-text {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
}
.msg-meta {
    color: rgba(255,255,255,0.45);
    font-size: 10px;
    flex: 0 0 auto;
}
.actions { display: flex; gap: 8px; margin-top: 12px; }
.reply-input {
    flex: 1; background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
    padding: 8px 12px; color: #fff; font-size: 13px; outline: none;
}
.reply-input:focus { border-color: rgba(88,101,242,0.6); }
.reply-input::placeholder { color: rgba(255,255,255,0.4); }
.send-btn {
    background: linear-gradient(135deg, #5865F2, #4752C4);
    border: none; border-radius: 8px; padding: 8px 16px;
    color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    min-width: 60px;
}
.send-btn:hover { opacity: 0.9; }
.send-btn:disabled { opacity: 0.6; cursor: not-allowed; }
`;

// ============================================================================
// Inline JavaScript for Overlay Window
// ============================================================================

function generateInlineScript(channelId: string, initialMessages: OverlayMessage[]): string {
    return `
const channelId = '${escapeJs(channelId)}';
const notifId = channelId;
const inp = document.getElementById('inp');
const btn = document.getElementById('sendBtn');
const closeBtn = document.getElementById('closeBtn');
const msgRoot = document.getElementById('messages');
const tsEl = document.getElementById('ts');
let sending = false;
const messages = ${safeJsonForInlineScript(initialMessages)};

function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}

function requestResize() {
    try {
        if (!window.dmOverlay || !window.dmOverlay.resize) return;
        const h = document.documentElement.scrollHeight;
        window.dmOverlay.resize(notifId, h);
    } catch {}
}

function scrollToBottom() {
    try { msgRoot.scrollTop = msgRoot.scrollHeight; } catch {}
}

function render() {
    const atBottom = (msgRoot.scrollTop + msgRoot.clientHeight) >= (msgRoot.scrollHeight - 24);
    msgRoot.innerHTML = '';
    for (const m of messages) {
        const row = document.createElement('div');
        row.className = 'msg';
        const text = document.createElement('span');
        text.className = 'msg-text';
        text.textContent = m.content || '';
        const meta = document.createElement('span');
        meta.className = 'msg-meta';
        meta.textContent = fmtTime(m.timestamp);
        row.appendChild(text);
        row.appendChild(meta);
        msgRoot.appendChild(row);
    }
    if (messages.length) {
        tsEl.textContent = fmtTime(messages[messages.length - 1].timestamp);
    }
    setTimeout(() => {
        if (atBottom) scrollToBottom();
        requestResize();
    }, 0);
}

function doClose() {
    if (window.dmOverlay) {
        window.dmOverlay.close(notifId);
    }
}

function doSend() {
    if (sending) return;
    const text = inp.value.trim();
    if (!text) return;
    
    sending = true;
    btn.textContent = '...';
    btn.disabled = true;
    
    if (window.dmOverlay) {
        window.dmOverlay.reply({
            channelId: channelId,
            content: text,
            notificationId: notifId
        });
        setTimeout(doClose, 10);
    } else {
        btn.textContent = 'Error';
        sending = false;
    }
}

closeBtn.addEventListener('click', doClose);
btn.addEventListener('click', doSend);
inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSend();
});

let shiftDown = false;
function setShiftDrag(on) {
    shiftDown = !!on;
    document.body.classList.toggle('shift-drag', shiftDown);
}
document.addEventListener('keydown', function(e) {
    if (e.key === 'Shift') setShiftDrag(true);
}, true);
document.addEventListener('keyup', function(e) {
    if (e.key === 'Shift') setShiftDrag(false);
}, true);
window.addEventListener('blur', function() { setShiftDrag(false); });

if (window.dmOverlay && window.dmOverlay.onAppend) {
    window.dmOverlay.onAppend(function(msg) {
        try {
            messages.push(msg);
            if (messages.length > ${MAX_RENDERED_MESSAGES}) messages.splice(0, messages.length - ${MAX_RENDERED_MESSAGES});
            render();
        } catch {}
    });
}

render();
setTimeout(() => { scrollToBottom(); requestResize(); }, 50);
setTimeout(function() { inp.focus(); }, 100);
`;
}

// ============================================================================
// HTML Generation
// ============================================================================

/**
 * Generates the complete HTML for an overlay notification window.
 */
export function generateHTML(data: NotificationData, initialMessages: OverlayMessage[]): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${CSS_STYLES}</style>
</head>
<body>
    <div class="notification">
        <div class="header">
            <img class="avatar" id="avatar" src="${escapeHtml(data.authorAvatar)}"
                 onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="author-info">
                <div class="author-name">${escapeHtml(data.authorName)}</div>
                <div class="timestamp" id="ts">${formatTime(data.timestamp)}</div>
            </div>
            <button class="close-btn" id="closeBtn">✕</button>
        </div>
        <div class="messages" id="messages"></div>
        <div class="actions">
            <input type="text" class="reply-input" placeholder="Type a reply..." id="inp">
            <button class="send-btn" id="sendBtn">Send</button>
        </div>
    </div>
    <script>${generateInlineScript(data.channelId, initialMessages)}</script>
</body>
</html>`;
}
