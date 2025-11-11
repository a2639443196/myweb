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

        this.createElements();
        this.bindEvents();
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
        const users = this.sortUsers(this.currentUserList);

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
                    ${user.online ? '<span class="user-list__badge">在线</span>' : ''}
                    ${isCurrentUser ? '<span class="user-list__badge self">当前</span>' : ''}
                </div>
            `;
        }).join('');

        this.userListContainer.innerHTML = userItems;
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