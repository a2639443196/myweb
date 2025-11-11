// /js/chat.js
import { BasePage } from './components/BasePage.js';

class ChatPage extends BasePage {
    constructor() {
        super({
            name: 'Chat',
            title: '实时聊天室',
            wsEnabled: true,
        });

        this.elements = {
            ...this.elements,
            messages: document.querySelector('[data-role="chat-messages"]'),
            form: document.querySelector('[data-role="chat-form"]'),
            input: document.querySelector('[data-role="chat-input"]'),
            userCount: document.querySelector('[data-role="user-count"]'),
            messageTemplate: document.getElementById('message-template'),
            userModal: document.querySelector('[data-role="user-modal"]'),
            userListContent: document.querySelector('[data-role="user-list-content"]'),
        };

        // 存储当前用户列表
        this.currentUserList = [];
    }

    async init() {
        await super.init();
        if (!this.user) {
            this.showEmptyState('请先登录再进入聊天室。');
            return;
        }

        // 初始化头部状态显示
        this.updateConnectionStatus('offline');

        this.ws.onmessage = this.handleSocketMessage.bind(this);
        this.ws.onopen = () => {
            this.updateConnectionStatus('online');
        };
        this.ws.onclose = () => {
            this.updateConnectionStatus('offline');
        };
        this.ws.onerror = () => {
            this.updateConnectionStatus('offline');
        };

        this.initForm();
        this.initUserModal();
    }

    initForm() {
        this.elements.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitMessage();
        });

        // PC端Enter键发送，移动端使用按钮发送
        this.elements.input.addEventListener('keydown', (e) => {
            // 检测是否为移动设备
            const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 640;

            if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                e.preventDefault();
                this.submitMessage();
            }
        });

        // 为移动端优化输入体验
        if (window.innerWidth <= 640) {
            this.elements.input.addEventListener('focus', () => {
                // 聚焦时滚动到底部
                setTimeout(() => {
                    this.scrollToBottom();
                }, 300);
            });
        }
    }

    submitMessage() {
        const message = this.elements.input.value.trim();
        if (message) {
            this.sendMessage(message);
            this.elements.input.value = '';
        }
    }

    sendMessage(message) {
        const payload = {
            type: 'chat_message',
            payload: {
                text: message,
            },
        };
        this.ws.send(JSON.stringify(payload));

        // 发送消息后立即滚动到底部
        requestAnimationFrame(() => {
            this.scrollToBottom();
        });
    }

    handleSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'chat_history':
                    this.renderHistory(data.payload);
                    break;
                case 'chat_message':
                    this.renderMessage(data.payload);
                    break;
                case 'user_list':
                    this.updateUserCount(data.payload.users);
                    break;
                case 'system_message':
                    this.renderSystemMessage(data.payload);
                    break;
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    }

    renderHistory(history) {
        this.elements.messages.innerHTML = '';
        history.forEach((msg) => this.renderMessage(msg, true));
        // 加载历史消息后滚动到底部
        this.scrollToBottom();
    }

    
    createMessageElement(message) {
        const template = this.elements.messageTemplate.content.cloneNode(true);
        const li = template.querySelector('.chat-message');
        const content = li.querySelector('.chat-message__content');
        const meta = li.querySelector('.chat-message__meta');

        const senderType = message.sender === this.user.username ? 'self' : (message.sender === 'system' ? 'system' : 'other');
        li.dataset.sender = senderType;

        content.textContent = message.text;
        const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        meta.textContent = `${message.sender} at ${time}`;

        return li;
    }

    updateUserCount(users) {
        this.elements.userCount.textContent = users.length;
        // 更新存储的用户列表
        this.currentUserList = users;
    }

    initUserModal() {
        // 点击用户计数按钮打开弹窗
        this.elements.userCount.addEventListener('click', () => {
            this.showUserModal();
        });

        // 点击遮罩层或关闭按钮关闭弹窗
        const closeElements = document.querySelectorAll('[data-role="user-modal-close"]');
        closeElements.forEach(element => {
            element.addEventListener('click', () => {
                this.hideUserModal();
            });
        });

        // 点击弹窗内部阻止关闭
        this.elements.userModal.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // ESC键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.elements.userModal.hidden) {
                this.hideUserModal();
            }
        });
    }

    showUserModal() {
        this.elements.userModal.hidden = false;
        this.renderUserList();
    }

    hideUserModal() {
        this.elements.userModal.hidden = true;
    }

    renderUserList() {
        if (!this.currentUserList || this.currentUserList.length === 0) {
            this.elements.userListContent.innerHTML = '<div class="user-list__empty">暂无在线用户</div>';
            return;
        }

        const userItems = this.currentUserList.map(user => {
            const isCurrentUser = user.username === this.user.username;
            const avatar = user.username.charAt(0).toUpperCase();
            const status = isCurrentUser ? '你' : '在线';

            return `
                <div class="user-list__item">
                    <div class="user-list__avatar">${avatar}</div>
                    <div class="user-list__info">
                        <div class="user-list__name">${user.username}</div>
                        <div class="user-list__status">${status}</div>
                    </div>
                    ${isCurrentUser ? '<span class="user-list__badge self">当前</span>' : '<span class="user-list__badge">在线</span>'}
                </div>
            `;
        }).join('');

        this.elements.userListContent.innerHTML = `<div class="user-list">${userItems}</div>`;
    }

    updateConnectionStatus(status) {
        const statusElement = document.querySelector('[data-role="ws-status"]');
        if (!statusElement) return;

        if (status === 'online') {
            statusElement.textContent = '在线';
            statusElement.classList.add('online');
        } else {
            statusElement.textContent = '离线';
            statusElement.classList.remove('online');
        }
    }

    scrollToBottom() {
        // 滚动聊天容器到底部
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    renderMessage(message, isHistory = false) {
        const messageElement = this.createMessageElement(message);
        // 所有消息都添加到末尾（新消息在上面）
        this.elements.messages.appendChild(messageElement);

        if (!isHistory) {
            // 新消息添加后滚动到底部
            requestAnimationFrame(() => {
                this.scrollToBottom();
            });
        }
    }

    renderSystemMessage(message) {
        const messageData = {
            ...message,
            sender: 'system',
        };
        const messageElement = this.createMessageElement(messageData);
        this.elements.messages.appendChild(messageElement);
        // 系统消息添加后滚动到底部
        requestAnimationFrame(() => {
            this.scrollToBottom();
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatPage();
});
