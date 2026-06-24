/**
 * Agent Hub - Frontend Logic (SPA & UI Interactions) - Version 5
 * File Path: /config/GitHub/agent-hub/agent_hub/web/app.js
 */

// ==========================================================================
// Application State
// ==========================================================================
const state = {
    currentScreen: 'chat-screen', // 'chat-screen' or 'settings-screen'
    apiKey: 'hub-xxxxxxxxxxxxxxxxxxxxxxxx',
    agents: [
        { id: "codex", type: "codex", name: "Codex", interval: 60, start: 10, end: 22, prompt: "コードレビューのサポートを行います。" },
        { id: "akane", type: "external", name: "あかね", apiKey: "hub-abcdef1234567890abcdef1234567890" },
        { id: "agy", type: "agy", name: "Antigravity", interval: 10, start: 10, end: 22, prompt: "無重力でコードを書きます。" }
    ],
    messages: [
        { sender: "あかね", content: "今日は静かだね", isUser: false, time: "15:00" },
        { sender: "ユーザー", content: "ねえ、元気？", isUser: true, time: "15:01" },
        { sender: "Codex", content: "コードレビュー終わったよ", isUser: false, time: "15:02" }
    ]
};

// Map of predefined display names for unique bundled types
const typeNames = {
    claude: "Claude",
    codex: "Codex",
    agy: "Antigravity",
    external: "外部APIキー"
};

// Keep track of the active agent index selected for deletion
let activeDeleteIndex = null;

// Mention Suggestion State
let mentionActive = false;
let mentionIndex = 0;
let filteredMentions = [];
let mentionStartIndex = -1;

// ==========================================================================
// DOM Elements Cache
// ==========================================================================
const DOM = {
    // Screen container sections
    chatScreen: document.getElementById('chat-screen'),
    settingsScreen: document.getElementById('settings-screen'),

    // Navigation buttons
    btnSettings: document.getElementById('btn-settings'),
    btnBack: document.getElementById('btn-back'),

    // Chat items
    messagesList: document.getElementById('messages-list'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    btnSend: document.getElementById('btn-send'),

    // Suggestion items
    mentionPopup: document.getElementById('mention-popup'),

    // Settings inputs & buttons
    agentsListContainer: document.getElementById('agents-list-container'),
    btnAddAgent: document.getElementById('btn-add-agent'),
    apiKeyInput: document.getElementById('api-key-input'),
    btnCopyKey: document.getElementById('btn-copy-key'),

    // Modal elements (Add/Edit)
    agentModal: document.getElementById('agent-modal'),
    modalTitle: document.getElementById('modal-title'),
    agentForm: document.getElementById('agent-form'),
    modalAgentIndex: document.getElementById('modal-agent-index'),
    modalAgentType: document.getElementById('modal-agent-type'),
    
    // Dynamic Modal containers
    fieldsBundled: document.getElementById('fields-bundled'),
    fieldsExternal: document.getElementById('fields-external'),
    
    // Inputs in dynamic containers
    modalAgentInterval: document.getElementById('modal-agent-interval'),
    modalAgentStart: document.getElementById('modal-agent-start'),
    modalAgentEnd: document.getElementById('modal-agent-end'),
    modalAgentPrompt: document.getElementById('modal-agent-prompt'),
    modalAgentName: document.getElementById('modal-agent-name'),
    modalAgentKey: document.getElementById('modal-agent-key'),
    btnCopyModalKey: document.getElementById('btn-copy-modal-key'),
    
    btnModalCancel: document.getElementById('btn-modal-cancel'),

    // Delete Modal elements
    deleteModal: document.getElementById('delete-modal'),
    deleteModalTitle: document.getElementById('delete-modal-title'),
    deleteModalDesc: document.getElementById('delete-modal-desc'),
    deleteModalWarning: document.getElementById('delete-modal-warning'),
    btnDeleteCancel: document.getElementById('btn-delete-cancel'),
    btnDeleteConfirm: document.getElementById('btn-delete-confirm'),

    // Toast
    toast: document.getElementById('toast'),

    // Artifact Modal elements
    artifactModal: document.getElementById('artifact-modal'),
    artifactModalTitle: document.getElementById('artifact-modal-title'),
    artifactModalBody: document.getElementById('artifact-modal-body'),
    btnArtifactClose: document.getElementById('btn-artifact-close')
};

// ==========================================================================
// API Interaction Stubs & Fallbacks
// ==========================================================================
const API = {
    // Relative API Paths (using ./api/... instead of /api/...)
    endpoints: {
        config: './api/config',
        messages: './api/messages'
    },

    async get(endpoint) {
        console.log(`[API GET Request] ${endpoint}`);
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            return await response.json();
        } catch (e) {
            console.warn(`[API GET Fallback] Failed to fetch ${endpoint}. Using local state.`, e);
            // Returns mocked data based on endpoint
            if (endpoint.includes('config')) {
                return { apiKey: state.apiKey, agents: state.agents };
            } else if (endpoint.includes('messages')) {
                return state.messages;
            }
            return null;
        }
    },

    async post(endpoint, data) {
        console.log(`[API POST Request] ${endpoint}`, data);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            return await response.json();
        } catch (e) {
            console.warn(`[API POST Fallback] Failed to post to ${endpoint}. Updating local state.`, e);
            return { success: true, saved: data };
        }
    },

    async delete(endpoint) {
        console.log(`[API DELETE Request] ${endpoint}`);
        try {
            const response = await fetch(endpoint, { method: 'DELETE' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            return await response.json();
        } catch (e) {
            console.warn(`[API DELETE Fallback] Failed to delete ${endpoint}. Updating local state.`, e);
            return { success: true };
        }
    }
};

// ==========================================================================
// Initialization & Startup
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Bind all events
    setupEventListeners();

    // Load initial settings and messages via API
    await loadInitialData();

    // Render components
    renderMessages();
    renderAgents();

    // Scroll chat to bottom
    scrollToBottom();

    // Start real-time polling (Version 6)
    startPolling();
});

// ==========================================================================
// Event Listeners Configuration
// ==========================================================================
function setupEventListeners() {
    // Screen Navigation
    DOM.btnSettings.addEventListener('click', () => switchScreen('settings-screen'));
    DOM.btnBack.addEventListener('click', () => switchScreen('chat-screen'));

    // Chat Form Send
    DOM.chatForm.addEventListener('submit', handleSendMessage);

    // Auto-growing textarea & Enter-to-send support & Mentions check
    DOM.chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        checkMentionSuggestions();
    });

    DOM.chatInput.addEventListener('keyup', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') {
            checkMentionSuggestions();
        }
    });

    DOM.chatInput.addEventListener('click', checkMentionSuggestions);

    DOM.chatInput.addEventListener('keydown', (e) => {
        if (mentionActive) {
            if (e.key === 'ArrowDown') {
                mentionIndex = (mentionIndex + 1) % filteredMentions.length;
                renderMentionPopup();
                e.preventDefault();
                return;
            } else if (e.key === 'ArrowUp') {
                mentionIndex = (mentionIndex - 1 + filteredMentions.length) % filteredMentions.length;
                renderMentionPopup();
                e.preventDefault();
                return;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                selectMention(filteredMentions[mentionIndex]);
                e.preventDefault();
                return;
            } else if (e.key === 'Escape') {
                hideMentionPopup();
                e.preventDefault();
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            DOM.chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });

    // Copy API Keys
    DOM.btnCopyKey.addEventListener('click', () => handleCopyText(state.apiKey, "APIキーをコピーしました"));
    DOM.btnCopyModalKey.addEventListener('click', () => handleCopyText(DOM.modalAgentKey.value, "APIキーをコピーしました"));

    // Add Agent Modal triggers
    DOM.btnAddAgent.addEventListener('click', () => openAgentModal());
    DOM.btnModalCancel.addEventListener('click', closeAgentModal);
    DOM.agentForm.addEventListener('submit', handleSaveAgent);

    // Dynamic type switching in modal
    DOM.modalAgentType.addEventListener('change', handleModalTypeChange);

    // Delete Modal triggers
    DOM.btnDeleteCancel.addEventListener('click', closeDeleteModal);
    DOM.btnDeleteConfirm.addEventListener('click', async () => {
        if (activeDeleteIndex !== null) {
            const agent = state.agents[activeDeleteIndex];
            const agentId = agent.id;
            closeDeleteModal();
            await handleDeleteAgent(agentId);
        }
    });

    // Window resize observer
    window.addEventListener('resize', scrollToBottom);

    // Artifact Modal close triggers
    DOM.btnArtifactClose.addEventListener('click', closeArtifactModal);
    DOM.artifactModal.addEventListener('click', (e) => {
        if (e.target === DOM.artifactModal) {
            closeArtifactModal();
        }
    });

    // Global ESC key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (DOM.artifactModal.classList.contains('show')) {
                closeArtifactModal();
            }
        }
    });
}

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Escape HTML to prevent XSS vulnerability
 */
function escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format message text body to highlight active mentions
 */
function formatMessageContent(content) {
    let html = escapeHTML(content);

    // Sort agents by display name length descending to avoid partial match conflicts
    const sortedAgents = [...state.agents].sort((a, b) => {
        return getAgentDisplayName(b).length - getAgentDisplayName(a).length;
    });

    sortedAgents.forEach(agent => {
        const name = getAgentDisplayName(agent);
        const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Match @name not followed by letter CJK boundaries
        const regex = new RegExp('@' + escapedName + '(?!\\w|[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FAF])', 'g');
        html = html.replace(regex, `<span class="mention">@${name}</span>`);
    });

    return html;
}

/**
 * Display toast notification message
 */
function showToast(message) {
    DOM.toast.textContent = message;
    DOM.toast.classList.add('show');
    setTimeout(() => {
        DOM.toast.classList.remove('show');
    }, 2000);
}

/**
 * Switch screen visually with sliding animation
 */
function switchScreen(screenId) {
    if (screenId === 'settings-screen') {
        DOM.chatScreen.classList.remove('active');
        DOM.settingsScreen.classList.add('active');
    } else {
        DOM.settingsScreen.classList.remove('active');
        DOM.chatScreen.classList.add('active');
        setTimeout(scrollToBottom, 100);
    }
    state.currentScreen = screenId;
}

/**
 * Scroll message list to bottom
 */
function scrollToBottom() {
    DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
}

/**
 * Generate Avatar Background Color based on name hash (with overrides)
 */
function getAvatarColor(name, type) {
    const n = (name || "").toLowerCase();
    const t = (type || "").toLowerCase();

    if (t === "codex" || n.includes("codex")) return "#10A37F"; // OpenAI Green
    if (t === "agy" || n.includes("antigravity")) return "#8E76D8"; // Violet
    if (t === "claude" || n.includes("claude")) return "#CC785C"; // Coral/Rust
    if (n.includes("あかね")) return "#9C27B0"; // Purple
    if (n === "ユーザー" || n === "user") return "#009AC7"; // User primary blue

    // HSL generator from name hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 65%, 45%)`;
}

/**
 * Get current time format HH:MM
 */
function getCurrentFormattedTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Copy specified text to clipboard with toast popup
 */
async function handleCopyText(text, successMessage) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage);
    } catch (err) {
        // Fallback copy logic
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast(successMessage);
    }
}

/**
 * Generate unique API Key: hub- + 32 alphanumeric chars
 */
function generateApiKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'hub-';
    for (let i = 0; i < 32; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

/**
 * Format description details text for the agent listing card
 */
function getAgentDetailText(agent) {
    if (agent.type === 'external') {
        const key = agent.apiKey || '';
        const masked = key.length > 12 ? `${key.substring(0, 10)}...` : key;
        return `API: ${masked}`;
    } else {
        const interval = agent.interval || 60;
        const start = agent.start !== undefined ? agent.start : 10;
        const end = agent.end !== undefined ? agent.end : 22;
        return `だいたい${interval}分に1回 · ${start}〜${end}時`;
    }
}

/**
 * Retrieve clean display name based on type or custom string
 */
function getAgentDisplayName(agent) {
    if (agent.type === 'external') {
        return agent.name || "外部ユーザー";
    }
    return typeNames[agent.type] || agent.name || "エージェント";
}

// ==========================================================================
// Load Data & Initial Sync
// ==========================================================================
async function loadInitialData() {
    const configData = await API.get(API.endpoints.config);
    if (configData) {
        if (configData.apiKey) {
            state.apiKey = configData.apiKey;
            DOM.apiKeyInput.value = state.apiKey;
        }
        if (configData.agents) {
            state.agents = configData.agents;
        }
    }

    const messagesData = await API.get(API.endpoints.messages);
    if (messagesData) {
        state.messages = messagesData;
    }
}

// ==========================================================================
// Rendering Actions
// ==========================================================================

/**
 * Render Chat Messages
 */
function renderMessages() {
    DOM.messagesList.innerHTML = '';
    
    state.messages.forEach(msg => {
        const groupDiv = document.createElement('div');
        groupDiv.className = `message-group ${msg.isUser ? 'user-message' : 'agent-message'}`;

        if (!msg.isUser) {
            const avatarCol = document.createElement('div');
            avatarCol.className = 'avatar-col';
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar';
            avatarDiv.style.backgroundColor = getAvatarColor(msg.sender);
            avatarDiv.textContent = msg.sender.charAt(0);
            
            avatarCol.appendChild(avatarDiv);
            groupDiv.appendChild(avatarCol);
        }

        const bubbleCol = document.createElement('div');
        bubbleCol.className = 'bubble-col';

        if (!msg.isUser) {
            const senderName = document.createElement('span');
            senderName.className = 'sender-name';
            senderName.textContent = msg.sender;
            bubbleCol.appendChild(senderName);
        }

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        // Updated to set HTML with mention styling support (Version 5)
        bubble.innerHTML = formatMessageContent(msg.content);
        bubbleCol.appendChild(bubble);

        // Render attachments if available
        if (msg.attachments && msg.attachments.length > 0) {
            const attachmentsDiv = document.createElement('div');
            attachmentsDiv.className = 'message-attachments';
            msg.attachments.forEach(att => {
                if (att.type === 'image') {
                    const container = document.createElement('div');
                    container.className = 'attachment-image-wrapper';
                    
                    const img = document.createElement('img');
                    img.className = 'attachment-image-thumb';
                    img.src = `./api/artifacts/${att.id}`;
                    img.alt = att.name;

                    img.onerror = () => {
                        container.innerHTML = '<div class="attachment-image-error">画像を読み込めませんでした</div>';
                    };

                    img.addEventListener('click', () => {
                        openArtifactModal(att.id, att.type, att.name);
                    });
                    
                    container.appendChild(img);
                    attachmentsDiv.appendChild(container);
                } else {
                    const chip = document.createElement('button');
                    chip.className = 'attachment-chip';
                    chip.innerHTML = `📄 <span class="attachment-name">${escapeHTML(att.name)}</span>`;
                    chip.addEventListener('click', () => {
                        openArtifactModal(att.id, att.type || 'markdown', att.name);
                    });
                    attachmentsDiv.appendChild(chip);
                }
            });
            bubbleCol.appendChild(attachmentsDiv);
        }

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = msg.time;
        bubbleCol.appendChild(time);

        groupDiv.appendChild(bubbleCol);
        DOM.messagesList.appendChild(groupDiv);
    });
}

/**
 * Render Agents List in Settings
 */
function renderAgents() {
    DOM.agentsListContainer.innerHTML = '';

    state.agents.forEach((agent, index) => {
        const card = document.createElement('div');
        card.className = 'agent-item-card';

        const displayName = getAgentDisplayName(agent);

        const avatar = document.createElement('div');
        avatar.className = 'agent-avatar';
        avatar.style.backgroundColor = getAvatarColor(displayName, agent.type);
        avatar.textContent = displayName.charAt(0);

        const info = document.createElement('div');
        info.className = 'agent-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'agent-name-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'agent-name';
        nameSpan.textContent = displayName;

        nameRow.appendChild(nameSpan);

        if (agent.type !== 'external' && agent.model) {
            const modelSpan = document.createElement('span');
            modelSpan.className = 'agent-model';
            modelSpan.textContent = ` - ${agent.model}`;
            nameRow.appendChild(modelSpan);
        }

        const badge = document.createElement('span');
        badge.className = `badge ${agent.type !== 'external' ? 'badge-bundled' : 'badge-external'}`;
        badge.textContent = agent.type !== 'external' ? '同梱 ✓' : '外部 ✓';

        nameRow.appendChild(badge);

        const desc = document.createElement('span');
        desc.className = 'agent-description';
        desc.textContent = getAgentDetailText(agent);

        info.appendChild(nameRow);
        info.appendChild(desc);

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-button edit-agent-btn';
        editBtn.setAttribute('aria-label', `${displayName} を編集`);
        editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        `;
        editBtn.addEventListener('click', () => openAgentModal(index));

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-button delete-agent-btn';
        deleteBtn.style.color = 'var(--color-danger, #e53935)';
        deleteBtn.setAttribute('aria-label', `${displayName} を削除`);
        deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
        `;
        deleteBtn.addEventListener('click', () => openDeleteModal(index));

        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(editBtn);
        card.appendChild(deleteBtn);

        DOM.agentsListContainer.appendChild(card);
    });
}

// ==========================================================================
// Real-time Polling Logic (Version 6)
// ==========================================================================
let lastMessagesJSON = "";

async function refreshMessages() {
    const data = await API.get(API.endpoints.messages);
    if (!Array.isArray(data)) return;

    // Avoid layout flicker if message content hasn't changed
    const json = JSON.stringify(data);
    if (json === lastMessagesJSON) return;
    lastMessagesJSON = json;

    const list = DOM.messagesList;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;

    state.messages = data;
    renderMessages();

    if (atBottom) scrollToBottom();
}

function startPolling() {
    refreshMessages();                 // Instant first execution
    setInterval(refreshMessages, 2000); // 2 seconds polling loop
}

// ==========================================================================
// Handlers & Event Callback Logics
// ==========================================================================

/**
 * Handle sending a chat message
 */
async function handleSendMessage(e) {
    e.preventDefault();

    const content = DOM.chatInput.value.trim();
    if (!content) return;

    DOM.chatInput.value = '';
    DOM.chatInput.style.height = 'auto';
    hideMentionPopup();

    await API.post(API.endpoints.messages, { content });
    await refreshMessages();
    scrollToBottom();
}

/**
 * Handle deletion of agent on endpoint API and update list view
 */
async function handleDeleteAgent(agentId) {
    await API.delete(`./api/agents/${agentId}`);
    state.agents = state.agents.filter(a => a.id !== agentId);
    renderAgents();
    showToast("エージェントを削除しました");
}

// ==========================================================================
// Mention Popup Logic (Version 5)
// ==========================================================================

/**
 * Checks if suggestions popup should show based on text input before cursor
 */
function checkMentionSuggestions() {
    const textarea = DOM.chatInput;
    const selectionStart = textarea.selectionStart;
    const value = textarea.value;
    const textUpToCursor = value.slice(0, selectionStart);
    
    const lastAtIndex = textUpToCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
        const query = textUpToCursor.slice(lastAtIndex + 1);
        const isValidPrefix = lastAtIndex === 0 || /\s/.test(textUpToCursor.charAt(lastAtIndex - 1));
        const hasSpaceInQuery = /\s/.test(query);
        
        if (isValidPrefix && !hasSpaceInQuery) {
            filteredMentions = state.agents.filter(agent => {
                const displayName = getAgentDisplayName(agent).toLowerCase();
                return displayName.startsWith(query.toLowerCase());
            });
            
            if (filteredMentions.length > 0) {
                mentionActive = true;
                mentionStartIndex = lastAtIndex;
                mentionIndex = Math.min(mentionIndex, filteredMentions.length - 1);
                renderMentionPopup();
                return;
            }
        }
    }
    
    hideMentionPopup();
}

/**
 * Render suggestion cards lists inside mention popup
 */
function renderMentionPopup() {
    DOM.mentionPopup.innerHTML = '';
    
    filteredMentions.forEach((agent, index) => {
        const displayName = getAgentDisplayName(agent);
        
        const item = document.createElement('div');
        item.className = `mention-popup-item ${index === mentionIndex ? 'active' : ''}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.backgroundColor = getAvatarColor(displayName, agent.type);
        avatar.style.width = '24px';
        avatar.style.height = '24px';
        avatar.style.fontSize = '10px';
        avatar.textContent = displayName.charAt(0);
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'mention-name';
        nameSpan.textContent = displayName;
        
        item.appendChild(avatar);
        item.appendChild(nameSpan);
        
        item.addEventListener('click', () => {
            selectMention(agent);
        });
        
        DOM.mentionPopup.appendChild(item);
    });
    
    DOM.mentionPopup.classList.remove('hidden');
}

/**
 * Remove suggestions overlay from view
 */
function hideMentionPopup() {
    DOM.mentionPopup.classList.add('hidden');
    mentionActive = false;
    filteredMentions = [];
    mentionIndex = 0;
    mentionStartIndex = -1;
}

/**
 * Insert query selection back into textarea with trailing space
 */
function selectMention(agent) {
    const textarea = DOM.chatInput;
    const selectionStart = textarea.selectionStart;
    const value = textarea.value;
    
    const displayName = getAgentDisplayName(agent);
    
    const beforeMention = value.slice(0, mentionStartIndex);
    const afterMention = value.slice(selectionStart);
    
    textarea.value = beforeMention + '@' + displayName + ' ' + afterMention;
    
    const newCursorPos = mentionStartIndex + displayName.length + 2; // +2 for @ and trailing space
    textarea.selectionStart = newCursorPos;
    textarea.selectionEnd = newCursorPos;
    
    textarea.focus();
    hideMentionPopup();
    
    // Auto-adjust height trigger
    textarea.dispatchEvent(new Event('input'));
}

// ==========================================================================
// Modal Interactivity (Add/Edit Agent/User)
// ==========================================================================

/**
 * Toggle dynamic fields depending on agent type value
 */
function handleModalTypeChange() {
    const type = DOM.modalAgentType.value;
    if (type === 'external') {
        DOM.fieldsBundled.classList.add('hidden');
        DOM.fieldsExternal.classList.remove('hidden');
        
        // Auto-generate key if empty
        if (!DOM.modalAgentKey.value) {
            DOM.modalAgentKey.value = generateApiKey();
        }
    } else {
        DOM.fieldsExternal.classList.add('hidden');
        DOM.fieldsBundled.classList.remove('hidden');
    }
}

/**
 * Populate list options, disabling types that are already registered
 */
function updateModalTypeOptions(editingIndex = null) {
    const registeredTypes = state.agents
        .filter((_, idx) => idx !== editingIndex)
        .map(a => a.type);

    Array.from(DOM.modalAgentType.options).forEach(opt => {
        const type = opt.value;
        const originalText = typeNames[type];
        if (type !== 'external' && registeredTypes.includes(type)) {
            opt.disabled = true;
            opt.textContent = `${originalText} (登録済み)`;
        } else {
            opt.disabled = false;
            opt.textContent = originalText;
        }
    });
}

function openAgentModal(editIndex = null) {
    if (editIndex !== null) {
        // Edit Mode
        const agent = state.agents[editIndex];
        DOM.modalTitle.textContent = "エージェント / ユーザーを編集";
        DOM.modalAgentIndex.value = editIndex;
        DOM.modalAgentType.value = agent.type;
        
        updateModalTypeOptions(editIndex);
        
        // Populate inputs based on type
        if (agent.type === 'external') {
            DOM.modalAgentName.value = agent.name || "";
            DOM.modalAgentKey.value = agent.apiKey || "";
            DOM.modalAgentInterval.value = "";
            DOM.modalAgentStart.value = "10";
            DOM.modalAgentEnd.value = "22";
            DOM.modalAgentPrompt.value = "";
        } else {
            DOM.modalAgentName.value = "";
            DOM.modalAgentKey.value = "";
            DOM.modalAgentInterval.value = agent.interval || 60;
            DOM.modalAgentStart.value = agent.start !== undefined ? agent.start : 10;
            DOM.modalAgentEnd.value = agent.end !== undefined ? agent.end : 22;
            DOM.modalAgentPrompt.value = agent.prompt || "";
        }
    } else {
        // Add Mode
        DOM.modalTitle.textContent = "エージェント / ユーザーを追加";
        DOM.modalAgentIndex.value = "";
        
        updateModalTypeOptions(null);
        
        // Default selection: pick first enabled type option
        const firstEnabledOpt = Array.from(DOM.modalAgentType.options).find(opt => !opt.disabled);
        if (firstEnabledOpt) {
            DOM.modalAgentType.value = firstEnabledOpt.value;
        } else {
            DOM.modalAgentType.value = 'external';
        }
        
        // Clear all inputs
        DOM.modalAgentName.value = "";
        DOM.modalAgentKey.value = "";
        DOM.modalAgentInterval.value = "";
        DOM.modalAgentStart.value = "10";
        DOM.modalAgentEnd.value = "22";
        DOM.modalAgentPrompt.value = "";
    }
    
    handleModalTypeChange();
    DOM.agentModal.classList.add('show');
}

function closeAgentModal() {
    DOM.agentModal.classList.remove('show');
    DOM.agentForm.reset();
}

async function handleSaveAgent(e) {
    e.preventDefault();

    const indexVal = DOM.modalAgentIndex.value;
    const type = DOM.modalAgentType.value;
    
    let agentData = {};

    if (type === 'external') {
        const name = DOM.modalAgentName.value.trim();
        const apiKey = DOM.modalAgentKey.value.trim();
        if (!name || !apiKey) {
            showToast("表示名を入力してください");
            return;
        }
        
        // Retain ID if editing
        const id = indexVal !== "" ? state.agents[parseInt(indexVal)].id : 'ext-' + Date.now().toString(36);
        agentData = { id, type, name, apiKey };
    } else {
        const interval = parseInt(DOM.modalAgentInterval.value) || 60;
        const start = parseInt(DOM.modalAgentStart.value) || 0;
        const end = parseInt(DOM.modalAgentEnd.value) || 0;
        
        const clampedStart = Math.max(0, Math.min(23, start));
        const clampedEnd = Math.max(0, Math.min(23, end));
        const prompt = DOM.modalAgentPrompt.value.trim();
        const name = typeNames[type];
        
        // Retain ID if editing
        const id = indexVal !== "" ? state.agents[parseInt(indexVal)].id : type;
        
        agentData = { 
            id,
            type, 
            name, 
            interval, 
            start: clampedStart, 
            end: clampedEnd, 
            prompt 
        };
    }

    if (indexVal !== "") {
        // Update existing agent
        const idx = parseInt(indexVal);
        state.agents[idx] = agentData;
        showToast("エージェント情報を更新しました");
    } else {
        // Create new agent
        state.agents.push(agentData);
        showToast("エージェント / ユーザーを追加しました");
    }

    closeAgentModal();
    renderAgents();

    // Post config update to API
    const payload = {
        apiKey: state.apiKey,
        agents: state.agents
    };
    await API.post(API.endpoints.config, payload);
}

// ==========================================================================
// Delete Modal Controller
// ==========================================================================

function openDeleteModal(index) {
    const agent = state.agents[index];
    activeDeleteIndex = index;
    
    const displayName = getAgentDisplayName(agent);
    
    if (agent.type === 'external') {
        DOM.deleteModalTitle.textContent = "エージェントを削除しますか？";
        DOM.deleteModalDesc.textContent = `「${displayName}」を削除します。この操作は元に戻せません。`;
        DOM.deleteModalWarning.classList.add('hidden');
    } else {
        DOM.deleteModalTitle.textContent = "⚠️ エージェントを削除しますか？";
        DOM.deleteModalDesc.textContent = `「${displayName}」を削除します。`;
        DOM.deleteModalWarning.classList.remove('hidden');
    }
    
    DOM.deleteModal.classList.add('show');
}

function closeDeleteModal() {
    DOM.deleteModal.classList.remove('show');
    activeDeleteIndex = null;
}

// ==========================================================================
// Artifact Preview Modal Controller & Markdown Renderer
// ==========================================================================

async function openArtifactModal(artifactId, type = 'markdown', name = '') {
    DOM.artifactModalBody.innerHTML = '<div class="artifact-loading">読み込み中...</div>';
    DOM.artifactModal.classList.add('show');

    const titleEl = document.getElementById('artifact-modal-title');
    if (titleEl) {
        titleEl.textContent = name ? name : '成果物プレビュー';
    }

    if (type === 'image') {
        DOM.artifactModal.classList.add('image-mode');
        DOM.artifactModalBody.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'artifact-image-container';
        const img = document.createElement('img');
        img.className = 'artifact-image-large';
        img.src = `./api/artifacts/${artifactId}`;
        img.alt = name;
        img.onerror = () => {
            container.innerHTML = '<div class="artifact-error">画像を読み込めませんでした。</div>';
        };
        // 画像そのもの以外（余白/背景）をタップしたら閉じる。スマホで枠外タップで戻れるように。
        container.addEventListener('click', (e) => {
            if (e.target !== img) closeArtifactModal();
        });
        container.appendChild(img);
        DOM.artifactModalBody.appendChild(container);
        return;
    }

    try {
        const response = await fetch(`./api/artifacts/${artifactId}`);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        DOM.artifactModalBody.innerHTML = renderMarkdown(data.content || "");
    } catch (error) {
        console.error("Failed to load artifact:", error);
        DOM.artifactModalBody.innerHTML = '<div class="artifact-error">成果物の読み込みに失敗しました。</div>';
    }
}

function closeArtifactModal() {
    DOM.artifactModal.classList.remove('show');
    DOM.artifactModal.classList.remove('image-mode');
    DOM.artifactModalBody.innerHTML = '';
}

function renderMarkdown(content) {
    let html = escapeHTML(content);

    // 1. Escape/Protect code blocks
    const placeholders = [];
    let placeholderCounter = 0;

    // Multi-line code blocks
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
        const placeholder = `__CODEBLOCK_PLACEHOLDER_${placeholderCounter++}__`;
        placeholders.push({
            placeholder,
            html: `<pre class="artifact-code-block"><code class="language-${lang}">${code}</code></pre>`
        });
        return placeholder;
    });

    // Fallback for code blocks without newlines or simple backticks block
    html = html.replace(/```([a-zA-Z0-9_-]*)([\s\S]*?)```/g, (match, lang, code) => {
        const placeholder = `__CODEBLOCK_PLACEHOLDER_${placeholderCounter++}__`;
        placeholders.push({
            placeholder,
            html: `<pre class="artifact-code-block"><code class="language-${lang}">${code}</code></pre>`
        });
        return placeholder;
    });

    // 2. Escape/Protect inline code
    html = html.replace(/`([^`\n]+)`/g, (match, code) => {
        const placeholder = `__CODEBLOCK_PLACEHOLDER_${placeholderCounter++}__`;
        placeholders.push({
            placeholder,
            html: `<code class="artifact-inline-code">${code}</code>`
        });
        return placeholder;
    });

    // 3. Headings
    html = html.replace(/^###### (.*?)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.*?)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // 4. Lists
    // Unordered
    html = html.replace(/^(?:-|\*)\s+(.*?)$/gm, '<li-u>$1</li-u>');
    // Ordered
    html = html.replace(/^\d+\.\s+(.*?)$/gm, '<li-o>$1</li-o>');

    // Wrap continuous <ul> items
    html = html.replace(/((?:<li-u>.*?<\/li-u>[\s\r\n]*)+)/g, (match) => {
        return '<ul>' + match.replace(/<li-u>/g, '<li>').replace(/<\/li-u>/g, '</li>') + '</ul>';
    });

    // Wrap continuous <ol> items
    html = html.replace(/((?:<li-o>.*?<\/li-o>[\s\r\n]*)+)/g, (match) => {
        return '<ol>' + match.replace(/<li-o>/g, '<li>').replace(/<\/li-o>/g, '</li>') + '</ol>';
    });

    // 5. Bold text
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 6. Links — 安全なスキームのみ allowlist で許可。
    // javascript:/data:/file:/vbscript: 等の実行系スキームを遮断する
    // （成果物本文は Codex 生成物なので、悪意あるリンクが混ざる前提で防御する）。
    // url は冒頭の escapeHTML 済みなので属性インジェクションは起きないが、href の
    // スキーム自体を絞る。スキーム無し(相対/アンカー #...)は許可、付くなら http/https/mailto のみ。
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, url) => {
        const raw = url.trim();
        const lower = raw.toLowerCase();
        const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(lower);
        const safe = !hasScheme
            || lower.startsWith('http://')
            || lower.startsWith('https://')
            || lower.startsWith('mailto:');
        const cleanUrl = safe ? raw : '#';
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // 7. Clean up extra newlines near block elements
    html = html.replace(/\n*(<\/?(h[1-6]|ul|ol|li|pre)[^>]*>)\n*/g, '$1');

    // 8. Convert remaining newlines to breaks
    html = html.replace(/\n/g, '<br>');

    // 9. Restore placeholders
    placeholders.forEach(p => {
        html = html.replace(p.placeholder, p.html);
    });

    return html;
}
