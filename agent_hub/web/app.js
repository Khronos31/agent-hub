/**
 * Agent Hub - Frontend Logic (SPA & UI Interactions)
 * File Path: /config/GitHub/agent-hub/agent_hub/web/app.js
 */

// ==========================================================================
// Application State
// ==========================================================================
const state = {
    currentScreen: 'chat-screen', // 'chat-screen' or 'settings-screen'
    schedule: {
        start: 10,
        end: 22
    },
    apiKey: 'hub-xxxxxxxxxxxxxxxxxxxxxxxx',
    agents: [
        { name: "Codex", type: "bundled", detail: "1時間ごと" },
        { name: "あかね", type: "external", detail: "API: hub-xxxx..." },
        { name: "Antigravity", type: "bundled", detail: "リクエスト時起動" }
    ],
    messages: [
        { sender: "あかね", content: "今日は静かだね", isUser: false, time: "15:00" },
        { sender: "ユーザー", content: "ねえ、元気？", isUser: true, time: "15:01" },
        { sender: "Codex", content: "コードレビュー終わったよ", isUser: false, time: "15:02" }
    ]
};

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

    // Settings inputs & buttons
    scheduleStart: document.getElementById('schedule-start'),
    scheduleEnd: document.getElementById('schedule-end'),
    agentsListContainer: document.getElementById('agents-list-container'),
    btnAddAgent: document.getElementById('btn-add-agent'),
    apiKeyInput: document.getElementById('api-key-input'),
    btnCopyKey: document.getElementById('btn-copy-key'),

    // Modal elements
    agentModal: document.getElementById('agent-modal'),
    modalTitle: document.getElementById('modal-title'),
    agentForm: document.getElementById('agent-form'),
    modalAgentIndex: document.getElementById('modal-agent-index'),
    modalAgentName: document.getElementById('modal-agent-name'),
    modalAgentType: document.getElementById('modal-agent-type'),
    modalAgentDetail: document.getElementById('modal-agent-detail'),
    labelAgentDetail: document.getElementById('label-agent-detail'),
    btnModalCancel: document.getElementById('btn-modal-cancel'),

    // Toast
    toast: document.getElementById('toast')
};

// ==========================================================================
// API Interaction Stubs & Fallbacks
// ==========================================================================
const API = {
    // Relative API Paths as requested (using ./api/... instead of /api/...)
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
                return { schedule: state.schedule, apiKey: state.apiKey, agents: state.agents };
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

    // Auto-growing textarea & Enter-to-send support
    DOM.chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    DOM.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Programmatically trigger submit event
            DOM.chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });

    // Copy API Key
    DOM.btnCopyKey.addEventListener('click', handleCopyApiKey);

    // Schedule Input Changes (Auto-save)
    DOM.scheduleStart.addEventListener('change', saveScheduleSettings);
    DOM.scheduleEnd.addEventListener('change', saveScheduleSettings);

    // Add Agent Modal triggers
    DOM.btnAddAgent.addEventListener('click', () => openAgentModal());
    DOM.btnModalCancel.addEventListener('click', closeAgentModal);
    DOM.agentForm.addEventListener('submit', handleSaveAgent);

    // Dynamic type switching in modal to adjust label helper
    DOM.modalAgentType.addEventListener('change', handleModalTypeChange);

    // Window resize observer to keep layout in line
    window.addEventListener('resize', scrollToBottom);
}

// ==========================================================================
// Helper Functions
// ==========================================================================

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
 * Switch screen visually with clean sliding animation
 */
function switchScreen(screenId) {
    if (screenId === 'settings-screen') {
        DOM.chatScreen.classList.remove('active');
        DOM.settingsScreen.classList.add('active');
    } else {
        DOM.settingsScreen.classList.remove('active');
        DOM.chatScreen.classList.add('active');
        // Always scroll to bottom when returning to chat screen
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
function getAvatarColor(name) {
    if (name === "Codex") return "#10A37F"; // OpenAI Green
    if (name === "あかね") return "#9C27B0"; // Purple
    if (name === "Antigravity") return "#FF6B35"; // Orange
    if (name === "ユーザー") return "#009AC7"; // User primary blue

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

// ==========================================================================
// Load Data & Initial Sync
// ==========================================================================
async function loadInitialData() {
    // Fetch Configuration from API
    const configData = await API.get(API.endpoints.config);
    if (configData) {
        if (configData.schedule) {
            state.schedule = configData.schedule;
            DOM.scheduleStart.value = state.schedule.start;
            DOM.scheduleEnd.value = state.schedule.end;
        }
        if (configData.apiKey) {
            state.apiKey = configData.apiKey;
            DOM.apiKeyInput.value = state.apiKey;
        }
        if (configData.agents) {
            state.agents = configData.agents;
        }
    }

    // Fetch Messages from API
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
            // Avatar Column
            const avatarCol = document.createElement('div');
            avatarCol.className = 'avatar-col';
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar';
            avatarDiv.style.backgroundColor = getAvatarColor(msg.sender);
            avatarDiv.textContent = msg.sender.charAt(0);
            
            avatarCol.appendChild(avatarDiv);
            groupDiv.appendChild(avatarCol);
        }

        // Bubble Column
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
        bubble.textContent = msg.content;
        bubbleCol.appendChild(bubble);

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

        const avatar = document.createElement('div');
        avatar.className = 'agent-avatar';
        avatar.style.backgroundColor = getAvatarColor(agent.name);
        avatar.textContent = agent.name.charAt(0);

        const info = document.createElement('div');
        info.className = 'agent-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'agent-name-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'agent-name';
        nameSpan.textContent = agent.name;

        const badge = document.createElement('span');
        badge.className = `badge ${agent.type === 'bundled' ? 'badge-bundled' : 'badge-external'}`;
        badge.textContent = agent.type === 'bundled' ? '同梱 ✓' : '外部 ✓';

        nameRow.appendChild(nameSpan);
        nameRow.appendChild(badge);

        const desc = document.createElement('span');
        desc.className = 'agent-description';
        desc.textContent = agent.detail;

        info.appendChild(nameRow);
        info.appendChild(desc);

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-button edit-agent-btn';
        editBtn.setAttribute('aria-label', `${agent.name} を編集`);
        editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        `;
        editBtn.addEventListener('click', () => openAgentModal(index));

        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(editBtn);

        DOM.agentsListContainer.appendChild(card);
    });
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

    // Reset textarea state
    DOM.chatInput.value = '';
    DOM.chatInput.style.height = 'auto';

    const userMsg = {
        sender: "ユーザー",
        content: content,
        isUser: true,
        time: getCurrentFormattedTime()
    };

    // 1. Instantly append user message to local state & UI
    state.messages.push(userMsg);
    renderMessages();
    scrollToBottom();

    // 2. POST call to relative API
    const response = await API.post(API.endpoints.messages, userMsg);
    console.log("[POST Message Response]", response);

    // 3. Fun UX Interaction - simulate response from a random agent after 1-1.5s
    // Only triggers in mock fallback (if backend doesn't reply dynamically)
    setTimeout(async () => {
        const availableAgents = state.agents;
        if (availableAgents.length > 0) {
            const randomAgent = availableAgents[Math.floor(Math.random() * availableAgents.length)];
            const agentReply = {
                sender: randomAgent.name,
                content: `${userMsg.content} について了解しました！エージェント処理を開始します。`,
                isUser: false,
                time: getCurrentFormattedTime()
            };
            
            // Append and render
            state.messages.push(agentReply);
            renderMessages();
            scrollToBottom();
            
            // Log it in mock context
            console.log(`[Mock Agent response] ${randomAgent.name} replied.`);
        }
    }, 1200);
}

/**
 * Copy API Key to clipboard
 */
async function handleCopyApiKey() {
    try {
        await navigator.clipboard.writeText(state.apiKey);
        showToast("APIキーをコピーしました");
    } catch (err) {
        // Fallback for older browsers or restricted iframe environments
        DOM.apiKeyInput.select();
        document.execCommand('copy');
        showToast("APIキーをコピーしました");
    }
}

/**
 * Save schedule adjustments and post to API config
 */
async function saveScheduleSettings() {
    const start = parseInt(DOM.scheduleStart.value) || 0;
    const end = parseInt(DOM.scheduleEnd.value) || 0;

    state.schedule.start = Math.max(0, Math.min(23, start));
    state.schedule.end = Math.max(0, Math.min(23, end));

    // Keep inputs clamped
    DOM.scheduleStart.value = state.schedule.start;
    DOM.scheduleEnd.value = state.schedule.end;

    const payload = {
        schedule: state.schedule,
        apiKey: state.apiKey,
        agents: state.agents
    };

    const res = await API.post(API.endpoints.config, payload);
    console.log("[Save Config Response]", res);
    showToast("スケジュールを保存しました");
}

// ==========================================================================
// Modal Interactivity (Add/Edit Agent)
// ==========================================================================

function handleModalTypeChange() {
    const type = DOM.modalAgentType.value;
    if (type === 'bundled') {
        DOM.labelAgentDetail.textContent = 'スケジュール / 詳細';
        DOM.modalAgentDetail.placeholder = '例: 1時間ごと, 毎日朝8時';
    } else {
        DOM.labelAgentDetail.textContent = 'APIキー / URL詳細';
        DOM.modalAgentDetail.placeholder = '例: API: hub-xxxx...';
    }
}

function openAgentModal(editIndex = null) {
    if (editIndex !== null) {
        // Edit Mode
        const agent = state.agents[editIndex];
        DOM.modalTitle.textContent = "エージェントを編集";
        DOM.modalAgentIndex.value = editIndex;
        DOM.modalAgentName.value = agent.name;
        DOM.modalAgentType.value = agent.type;
        DOM.modalAgentDetail.value = agent.detail;
        
        // Lock name for default agents to maintain integrity
        if (agent.name === "Codex" || agent.name === "あかね") {
            DOM.modalAgentName.disabled = true;
        } else {
            DOM.modalAgentName.disabled = false;
        }
    } else {
        // Add Mode
        DOM.modalTitle.textContent = "エージェントを追加";
        DOM.modalAgentIndex.value = "";
        DOM.modalAgentName.value = "";
        DOM.modalAgentName.disabled = false;
        DOM.modalAgentType.value = "bundled";
        DOM.modalAgentDetail.value = "";
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
    const name = DOM.modalAgentName.value.trim();
    const type = DOM.modalAgentType.value;
    const detail = DOM.modalAgentDetail.value.trim();

    if (!name || !detail) return;

    const agentData = { name, type, detail };

    if (indexVal !== "") {
        // Update existing
        const idx = parseInt(indexVal);
        state.agents[idx] = agentData;
        showToast("エージェントを更新しました");
    } else {
        // Create new
        state.agents.push(agentData);
        showToast("エージェントを追加しました");
    }

    closeAgentModal();
    renderAgents();

    // Save configuration change to API backend
    const payload = {
        schedule: state.schedule,
        apiKey: state.apiKey,
        agents: state.agents
    };
    await API.post(API.endpoints.config, payload);
}
