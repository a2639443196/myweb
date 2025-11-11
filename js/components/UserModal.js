// /js/components/UserModal.js
export class UserModal {
    constructor(options = {}) {
        this.options = {
            title: '在线用户列表',
            emptyMessage: '暂无在线用户',
            errorMessage: '无法加载用户列表',
            loadingMessage: '加载中...',
            ...options
        };

        this.isOpen = false;
        this.currentUserList = [];
        this.currentUser = null;

        // 创建样式
        this.createStyles();
        this.createElements();
        this.bindEvents();
    }

    createStyles() {
        // 检查是否已存在样式
        if (document.getElementById('user-modal-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'user-modal-styles';
        style.textContent = `
            .user-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                padding: 1rem;
                box-sizing: border-box;
            }

            .user-modal:not([hidden]) {
                opacity: 1;
                visibility: visible;
            }

            .user-modal__overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                cursor: pointer;
                z-index: -1;
            }

            .user-modal__dialog {
                position: relative;
                background: rgba(15, 23, 42, 0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(148, 163, 184, 0.35);
                border-radius: clamp(16px, 4vw, 20px);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
                max-width: min(500px, 90vw);
                max-height: min(600px, 80vh);
                width: 100%;
                overflow: hidden;
                transform: scale(0.9);
                transition: transform 0.3s ease;
            }

            .user-modal:not([hidden]) .user-modal__dialog {
                transform: scale(1);
            }

            .user-modal__header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1.25rem;
                border-bottom: 1px solid rgba(148, 163, 184, 0.25);
                background: rgba(15, 23, 42, 0.6);
            }

            .user-modal__title {
                margin: 0;
                font-size: 1.25rem;
                font-weight: 700;
                color: #f8fafc;
                font-family: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }

            .user-modal__close {
                background: none;
                border: none;
                color: #94a3b8;
                font-size: 1.5rem;
                font-weight: 300;
                cursor: pointer;
                padding: 0.25rem 0.5rem;
                border-radius: 8px;
                transition: all 0.2s ease;
                line-height: 1;
            }

            .user-modal__close:hover {
                background: rgba(239, 68, 68, 0.2);
                color: #ef4444;
            }

            .user-modal__content {
                padding: 0;
                overflow-y: auto;
                max-height: min(500px, 70vh);
            }

            .user-list {
                display: flex;
                flex-direction: column;
            }

            .user-list__loading,
            .user-list__empty {
                padding: 2rem;
                text-align: center;
                color: #94a3b8;
                font-style: italic;
            }

            .user-list__item {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                padding: 1rem 1.25rem;
                border-bottom: 1px solid rgba(148, 163, 184, 0.1);
                transition: background-color 0.2s ease;
            }

            .user-list__item:hover {
                background: rgba(56, 189, 248, 0.05);
            }

            .user-list__item:last-child {
                border-bottom: none;
            }

            .user-list__avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, #38bdf8, #0ea5e9);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 0.9rem;
                flex-shrink: 0;
            }

            .user-list__info {
                flex: 1;
                min-width: 0;
            }

            .user-list__name {
                font-weight: 600;
                color: #f8fafc;
                margin-bottom: 0.125rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }

            .user-list__status {
                font-size: 0.8rem;
                color: #94a3b8;
                font-family: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }

            .user-list__badge {
                padding: 0.25rem 0.5rem;
                border-radius: 12px;
                background: rgba(34, 197, 94, 0.2);
                color: #22c55e;
                font-size: 0.7rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-family: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }

            .user-list__badge.self {
                background: rgba(56, 189, 248, 0.2);
                color: #38bdf8;
            }

            @media (max-width: 640px) {
                .user-modal__dialog {
                    max-width: min(400px, 95vw);
                }

                .user-modal__header {
                    padding: 1rem;
                }

                .user-modal__title {
                    font-size: 1.1rem;
                }

                .user-list__item {
                    padding: 0.875rem 1rem;
                }

                .user-list__avatar {
                    width: 32px;
                    height: 32px;
                    font-size: 0.8rem;
                }

                .user-list__name {
                    font-size: 0.95rem;
                }

                .user-list__status {
                    font-size: 0.75rem;
                }

                .user-list__badge {
                    font-size: 0.65rem;
                    padding: 0.2rem 0.4rem;
                }
            }
        `;
        document.head.appendChild(style);
    }

    createElements() {
        // 创建弹窗容器
        this.modal = document.createElement('div');
        this.modal.className = 'user-modal';
        this.modal.hidden = true;
        this.modal.setAttribute('data-role', 'user-modal');

        // 遮罩层
        this.overlay = document.createElement('div');
        this.overlay.className = 'user-modal__overlay';
        this.overlay.setAttribute('data-role', 'user-modal-close');

        // 弹窗对话框
        this.dialog = document.createElement('div');
        this.dialog.className = 'user-modal__dialog';

        // 头部
        this.header = document.createElement('div');
        this.header.className = 'user-modal__header';

        this.title = document.createElement('h3');
        this.title.className = 'user-modal__title';
        this.title.textContent = this.options.title;

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'user-modal__close';
        this.closeButton.setAttribute('data-role', 'user-modal-close');
        this.closeButton.setAttribute('aria-label', '关闭');
        this.closeButton.textContent = '×';

        this.header.appendChild(this.title);
        this.header.appendChild(this.closeButton);

        // 内容区域
        this.content = document.createElement('div');
        this.content.className = 'user-modal__content';

        this.userListContainer = document.createElement('div');
        this.userListContainer.className = 'user-list';
        this.userListContainer.setAttribute('data-role', 'user-list-content');

        this.content.appendChild(this.userListContainer);

        // 组装弹窗
        this.dialog.appendChild(this.header);
        this.dialog.appendChild(this.content);
        this.modal.appendChild(this.overlay);
        this.modal.appendChild(this.dialog);

        // 添加到body
        document.body.appendChild(this.modal);
    }

    bindEvents() {
        // 关闭按钮点击事件
        const closeElements = this.modal.querySelectorAll('[data-role="user-modal-close"]');
        closeElements.forEach(element => {
            element.addEventListener('click', () => this.close());
        });

        // 点击弹窗内部阻止关闭
        this.dialog.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    show() {
        this.modal.hidden = false;
        this.isOpen = true;
        document.body.style.overflow = 'hidden';

        // 触发显示事件
        this.modal.dispatchEvent(new CustomEvent('usermodal:show', {
            detail: { modal: this }
        }));
    }

    close() {
        this.modal.hidden = true;
        this.isOpen = false;
        document.body.style.overflow = '';

        // 触发关闭事件
        this.modal.dispatchEvent(new CustomEvent('usermodal:close', {
            detail: { modal: this }
        }));
    }

    setLoading() {
        this.userListContainer.innerHTML = `<div class="user-list__loading">${this.options.loadingMessage}</div>`;
    }

    setError() {
        this.userListContainer.innerHTML = `<div class="user-list__empty">${this.options.errorMessage}</div>`;
    }

    setEmpty() {
        this.userListContainer.innerHTML = `<div class="user-list__empty">${this.options.emptyMessage}</div>`;
    }

    // 设置用户列表数据
    setUserList(users) {
        this.currentUserList = users || [];
        this.renderUserList();
    }

    // 获取当前用户列表
    getUserList() {
        return this.currentUserList;
    }

    // 排序用户：在线用户优先，然后按用户名排序
    sortUsers(users) {
        return [...users].sort((a, b) => {
            // 在线状态优先
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            // 相同状态按用户名排序
            return a.username.localeCompare(b.username, 'zh-CN');
        });
    }

    renderUserList() {
        // 确保包含当前用户
        let users = [...this.currentUserList];
        if (this.currentUser && !users.find(u => u.username === this.currentUser.username)) {
            users.push({
                ...this.currentUser,
                online: true // 当前用户默认为在线状态
            });
        }

        users = this.sortUsers(users);

        if (!users.length) {
            this.setEmpty();
            return;
        }

        const userItems = users.map(user => {
            const isCurrentUser = user.username === this.currentUser?.username;
            const avatar = user.username.charAt(0).toUpperCase();
            const status = isCurrentUser ? '你' : (user.online ? '在线' : '离线');

            return `
                <div class="user-list__item">
                    <div class="user-list__avatar">${avatar}</div>
                    <div class="user-list__info">
                        <div class="user-list__name">${user.username}</div>
                        <div class="user-list__status">${status}</div>
                    </div>
                    ${user.online && !isCurrentUser ? '<span class="user-list__badge">在线</span>' : ''}
                    ${isCurrentUser ? '<span class="user-list__badge self">当前</span>' : ''}
                </div>
            `;
        }).join('');

        this.userListContainer.innerHTML = `<div class="user-list">${userItems}</div>`;
    }

    // 设置当前用户信息（用于标记当前用户）
    setCurrentUser(user) {
        this.currentUser = user;
        if (this.currentUserList.length > 0) {
            this.renderUserList();
        }
    }

    // 销毁弹窗
    destroy() {
        this.close();
        if (this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
    }
}