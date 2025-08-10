// ==UserScript==
// @name         Stake Packs Manager
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Advanced betting manager and bet lookup for Stake Packs
// @author       You
// @match        https://stake.us/*
// @icon         https://stake.us/favicon.ico
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let userSettings = {
        // Notifications
        showBigWinNotification: true,
        bigWinThreshold: 100,

        // Auto-stop conditions
        autoStopEnabled: false,
        autoStopMultiplier: 10000,

        // Display settings
        showTopMultipliers: true,
        topMultipliersCount: 10
    };

    // Load saved settings immediately
    const saved = localStorage.getItem('pm_settings');
    if (saved) {
        try {
            userSettings = { ...userSettings, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    // Global tokens
    let accessToken = null;
    let lockdownToken = null;

    // Inject fetch interceptor
    console.log('[Packs Manager] Injecting fetch interceptor into page context...');
    const interceptorScript = document.createElement('script');
    interceptorScript.textContent = `
        (function() {
            console.log('[Packs Manager Injected] Installing fetch interceptor in page context...');
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const [url, options] = args;

                // Check if this is a Packs bet request
                if (url && url.toString().includes('packs/bet')) {
                    console.log('[Packs Manager Injected] PACKS BET DETECTED!');
                    console.log('[Packs Manager Injected] URL:', url);
                    console.log('[Packs Manager Injected] Options:', options);

                    if (options && options.headers && typeof options.headers === 'object') {
                        const headers = options.headers;
                        console.log('[Packs Manager Injected] Headers object:', headers);

                        // Extract tokens and send to userscript via custom event
                        let capturedData = {};

                        if (headers['x-access-token']) {
                            capturedData.accessToken = headers['x-access-token'];
                            console.log('[Packs Manager Injected] Access token captured!');
                            localStorage.setItem('pm_access_token', headers['x-access-token']);
                        }

                        if (headers['x-lockdown-token']) {
                            capturedData.lockdownToken = headers['x-lockdown-token'];
                            console.log('[Packs Manager Injected] Lockdown token captured!');
                            localStorage.setItem('pm_lockdown_token', headers['x-lockdown-token']);
                        }

                        // Send tokens to userscript via custom event
                        if (capturedData.accessToken && capturedData.lockdownToken) {
                            console.log('[Packs Manager Injected] Both tokens captured, sending to userscript...');
                            window.dispatchEvent(new CustomEvent('packsTokensCaptured', {
                                detail: capturedData
                            }));
                        }
                    }
                }

                // Call the original fetch
                return originalFetch.apply(this, args);
            };
        })();
    `;
    document.documentElement.appendChild(interceptorScript);
    interceptorScript.remove();

    // Listen for tokens from the injected script
    window.addEventListener('packsTokensCaptured', function(event) {
        console.log('[Packs Manager] Received tokens from page context!');
        const data = event.detail;

        if (data.accessToken) {
            accessToken = data.accessToken;
            console.log('[Packs Manager] Access token received:', accessToken);
        }

        if (data.lockdownToken) {
            lockdownToken = data.lockdownToken;
            console.log('[Packs Manager] Lockdown token received:', lockdownToken);
        }

        if (accessToken && lockdownToken) {
            console.log('[Packs Manager] ✅ BOTH TOKENS CAPTURED SUCCESSFULLY!');

            // Update UI if it exists
            if (window.updateTokenStatusGlobal) {
                window.updateTokenStatusGlobal();
            }
            if (window.showToastGlobal) {
                window.showToastGlobal('Tokens captured successfully! 🎉', 'success');
            }
        }
    });

    // ================== CONFIG ==================
    const CONFIG = {
        url: 'https://stake.us/_api/casino/packs/bet',
        graphqlUrl: 'https://stake.us/_api/graphql',
        referrer: 'https://stake.us/casino/games/packs',

        // Default betting settings
        currency: 'gold',
        amount: 1000,
        totalRequests: 1000000,
        timeoutMs: 12000,
        maxAttempts: 8,
        retryStatuses: new Set([429, 500, 502, 503, 504]),

        // UI settings
        updateInterval: 1000
    };

    // Save settings function
    function saveSettings() {
        localStorage.setItem('pm_settings', JSON.stringify(userSettings));
    }


    // Global state
    let isRunning = false;
    let betResults = [];
    let totalWagered = 0;
    let totalPayout = 0;
    let abortController = null;
    let sessionStartTime = null;
    let currentStreak = 0;
    let bestWinStreak = 0;
    let bestLossStreak = 0;

    // ================== STYLES ==================
    GM_addStyle(`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        #packs-manager {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 380px;
            max-height: 80vh;
            background: #0f212e;
            border: 1px solid #2f4553;
            border-radius: 8px;
            font-family: 'Inter', sans-serif;
            color: #b1bad3;
            z-index: 10000;
            display: none; /* Hidden by default, will show on Packs page */
            flex-direction: column;
        }

        #packs-manager.minimized {
            height: auto;
        }

        #packs-manager.minimized .pm-content {
            display: none;
        }

        #packs-manager.minimized .pm-header {
            border-radius: 8px;
        }

        .pm-header {
            background: #1a2c38;
            padding: 12px 16px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
        }

        .pm-title {
            font-size: 14px;
            font-weight: 600;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pm-controls {
            display: flex;
            gap: 8px;
        }

        .pm-btn-icon {
            width: 24px;
            height: 24px;
            background: #2f4553;
            border: none;
            border-radius: 4px;
            color: #b1bad3;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }

        .pm-btn-icon:hover {
            background: #3d5567;
            color: #ffffff;
        }

        .pm-content {
            padding: 16px;
            overflow-y: auto;
            flex: 1;
            position: relative;
        }

        /* Custom scrollbar for main content */
        .pm-content::-webkit-scrollbar {
            width: 8px;
        }

        .pm-content::-webkit-scrollbar-track {
            background: #0f212e;
            border-radius: 4px;
        }

        .pm-content::-webkit-scrollbar-thumb {
            background: linear-gradient(135deg, #2f4553, #3d5567);
            border-radius: 4px;
            border: 1px solid #1a2c38;
        }

        .pm-content::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(135deg, #3d5567, #4a6578);
        }

        .pm-section {
            margin-bottom: 16px;
            padding-bottom: 16px;
            border-bottom: 1px solid #2f4553;
        }

        .pm-section:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .pm-section-title {
            font-size: 12px;
            font-weight: 600;
            color: #94a3b8;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .pm-input-group {
            margin-bottom: 12px;
        }

        .pm-label {
            display: block;
            font-size: 12px;
            color: #94a3b8;
            margin-bottom: 6px;
        }

        /* Custom checkbox since Stake hides real checkboxes */
        .pm-checkbox {
            display: inline-block;
            width: 18px;
            height: 18px;
            background: #0f212e;
            border: 2px solid #2f4553;
            border-radius: 4px;
            margin-right: 8px;
            cursor: pointer;
            position: relative;
            flex-shrink: 0;
            transition: all 0.2s;
        }

        .pm-checkbox.checked {
            background: #00e701;
            border-color: #00e701;
        }

        .pm-checkbox.checked::after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #071824;
            font-weight: bold;
            font-size: 12px;
        }

        .pm-checkbox:hover {
            border-color: #00e701;
        }

        /* Hide the real checkboxes */
        .pm-checkbox-wrapper input[type="checkbox"] {
            display: none;
        }

        .pm-settings-group {
            background: #1a2c38;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 12px;
        }

        .pm-input {
            width: 100%;
            padding: 8px 12px;
            background: #0f212e;
            border: 1px solid #2f4553;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            transition: all 0.2s;
        }

        .pm-input:focus {
            outline: none;
            border-color: #00e701;
            box-shadow: 0 0 0 3px rgba(0, 231, 1, 0.1);
        }

        .pm-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .pm-btn {
            width: 100%;
            padding: 10px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .pm-btn-primary {
            background: #00e701;
            color: #071824;
        }

        .pm-btn-primary:hover:not(:disabled) {
            background: #00c901;
            transform: translateY(-1px);
        }

        .pm-btn-danger {
            background: #ed4163;
            color: #ffffff;
        }

        .pm-btn-danger:hover:not(:disabled) {
            background: #d63754;
            transform: translateY(-1px);
        }

        .pm-btn-secondary {
            background: #2f4553;
            color: #b1bad3;
        }

        .pm-btn-secondary:hover:not(:disabled) {
            background: #3d5567;
            color: #ffffff;
        }

        .pm-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }

        .pm-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        
        .pm-stats.six-stats {
            grid-template-columns: 1fr 1fr 1fr;
        }

        .pm-stat {
            background: #1a2c38;
            padding: 8px;
            border-radius: 4px;
        }

        .pm-stat-label {
            font-size: 10px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .pm-stat-value {
            font-size: 14px;
            font-weight: 600;
            color: #ffffff;
            margin-top: 4px;
        }

        .pm-stat-value.positive {
            color: #00e701;
        }

        .pm-stat-value.negative {
            color: #ed4163;
        }

        .pm-multipliers {
            max-height: 200px;
            overflow-y: auto;
            background: #1a2c38;
            border-radius: 4px;
            padding: 8px;
        }

        .pm-multiplier-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 8px;
            border-radius: 4px;
            margin-bottom: 4px;
            background: #0f212e;
            font-size: 12px;
            transition: all 0.2s;
            cursor: pointer;
            position: relative;
        }

        .pm-multiplier-item:hover {
            background: #213743;
            transform: translateX(2px);
        }

        .pm-multiplier-item:active {
            transform: translateX(0);
        }

        .pm-multiplier-item::after {
            content: '📋';
            position: absolute;
            right: 8px;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .pm-multiplier-item:hover::after {
            opacity: 0.5;
        }

        .pm-multiplier-rank {
            width: 24px;
            height: 24px;
            background: #2f4553;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            color: #ffffff;
        }

        .pm-multiplier-rank.gold {
            background: linear-gradient(135deg, #ffd700, #ffed4e);
            color: #071824;
        }

        .pm-multiplier-rank.silver {
            background: linear-gradient(135deg, #c0c0c0, #e8e8e8);
            color: #071824;
        }

        .pm-multiplier-rank.bronze {
            background: linear-gradient(135deg, #cd7f32, #e8a55d);
            color: #071824;
        }

        .pm-multiplier-value {
            font-weight: 600;
            color: #00e701;
        }

        .pm-multiplier-bet {
            color: #94a3b8;
        }

        .pm-lookup-result {
            background: #1a2c38;
            border-radius: 4px;
            padding: 12px;
            margin-top: 12px;
            font-size: 12px;
        }

        .pm-lookup-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
        }

        .pm-lookup-label {
            color: #94a3b8;
        }

        .pm-lookup-value {
            color: #ffffff;
            font-weight: 500;
        }

        .pm-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1a2c38;
            border: 1px solid #2f4553;
            border-radius: 4px;
            padding: 12px 16px;
            color: #ffffff;
            font-size: 14px;
            z-index: 10001;
            animation: slideIn 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pm-toast.success {
            border-color: #00e701;
            background: linear-gradient(135deg, #1a2c38, #0f3a0f);
        }

        .pm-toast.error {
            border-color: #ed4163;
            background: linear-gradient(135deg, #1a2c38, #3a0f0f);
        }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .pm-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #2f4553;
            border-top-color: #00e701;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .pm-flex {
            display: flex;
            gap: 8px;
        }

        .pm-flex > * {
            flex: 1;
        }

        /* Scrollbar styling */
        .pm-multipliers::-webkit-scrollbar {
            width: 6px;
        }

        .pm-multipliers::-webkit-scrollbar-track {
            background: #0f212e;
            border-radius: 3px;
        }

        .pm-multipliers::-webkit-scrollbar-thumb {
            background: #2f4553;
            border-radius: 3px;
        }

        .pm-multipliers::-webkit-scrollbar-thumb:hover {
            background: #3d5567;
        }
    `);

    // ================== UI CREATION ==================
    function createUI() {
        const container = document.createElement('div');
        container.id = 'packs-manager';
        container.innerHTML = `
            <div class="pm-header">
                <div class="pm-title">
                    <span>📦</span>
                    <span>Packs Manager</span>
                </div>
                <div class="pm-controls">
                    <button class="pm-btn-icon" id="pm-minimize">_</button>
                    <button class="pm-btn-icon" id="pm-close">✕</button>
                </div>
            </div>
            <div class="pm-content">
                <!-- Betting Controls -->
                <div class="pm-section">
                    <div class="pm-section-title">Betting Controls</div>
                    <div class="pm-flex">
                        <div class="pm-input-group">
                            <label class="pm-label">Amount (GC)</label>
                            <input type="number" class="pm-input" id="pm-amount" value="1000" min="1">
                        </div>
                        <div class="pm-input-group">
                            <label class="pm-label">Bets</label>
                            <input type="number" class="pm-input" id="pm-max-bets" value="1000000" min="1">
                        </div>
                    </div>
                    <div class="pm-input-group" id="pm-token-status" style="display: none;">
                        <!-- Token status will be dynamically inserted here -->
                    </div>
                    <button class="pm-btn pm-btn-secondary" id="pm-clear-tokens" style="display: none; margin-bottom: 12px;">
                        CLEAR TOKENS
                    </button>
                    <div id="pm-manual-tokens" style="display: none;">
                        <div class="pm-input-group">
                            <label class="pm-label">Access Token</label>
                            <input type="text" class="pm-input" id="pm-access-token" placeholder="Enter access token">
                        </div>
                        <div class="pm-input-group">
                            <label class="pm-label">Lockdown Token</label>
                            <input type="text" class="pm-input" id="pm-lockdown-token" placeholder="Enter lockdown token">
                        </div>
                    </div>
                    <button class="pm-btn pm-btn-primary" id="pm-start-stop">
                        START BETTING
                    </button>
                </div>

                <!-- Statistics -->
                <div class="pm-section">
                    <div class="pm-section-title">Statistics</div>
                    <div class="pm-stats six-stats">
                        <div class="pm-stat">
                            <div class="pm-stat-label">Total Bets</div>
                            <div class="pm-stat-value" id="pm-total-bets">0</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Wagered</div>
                            <div class="pm-stat-value" id="pm-total-wagered">0</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Win Rate</div>
                            <div class="pm-stat-value" id="pm-win-rate">0%</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">RTP</div>
                            <div class="pm-stat-value" id="pm-rtp">0%</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Net Profit</div>
                            <div class="pm-stat-value" id="pm-net-profit">0</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Time</div>
                            <div class="pm-stat-value" id="pm-time-elapsed">0:00</div>
                        </div>
                    </div>
                    <div class="pm-stats six-stats" style="margin-top: 8px;">
                        <div class="pm-stat">
                            <div class="pm-stat-label">Bets/Min</div>
                            <div class="pm-stat-value" id="pm-bets-per-min">0</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Best Streak</div>
                            <div class="pm-stat-value" id="pm-best-streak">W:0 L:0</div>
                        </div>
                        <div class="pm-stat">
                            <div class="pm-stat-label">Current</div>
                            <div class="pm-stat-value" id="pm-current-streak">0</div>
                        </div>
                    </div>
                </div>

                <!-- Top Multipliers -->
                <div class="pm-section" id="pm-top-multipliers-section" style="display: none;">
                    <div class="pm-section-title">Top Multipliers</div>
                    <div class="pm-multipliers" id="pm-multipliers-list">
                        <div style="text-align: center; color: #94a3b8; padding: 20px;">
                            No bets yet
                        </div>
                    </div>
                </div>

                <!-- Bet Lookup -->
                <div class="pm-section">
                    <div class="pm-section-title">Bet Lookup</div>
                    <div class="pm-input-group">
                        <input type="text" class="pm-input" id="pm-bet-id" placeholder="Enter Bet ID (UUID format)">
                    </div>
                    <button class="pm-btn pm-btn-secondary" id="pm-lookup">
                        LOOKUP BET
                    </button>
                    <div id="pm-lookup-result"></div>
                </div>

                <!-- Settings -->
                <div class="pm-section">
                    <div class="pm-section-title">Settings</div>

                    <!-- Unsaved changes warning -->
                    <div id="pm-unsaved-warning" style="display: none; padding: 8px; background: #3a2618; border: 1px solid #ed4163; border-radius: 4px; font-size: 12px; margin-bottom: 12px;">
                        <div style="color: #ed4163; font-weight: 600;">⚠️ Unsaved changes!</div>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">Click "Save Settings" to apply your changes</div>
                    </div>

                    <div class="pm-settings-group">
                        <!-- Big Win Notifications -->
                        <div style="margin-bottom: 12px;">
                            <div class="pm-checkbox-wrapper" style="display: flex; align-items: center; cursor: pointer; color: #b1bad3; font-size: 13px;" data-setting="bigwin">
                                <span class="pm-checkbox" id="pm-checkbox-bigwin"></span>
                                <input type="checkbox" id="pm-setting-bigwin" style="display: none;">
                                <span>Show big win notifications</span>
                            </div>
                            <input type="number" class="pm-input" id="pm-setting-bigwin-threshold"
                                   placeholder="Min multiplier (e.g., 100)" min="1" style="margin-top: 8px;">
                        </div>

                        <!-- Auto-stop -->
                        <div style="margin-bottom: 12px;">
                            <div class="pm-checkbox-wrapper" style="display: flex; align-items: center; cursor: pointer; color: #b1bad3; font-size: 13px;" data-setting="autostop">
                                <span class="pm-checkbox" id="pm-checkbox-autostop"></span>
                                <input type="checkbox" id="pm-setting-autostop" style="display: none;">
                                <span>Auto-stop on huge win</span>
                            </div>
                            <input type="number" class="pm-input" id="pm-setting-autostop-multi"
                                   placeholder="Stop at multiplier (e.g., 10000)" min="1" style="margin-top: 8px;">
                        </div>

                        <!-- Show Top Multipliers -->
                        <div>
                            <div class="pm-checkbox-wrapper" style="display: flex; align-items: center; cursor: pointer; color: #b1bad3; font-size: 13px;" data-setting="topmultipliers">
                                <span class="pm-checkbox" id="pm-checkbox-topmultipliers"></span>
                                <input type="checkbox" id="pm-setting-topmultipliers" style="display: none;">
                                <span>Show top multipliers</span>
                            </div>
                            <input type="number" class="pm-input" id="pm-setting-top-count"
                                   placeholder="Number to display (e.g., 10)" min="1" max="100" style="margin-top: 8px;">
                        </div>
                    </div>

                    <button class="pm-btn pm-btn-secondary" id="pm-save-settings">
                        SAVE SETTINGS
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        // Try to detect tokens automatically
        detectTokens();

        // Make draggable
        makeDraggable(container);

        // Attach event listeners
        attachEventListeners();

        // Load settings into UI
        loadSettingsToUI();

        // Start update loop
        setInterval(updateUI, CONFIG.updateInterval);
    }

    // Load settings into UI elements
    function loadSettingsToUI() {
        // Set hidden checkboxes
        document.getElementById('pm-setting-bigwin').checked = userSettings.showBigWinNotification;
        document.getElementById('pm-setting-bigwin-threshold').value = userSettings.bigWinThreshold;
        document.getElementById('pm-setting-autostop').checked = userSettings.autoStopEnabled;
        document.getElementById('pm-setting-autostop-multi').value = userSettings.autoStopMultiplier;
        document.getElementById('pm-setting-topmultipliers').checked = userSettings.showTopMultipliers;
        document.getElementById('pm-setting-top-count').value = userSettings.topMultipliersCount;

        // Update custom checkbox visuals
        updateCheckboxVisual('bigwin', userSettings.showBigWinNotification);
        updateCheckboxVisual('autostop', userSettings.autoStopEnabled);
        updateCheckboxVisual('topmultipliers', userSettings.showTopMultipliers);

        // Show/hide top multipliers section based on setting
        const topSection = document.getElementById('pm-top-multipliers-section');
        if (topSection) {
            topSection.style.display = userSettings.showTopMultipliers ? 'block' : 'none';
        }

        // Set initial disabled state for threshold inputs
        const thresholdInput = document.getElementById('pm-setting-bigwin-threshold');
        if (thresholdInput) {
            thresholdInput.disabled = !userSettings.showBigWinNotification;
            thresholdInput.style.opacity = userSettings.showBigWinNotification ? '1' : '0.5';
        }

        const multiInput = document.getElementById('pm-setting-autostop-multi');
        if (multiInput) {
            multiInput.disabled = !userSettings.autoStopEnabled;
            multiInput.style.opacity = userSettings.autoStopEnabled ? '1' : '0.5';
        }

        const topCountInput = document.getElementById('pm-setting-top-count');
        if (topCountInput) {
            topCountInput.disabled = !userSettings.showTopMultipliers;
            topCountInput.style.opacity = userSettings.showTopMultipliers ? '1' : '0.5';
        }
    }

    // Update custom checkbox visual state
    function updateCheckboxVisual(name, checked) {
        const checkbox = document.getElementById(`pm-checkbox-${name}`);
        if (checkbox) {
            if (checked) {
                checkbox.classList.add('checked');
            } else {
                checkbox.classList.remove('checked');
            }
        }
    }

    // ================== TOKEN DETECTION ==================
    function detectTokens() {
        console.log('[Packs Manager] Checking for tokens...');

        // First check for saved tokens
        const savedAccessToken = localStorage.getItem('pm_access_token');
        const savedLockdownToken = localStorage.getItem('pm_lockdown_token');

        if (savedAccessToken && savedLockdownToken) {
            accessToken = savedAccessToken;
            lockdownToken = savedLockdownToken;
            console.log('[Packs Manager] Found previously saved tokens');
            updateTokenStatus();
            return;
        }

        // Check if tokens were already captured by the interceptor
        if (accessToken && lockdownToken) {
            console.log('[Packs Manager] Tokens already captured by interceptor');
            updateTokenStatus();
            return;
        }

        // Show instruction if no tokens yet
        console.log('[Packs Manager] No tokens found, showing instructions...');
        document.getElementById('pm-token-status').style.display = 'block';
        document.getElementById('pm-clear-tokens').style.display = 'none';
        document.getElementById('pm-token-status').innerHTML = `
            <div style="padding: 8px; background: #1a2c38; border-radius: 4px; font-size: 12px;">
                <div style="color: #ffd700; margin-bottom: 4px;">⚠️ Tokens needed</div>
                <div style="color: #94a3b8; font-size: 11px;">Please place a bet on Packs to auto-detect tokens</div>
            </div>
        `;

        // If still no tokens after a delay, show manual input option
        setTimeout(() => {
            if (!accessToken || !lockdownToken) {
                console.log('[Packs Manager] No tokens captured yet, showing manual input option');
                document.getElementById('pm-manual-tokens').style.display = 'block';
            }
        }, 5000);
    }

    // Make these functions global so the interceptor can call them
    window.updateTokenStatusGlobal = function() {
        if (document.getElementById('pm-token-status')) {
            updateTokenStatus();
        }
    };

    window.showToastGlobal = function(message, type) {
        if (typeof showToast === 'function') {
            showToast(message, type);
        }
    };

    function updateTokenStatus() {
        document.getElementById('pm-token-status').style.display = 'block';
        document.getElementById('pm-manual-tokens').style.display = 'none';
        document.getElementById('pm-clear-tokens').style.display = 'block';

        // Update the status message
        document.getElementById('pm-token-status').innerHTML = `
            <div style="padding: 8px; background: #1a2c38; border-radius: 4px; font-size: 12px;">
                <div style="color: #00e701; margin-bottom: 4px;">✓ Tokens detected automatically</div>
                <div style="color: #94a3b8; font-size: 11px;">Access: ${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 4)}</div>
            </div>
        `;

        // Save tokens for future use
        if (accessToken) localStorage.setItem('pm_access_token', accessToken);
        if (lockdownToken) localStorage.setItem('pm_lockdown_token', lockdownToken);
    }

    // ================== DRAGGABLE ==================
    function makeDraggable(element) {
        const header = element.querySelector('.pm-header');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
        let rafId = null;

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            if (e.target.classList.contains('pm-btn-icon')) return;

            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
            element.style.transition = 'none'; // Disable transitions during drag
            header.style.cursor = 'grabbing';
        }

        function drag(e) {
            if (!isDragging) return;

            e.preventDefault();

            // Cancel previous frame
            if (rafId) cancelAnimationFrame(rafId);

            // Use requestAnimationFrame for smooth performance
            rafId = requestAnimationFrame(() => {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;

                // Use transform3d for hardware acceleration
                element.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            });
        }

        function dragEnd() {
            if (rafId) cancelAnimationFrame(rafId);
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
            element.style.transition = ''; // Re-enable transitions
            header.style.cursor = 'move';
        }
    }

    // ================== EVENT LISTENERS ==================
    function attachEventListeners() {
        // Minimize/Maximize
        document.getElementById('pm-minimize').addEventListener('click', () => {
            const container = document.getElementById('packs-manager');
            container.classList.toggle('minimized');
        });

        // Close
        document.getElementById('pm-close').addEventListener('click', () => {
            if (isRunning) {
                if (!confirm('Betting is still running. Are you sure you want to close?')) return;
                stopBetting();
            }
            document.getElementById('packs-manager').remove();
        });

        // Start/Stop Betting
        document.getElementById('pm-start-stop').addEventListener('click', () => {
            if (isRunning) {
                stopBetting();
            } else {
                startBetting();
            }
        });

        // Bet Lookup
        document.getElementById('pm-lookup').addEventListener('click', lookupBet);
        document.getElementById('pm-bet-id').addEventListener('keypress', (evt) => {
            if (evt.key === 'Enter') lookupBet();
        });

        // Clear Tokens
        document.getElementById('pm-clear-tokens').addEventListener('click', () => {
            clearTokens();
            showToast('Tokens cleared. Please place a bet to re-capture tokens.', 'success');
        });

        // Custom checkbox click handlers
        document.querySelectorAll('.pm-checkbox-wrapper').forEach(wrapper => {
            wrapper.addEventListener('click', function() {
                const settingName = this.getAttribute('data-setting');
                const checkbox = document.getElementById(`pm-checkbox-${settingName}`);
                const hiddenInput = this.querySelector('input[type="checkbox"]');

                if (hiddenInput && checkbox) {
                    // Toggle the hidden checkbox
                    hiddenInput.checked = !hiddenInput.checked;

                    // Update visual state
                    updateCheckboxVisual(settingName, hiddenInput.checked);

                    // Enable/disable related inputs based on checkbox state
                    if (settingName === 'bigwin') {
                        const thresholdInput = document.getElementById('pm-setting-bigwin-threshold');
                        if (thresholdInput) {
                            thresholdInput.disabled = !hiddenInput.checked;
                            thresholdInput.style.opacity = hiddenInput.checked ? '1' : '0.5';
                        }
                    } else if (settingName === 'autostop') {
                        const multiInput = document.getElementById('pm-setting-autostop-multi');
                        if (multiInput) {
                            multiInput.disabled = !hiddenInput.checked;
                            multiInput.style.opacity = hiddenInput.checked ? '1' : '0.5';
                        }
                    } else if (settingName === 'topmultipliers') {
                        const topCountInput = document.getElementById('pm-setting-top-count');
                        if (topCountInput) {
                            topCountInput.disabled = !hiddenInput.checked;
                            topCountInput.style.opacity = hiddenInput.checked ? '1' : '0.5';
                        }
                        // Don't show/hide immediately - wait for save
                    }

                    // Show unsaved changes warning
                    showUnsavedWarning();
                }
            });
        });

        // Track changes in number inputs
        const settingInputs = [
            'pm-setting-bigwin-threshold',
            'pm-setting-autostop-multi',
            'pm-setting-top-count'
        ];

        settingInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', () => {
                    showUnsavedWarning();
                });
            }
        });

        // Settings
        document.getElementById('pm-save-settings').addEventListener('click', () => {
            userSettings.showBigWinNotification = document.getElementById('pm-setting-bigwin').checked;
            userSettings.bigWinThreshold = parseInt(document.getElementById('pm-setting-bigwin-threshold').value) || 100;
            userSettings.autoStopEnabled = document.getElementById('pm-setting-autostop').checked;
            userSettings.autoStopMultiplier = parseInt(document.getElementById('pm-setting-autostop-multi').value) || 10000;
            userSettings.showTopMultipliers = document.getElementById('pm-setting-topmultipliers').checked;
            userSettings.topMultipliersCount = parseInt(document.getElementById('pm-setting-top-count').value) || 10;

            saveSettings();
            showToast('Settings saved!', 'success');

            // Hide unsaved changes warning
            hideUnsavedWarning();

            // Show/hide top multipliers section based on new setting
            const topSection = document.getElementById('pm-top-multipliers-section');
            if (topSection) {
                topSection.style.display = userSettings.showTopMultipliers ? 'block' : 'none';
            }

            // Update UI to reflect changes
            updateUI();
        });

        // Save tokens on change (only if manual input is visible)
        const accessTokenInput = document.getElementById('pm-access-token');
        const lockdownTokenInput = document.getElementById('pm-lockdown-token');

        if (accessTokenInput) {
            accessTokenInput.addEventListener('change', (e) => {
                accessToken = e.target.value;
                localStorage.setItem('pm_access_token', e.target.value);
            });
        }

        if (lockdownTokenInput) {
            lockdownTokenInput.addEventListener('change', (e) => {
                lockdownToken = e.target.value;
                localStorage.setItem('pm_lockdown_token', e.target.value);
            });
        }
    }

    // ================== BETTING FUNCTIONS ==================
    function randomId(bytes = 16) {
        const arr = new Uint8Array(bytes);
        crypto.getRandomValues(arr);
        let bin = '';
        for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function looksLikeThrottle(json) {
        if (!json || !Array.isArray(json.errors)) return false;
        return json.errors.some(e => {
            const msg = (e && e.message) || '';
            const type = (e && e.errorType) || '';
            return /please\s+slow\s+down/i.test(msg) || type === 'parallelCasinoBet';
        });
    }

    async function sendBet(payload, accessToken, lockdownToken, attempt = 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort('timeout'), CONFIG.timeoutMs);

        try {
            const res = await fetch(CONFIG.url, {
                method: 'POST',
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/json',
                    'cache-control': 'no-cache',
                    'pragma': 'no-cache',
                    'x-access-token': accessToken,
                    'x-lockdown-token': lockdownToken
                },
                referrer: CONFIG.referrer,
                body: JSON.stringify(payload),
                mode: 'cors',
                credentials: 'include',
                cache: 'no-cache',
                signal: controller.signal
            });

            const raw = await res.text().catch(() => '');
            let json = null;
            try { json = raw ? JSON.parse(raw) : null; } catch {}

            let ok = res.ok;
            let retryable = CONFIG.retryStatuses.has(res.status);

            if (ok && looksLikeThrottle(json)) {
                ok = false;
                retryable = true;
            }

            if (!ok) {
                // Check if it's an error that shouldn't be retried
                if (json && json.errors) {
                    const insufficientBalance = json.errors.some(err => 
                        err.errorType === 'insufficientBalance' || 
                        err.message.toLowerCase().includes('not have enough balance')
                    );
                    
                    const invalidToken = json.errors.some(err => 
                        err.errorType === 'unauthenticated' || 
                        err.errorType === 'unauthorized' ||
                        err.message.toLowerCase().includes('token') ||
                        err.message.toLowerCase().includes('unauthorized') ||
                        err.message.toLowerCase().includes('unauthenticated')
                    );
                    
                    if (insufficientBalance || invalidToken) {
                        // Don't retry on these errors
                        return { ok: false, status: res.status, text: raw, json };
                    }
                }
                
                if (retryable && attempt < CONFIG.maxAttempts) {
                    const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                    const jitter = Math.floor(Math.random() * 400);
                    await new Promise(r => setTimeout(r, backoff + jitter));
                    return sendBet(payload, accessToken, lockdownToken, attempt + 1);
                }
                throw new Error(`HTTP ${res.status}: ${raw.slice(0, 400)}`);
            }

            return { ok: true, status: res.status, text: raw, json };

        } catch (err) {
            if (attempt < CONFIG.maxAttempts) {
                const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                await new Promise(r => setTimeout(r, backoff));
                return sendBet(payload, accessToken, lockdownToken, attempt + 1);
            }
            return { ok: false, error: String(err) };
        } finally {
            clearTimeout(timer);
        }
    }

    async function startBetting() {
        // Use global tokens if available, otherwise try to get from manual input
        if (!accessToken || !lockdownToken) {
            const accessTokenInput = document.getElementById('pm-access-token');
            const lockdownTokenInput = document.getElementById('pm-lockdown-token');

            if (accessTokenInput && lockdownTokenInput) {
                accessToken = accessTokenInput.value;
                lockdownToken = lockdownTokenInput.value;
            }
        }

        const amount = parseInt(document.getElementById('pm-amount').value);
        const maxBets = parseInt(document.getElementById('pm-max-bets').value);

        if (!accessToken || !lockdownToken) {
            showToast('Tokens not detected. Please navigate to a Stake page or enter tokens manually', 'error');
            // Show manual input fields
            document.getElementById('pm-manual-tokens').style.display = 'block';
            document.getElementById('pm-token-status').style.display = 'none';
            document.getElementById('pm-clear-tokens').style.display = 'none';
            return;
        }

        isRunning = true;
        betResults = [];
        totalWagered = 0;
        totalPayout = 0;
        abortController = new AbortController();
        sessionStartTime = Date.now();
        currentStreak = 0;
        bestWinStreak = 0;
        bestLossStreak = 0;

        // Update UI
        const btn = document.getElementById('pm-start-stop');
        btn.textContent = 'STOP BETTING';
        btn.classList.remove('pm-btn-primary');
        btn.classList.add('pm-btn-danger');

        // Disable inputs
        document.getElementById('pm-amount').disabled = true;
        document.getElementById('pm-max-bets').disabled = true;

        // Only disable token inputs if they exist (manual mode)
        const accessTokenInput = document.getElementById('pm-access-token');
        const lockdownTokenInput = document.getElementById('pm-lockdown-token');
        if (accessTokenInput) accessTokenInput.disabled = true;
        if (lockdownTokenInput) lockdownTokenInput.disabled = true;

        // Start betting loop
        for (let i = 0; i < maxBets && isRunning; i++) {
            const payload = {
                currency: CONFIG.currency,
                amount: amount,
                identifier: randomId()
            };

            const result = await sendBet(payload, accessToken, lockdownToken);

            if (!isRunning) break;
            
            // Check for errors
            if (result.json && result.json.errors) {
                const insufficientBalance = result.json.errors.some(err => 
                    err.errorType === 'insufficientBalance' || 
                    err.message.toLowerCase().includes('not have enough balance')
                );
                
                const invalidToken = result.json.errors.some(err => 
                    err.errorType === 'unauthenticated' || 
                    err.errorType === 'unauthorized' ||
                    err.message.toLowerCase().includes('token') ||
                    err.message.toLowerCase().includes('unauthorized') ||
                    err.message.toLowerCase().includes('unauthenticated')
                );
                
                if (insufficientBalance) {
                    showToast('❌ Insufficient balance - stopping bets', 'error');
                    stopBetting();
                    break;
                }
                
                if (invalidToken) {
                    showToast('🔐 Invalid or expired tokens - please clear and re-capture', 'error');
                    stopBetting();
                    // Optionally clear tokens
                    setTimeout(() => {
                        if (confirm('Tokens appear to be invalid. Clear them now?')) {
                            clearTokens();
                        }
                    }, 500);
                    break;
                }
            }

            if (result.ok && result.json && result.json.packsBet) {
                const bet = result.json.packsBet;

                const betData = {
                    index: i + 1,
                    id: bet.id,
                    amount: bet.amount,
                    payout: bet.payout,
                    payoutMultiplier: bet.payoutMultiplier,
                    currency: bet.currency,
                    timestamp: new Date().toISOString()
                };

                betResults.push(betData);
                totalWagered += bet.amount;
                totalPayout += bet.payout;
                
                // Update streak tracking
                if (bet.payoutMultiplier > 1) {
                    // Win
                    if (currentStreak >= 0) {
                        currentStreak++;
                        if (currentStreak > bestWinStreak) bestWinStreak = currentStreak;
                    } else {
                        currentStreak = 1;
                    }
                } else {
                    // Loss
                    if (currentStreak <= 0) {
                        currentStreak--;
                        if (Math.abs(currentStreak) > bestLossStreak) bestLossStreak = Math.abs(currentStreak);
                    } else {
                        currentStreak = -1;
                    }
                }

                // Check for big wins based on user settings
                if (userSettings.showBigWinNotification && bet.payoutMultiplier >= userSettings.bigWinThreshold) {
                    showToast(`🎯 BIG WIN! ${bet.payoutMultiplier}x multiplier!`, 'success');
                }

                // Check for auto-stop condition
                if (userSettings.autoStopEnabled && bet.payoutMultiplier >= userSettings.autoStopMultiplier) {
                    showToast(`🛑 AUTO-STOP: Hit ${bet.payoutMultiplier}x multiplier!`, 'success');
                    stopBetting();
                    break;
                }
            }
        }

        if (isRunning) {
            stopBetting();
            showToast('Betting session completed!', 'success');
        }
    }

    function stopBetting() {
        isRunning = false;
        if (abortController) abortController.abort();

        // Update UI
        const btn = document.getElementById('pm-start-stop');
        btn.textContent = 'START BETTING';
        btn.classList.remove('pm-btn-danger');
        btn.classList.add('pm-btn-primary');

        // Enable inputs
        document.getElementById('pm-amount').disabled = false;
        document.getElementById('pm-max-bets').disabled = false;

        // Only enable token inputs if they exist (manual mode)
        const accessTokenInput = document.getElementById('pm-access-token');
        const lockdownTokenInput = document.getElementById('pm-lockdown-token');
        if (accessTokenInput) accessTokenInput.disabled = false;
        if (lockdownTokenInput) lockdownTokenInput.disabled = false;
    }

    // ================== BET LOOKUP ==================
    async function lookupBet() {
        const betId = document.getElementById('pm-bet-id').value.trim();

        if (!betId) {
            showToast('Please enter a bet ID', 'error');
            return;
        }

        // Use global token if available, otherwise try to get from manual input
        let lookupToken = accessToken;
        if (!lookupToken) {
            const accessTokenInput = document.getElementById('pm-access-token');
            if (accessTokenInput) {
                lookupToken = accessTokenInput.value;
            }
        }

        if (!lookupToken) {
            showToast('Token not detected. Please navigate to a Stake page or enter token manually', 'error');
            // Show manual input fields
            document.getElementById('pm-manual-tokens').style.display = 'block';
            document.getElementById('pm-token-status').style.display = 'none';
            document.getElementById('pm-clear-tokens').style.display = 'none';
            return;
        }

        const resultDiv = document.getElementById('pm-lookup-result');
        resultDiv.innerHTML = '<div class="pm-spinner"></div>';

        const query = `query BetLookup($betId: String) {
            bet(betId: $betId) {
                id
                iid
                type
                scope
                game {
                    name
                    slug
                }
                bet {
                    ... on CasinoBet {
                        id
                        active
                        payoutMultiplier
                        amount
                        payout
                        updatedAt
                        currency
                        game
                        user {
                            name
                        }
                    }
                }
            }
        }`;

        try {
            const response = await fetch(CONFIG.graphqlUrl, {
                method: 'POST',
                headers: {
                    'accept': 'application/graphql+json, application/json',
                    'content-type': 'application/json',
                    'x-access-token': lookupToken,
                    'x-language': 'en'
                },
                body: JSON.stringify({
                    query: query,
                    operationName: 'BetLookup',
                    variables: { betId: betId }
                }),
                credentials: 'include'
            });

            const data = await response.json();

            if (data.errors) {
                throw new Error(data.errors[0].message);
            }

            if (!data.data || !data.data.bet) {
                throw new Error('Bet not found');
            }

            const bet = data.data.bet;
            const casinoBet = bet.bet;

            // Copy IID to clipboard
            if (bet.iid) {
                GM_setClipboard(bet.iid);
                showToast(`✓ IID copied: ${bet.iid}`, 'success');
            }

            // Display result
            resultDiv.innerHTML = `
                <div class="pm-lookup-result">
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">IID:</span>
                        <span class="pm-lookup-value">${bet.iid || 'N/A'}</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">Game:</span>
                        <span class="pm-lookup-value">${bet.game.name}</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">User:</span>
                        <span class="pm-lookup-value">${casinoBet.user.name}</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">Amount:</span>
                        <span class="pm-lookup-value">${casinoBet.amount} ${casinoBet.currency}</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">Payout:</span>
                        <span class="pm-lookup-value">${casinoBet.payout} ${casinoBet.currency}</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">Multiplier:</span>
                        <span class="pm-lookup-value" style="color: #00e701;">${casinoBet.payoutMultiplier}x</span>
                    </div>
                    <div class="pm-lookup-row">
                        <span class="pm-lookup-label">Status:</span>
                        <span class="pm-lookup-value">${casinoBet.active ? 'Active' : 'Settled'}</span>
                    </div>
                </div>
            `;

        } catch (error) {
            resultDiv.innerHTML = `<div style="color: #ed4163; font-size: 12px;">Error: ${error.message}</div>`;
            showToast('Failed to lookup bet', 'error');
        }
    }

    // ================== UI UPDATES ==================
    function updateUI() {
        if (betResults.length === 0) return;

        // Update statistics
        document.getElementById('pm-total-bets').textContent = betResults.length;
        document.getElementById('pm-total-wagered').textContent = totalWagered.toLocaleString();
        
        // Calculate and display RTP (Return to Player)
        const rtp = totalWagered > 0 ? ((totalPayout / totalWagered) * 100).toFixed(2) : 0;
        const rtpElement = document.getElementById('pm-rtp');
        rtpElement.textContent = rtp + '%';
        // Color code RTP - green if above 100%, red if below
        rtpElement.className = parseFloat(rtp) >= 100 ? 'pm-stat-value positive' : 'pm-stat-value negative';

        const profit = totalPayout - totalWagered;
        const profitElement = document.getElementById('pm-net-profit');
        profitElement.textContent = (profit >= 0 ? '+' : '') + profit.toLocaleString();
        profitElement.className = profit >= 0 ? 'pm-stat-value positive' : 'pm-stat-value negative';

        const winRate = (betResults.filter(b => b.payoutMultiplier > 1).length / betResults.length * 100).toFixed(1);
        document.getElementById('pm-win-rate').textContent = winRate + '%';
        
        // Update time elapsed
        if (sessionStartTime) {
            const elapsed = Date.now() - sessionStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            document.getElementById('pm-time-elapsed').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Calculate bets per minute
            const minutesElapsed = elapsed / 60000;
            const betsPerMin = minutesElapsed > 0 ? (betResults.length / minutesElapsed).toFixed(1) : 0;
            document.getElementById('pm-bets-per-min').textContent = betsPerMin;
        }
        
        // Update streak displays
        document.getElementById('pm-best-streak').textContent = `W:${bestWinStreak} L:${bestLossStreak}`;
        
        const currentStreakElement = document.getElementById('pm-current-streak');
        if (currentStreak > 0) {
            currentStreakElement.textContent = `W${currentStreak}`;
            currentStreakElement.className = 'pm-stat-value positive';
        } else if (currentStreak < 0) {
            currentStreakElement.textContent = `L${Math.abs(currentStreak)}`;
            currentStreakElement.className = 'pm-stat-value negative';
        } else {
            currentStreakElement.textContent = '0';
            currentStreakElement.className = 'pm-stat-value';
        }

        // Update top multipliers (if enabled)
        if (userSettings.showTopMultipliers) {
            const sorted = [...betResults].sort((a, b) => b.payoutMultiplier - a.payoutMultiplier);
            const top = sorted.slice(0, userSettings.topMultipliersCount);

            const multipliersList = document.getElementById('pm-multipliers-list');
            if (multipliersList) {
                multipliersList.innerHTML = top.map((bet, idx) => {
            let rankClass = '';
            if (idx === 0) rankClass = 'gold';
            else if (idx === 1) rankClass = 'silver';
            else if (idx === 2) rankClass = 'bronze';

            return `
                <div class="pm-multiplier-item" data-bet-id="${bet.id}" title="Click to copy bet ID">
                    <div class="pm-multiplier-rank ${rankClass}">${idx + 1}</div>
                    <div class="pm-multiplier-value">${bet.payoutMultiplier.toFixed(2)}x</div>
                    <div class="pm-multiplier-bet">Bet #${bet.index}</div>
                </div>
                `;
                }).join('');

                // Add click handlers to multiplier items
                document.querySelectorAll('.pm-multiplier-item').forEach(item => {
                    item.addEventListener('click', function() {
                        const betId = this.getAttribute('data-bet-id');
                        if (betId) {
                            // Put it in the bet lookup input
                            document.getElementById('pm-bet-id').value = betId;

                            // Visual feedback
                            const originalBg = this.style.background;
                            this.style.background = 'linear-gradient(135deg, #1a2c38, #0f3a0f)';

                            showToast(`Bet ID ready for lookup: ${betId.substring(0, 8)}...`, 'success');

                            setTimeout(() => {
                                this.style.background = originalBg;
                            }, 300);
                        }
                    });
                });
            }
        }
    }

    // ================== TOAST NOTIFICATIONS ==================
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `pm-toast ${type}`;
        toast.innerHTML = `
            ${type === 'success' ? '✓' : '✕'}
            <span>${message}</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ================== HELPER FUNCTIONS ==================
    function clearTokens() {
        accessToken = null;
        lockdownToken = null;
        localStorage.removeItem('pm_access_token');
        localStorage.removeItem('pm_lockdown_token');

        // Hide token status and clear button, show instructions
        document.getElementById('pm-token-status').style.display = 'block';
        document.getElementById('pm-clear-tokens').style.display = 'none';
        document.getElementById('pm-token-status').innerHTML = `
            <div style="padding: 8px; background: #1a2c38; border-radius: 4px; font-size: 12px;">
                <div style="color: #ffd700; margin-bottom: 4px;">⚠️ Tokens needed</div>
                <div style="color: #94a3b8; font-size: 11px;">Please place a bet on Packs to auto-detect tokens</div>
            </div>
        `;

        // Show manual input option after a delay
        setTimeout(() => {
            if (!accessToken || !lockdownToken) {
                document.getElementById('pm-manual-tokens').style.display = 'block';
            }
        }, 3000);
    }

    function showUnsavedWarning() {
        const warning = document.getElementById('pm-unsaved-warning');
        if (warning) {
            warning.style.display = 'block';
        }
    }

    function hideUnsavedWarning() {
        const warning = document.getElementById('pm-unsaved-warning');
        if (warning) {
            warning.style.display = 'none';
        }
    }

    // ================== URL MONITORING ==================
    function isPacksPage() {
        return window.location.pathname.includes('/casino/games/packs');
    }
    
    function updateUIVisibility() {
        const container = document.getElementById('packs-manager');
        if (container) {
            if (isPacksPage()) {
                container.style.display = 'flex';
                console.log('[Packs Manager] On Packs page - showing UI');
            } else {
                container.style.display = 'none';
                console.log('[Packs Manager] Not on Packs page - hiding UI');
            }
        }
    }
    
    // Monitor URL changes
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log('[Packs Manager] URL changed to:', url);
            updateUIVisibility();
        }
    }).observe(document, {subtree: true, childList: true});
    
    // Also listen for popstate events (browser back/forward)
    window.addEventListener('popstate', updateUIVisibility);
    
    // ================== INITIALIZE ==================
    console.log('[Packs Manager] Script loaded, waiting for page load...');
    setTimeout(() => {
        console.log('[Packs Manager] Creating UI...');
        createUI();
        
        // Set initial visibility based on current URL
        updateUIVisibility();
    }, 1000);

})();