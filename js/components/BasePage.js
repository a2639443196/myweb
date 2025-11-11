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
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}/ws/${this.options.name.toLowerCase()}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            if (this.elements.wsStatus) this.elements.wsStatus.textContent = '在线';
        };

        this.ws.onclose = () => {
            if (this.elements.wsStatus) this.elements.wsStatus.textContent = '离线';
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.handlers = {};
    }
}
