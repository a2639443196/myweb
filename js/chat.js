// /js/chat.js
import { BasePage } from './components/BasePage.js';
import { UserModal } from './components/UserModal.js';

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

        // 存储当前用户列表
        this.currentUserList = [];

        // 创建UserModal实例
        this.userModal = new UserModal({
            title: '在线用户',
            emptyMessage: '暂无在线用户'
        });

        // 添加页面卸载事件监听
        window.addEventListener('beforeunload', () => {
            this.disconnectWebSocket();
        });

        // 添加页面可见性变化监听
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                // 页面重新可见且WebSocket未连接时，尝试重连
                this.connectWebSocket();
            }
        });
    }

    async init() {
        await super.init();
        if (!this.user) {
            this.showEmptyState('请先登录再进入聊天室。');
            return;
        }

        // 设置当前用户到UserModal
        this.userModal.setCurrentUser(this.user);

        // 初始化头部状态显示
        this.updateConnectionStatus('offline');

        this.ws.onmessage = this.handleSocketMessage.bind(this);
        this.ws.onopen = () => {
            this.updateConnectionStatus('online');
            // 连接成功后请求用户列表
            this.requestUserList();
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
            console.log('WebSocket message received:', data);

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
        // 更新UserModal中的用户列表
        this.userModal.setUserList(users);
    }

    initUserModal() {
        // 点击用户计数按钮打开弹窗
        this.elements.userCount.addEventListener('click', () => {
            this.userModal.show();
            // 如果用户列表为空，请求最新的用户列表
            if (this.userModal.getUserList().length === 0) {
                this.requestUserList();
            }
        });
    }

    
    requestUserList() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const payload = {
                type: 'get_user_list',
                payload: {}
            };
            this.ws.send(JSON.stringify(payload));
        } else {
            // 如果WebSocket未连接，尝试从API获取在线用户
            this.fetchOnlineUsers();
        }
    }

  fetchOnlineUsers() {
    // 显示加载中状态
    this.userModal.setLoading();

    fetch('/api/online-users', {
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        if (data.users && Array.isArray(data.users)) {
            this.currentUserList = data.users;
            this.userModal.setUserList(data.users);
        } else {
            throw new Error('无效的用户数据格式');
        }
    })
    .catch(error => {
        console.error('获取在线用户列表失败:', error);
        this.userModal.setError();
    });
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
