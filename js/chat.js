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
        };
    }

    async init() {
        await super.init();
        if (!this.user) {
            this.showEmptyState('请先登录再进入聊天室。');
            return;
        }
        this.ws.onmessage = this.handleSocketMessage.bind(this);
        this.initForm();
    }

    initForm() {
        this.elements.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitMessage();
        });

        this.elements.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitMessage();
            }
        });
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
    }

    renderMessage(message, isHistory = false) {
        const messageElement = this.createMessageElement(message);
        if (isHistory) {
            this.elements.messages.appendChild(messageElement);
        } else {
            this.elements.messages.prepend(messageElement);
        }
    }

    renderSystemMessage(message) {
        const messageData = {
            ...message,
            sender: 'system',
        };
        const messageElement = this.createMessageElement(messageData);
        this.elements.messages.prepend(messageElement);
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatPage();
});
