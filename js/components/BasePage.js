// /js/components/BasePage.js
import { api } from '../modules/api.js';

export class BasePage {
    constructor(options = {}) {
        this.options = {
            name: 'BasePage',
            title: 'Wellness Hub',
            wsEnabled: false,
            ...options,
        };

        this.user = null;
        this.ws = null;

        this.elements = {
            page: document.querySelector('[data-role="page"]'),
            emptyState: document.querySelector('[data-role="empty-state"]'),
            emptyMessage: document.querySelector('[data-role="empty-message"]'),
            wsStatus: document.querySelector('[data-role="ws-status"]'),
        };

        this.init();
    }

    async init() {
        try {
            this.user = await api.session.get();
            if (this.user) {
                this.showPage();
                if (this.options.wsEnabled) {
                    this.initWebSocket();
                }
            } else {
                this.showEmptyState('请先登录。');
            }
        } catch (error) {
            this.showEmptyState('无法加载页面，请稍后重试。');
            console.error('Initialization failed:', error);
        }
    }

    showPage() {
        if (this.elements.page) this.elements.page.hidden = false;
        if (this.elements.emptyState) this.elements.emptyState.hidden = true;
        document.title = this.options.title;
    }

    showEmptyState(message) {
        if (this.elements.emptyState) this.elements.emptyState.hidden = false;
        if (this.elements.page) this.elements.page.hidden = true;
        if (this.elements.emptyMessage) this.elements.emptyMessage.textContent = message;
    }

    initWebSocket() {
        this.shouldReconnect = true;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 3000;

        this.connectWebSocket();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}/ws/${this.options.name.toLowerCase()}`;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        try {
            this.ws = new WebSocket(wsUrl);
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            if (this.elements.wsStatus) {
                this.elements.wsStatus.textContent = '在线';
                this.elements.wsStatus.classList.add('online');
            }
            console.log(`${this.options.name} WebSocket connected`);
        };

        this.ws.onclose = (event) => {
            if (this.elements.wsStatus) {
                this.elements.wsStatus.textContent = '离线';
                this.elements.wsStatus.classList.remove('online');
            }

            if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.scheduleReconnect();
            }

            console.log(`${this.options.name} WebSocket disconnected`, event);
        };

        this.ws.onerror = (error) => {
            console.error(`${this.options.name} WebSocket error:`, error);
        };

        this.ws.handlers = {};
    }

    scheduleReconnect() {
        if (!this.shouldReconnect || this.reconnectTimer) return;

        const delay = this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts, 5));
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect ${this.options.name} WebSocket (attempt ${this.reconnectAttempts})`);
            this.connectWebSocket();
        }, delay);
    }

    disconnectWebSocket() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'User disconnected');
            this.ws = null;
        }
    }
}
