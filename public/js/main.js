/**
 * Wellness Hub 主入口文件
 */

import { waitForDOMReady } from '../src/js/utils/dom.js';
import { logger } from '../src/js/core/logger.js';
import { getLocalItem } from '../src/js/utils/storage.js';

const appLogger = logger.child('App');

/**
 * 应用主类
 */
class WellnessHub {
  constructor() {
    this.name = 'WellnessHub';
    this.version = '2.0.0';
    this.currentPage = null;
    this.modules = new Map();
    this.isInitialized = false;
  }

  /**
   * 初始化应用
   */
  async init() {
    try {
      appLogger.info('Initializing Wellness Hub application');

      // 等待 DOM 加载完成
      await waitForDOMReady();

      // 隐藏加载屏幕
      this.hideLoadingScreen();

      // 初始化主题
      this.initTheme();

      // 初始化页面
      await this.initCurrentPage();

      // 初始化全局事件监听
      this.initGlobalEvents();

      // 设置应用为已初始化
      this.isInitialized = true;

      appLogger.info('Wellness Hub initialized successfully');
      this.emit('app:ready');

    } catch (error) {
      appLogger.error('Failed to initialize app:', error);
      this.showError('应用初始化失败，请刷新页面重试');
    }
  }

  /**
   * 隐藏加载屏幕
   */
  hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.getElementById('main-content');

    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 300);
    }

    if (mainContent) {
      mainContent.style.display = 'block';
    }
  }

  /**
   * 初始化主题
   */
  initTheme() {
    const savedTheme = getLocalItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', savedTheme);

    // 监听主题变化
    this.on('theme:change', (event) => {
      const { theme } = event.detail;
      document.documentElement.setAttribute('data-theme', theme);
    });
  }

  /**
   * 初始化当前页面
   */
  async initCurrentPage() {
    const pagePath = this.getCurrentPagePath();
    appLogger.debug('Current page path:', pagePath);

    try {
      // 根据路径加载对应的页面模块
      const pageModule = await this.loadPageModule(pagePath);
      if (pageModule) {
        this.currentPage = new pageModule.default();
        await this.currentPage.init();
        appLogger.debug(`Page loaded: ${pagePath}`);
      }
    } catch (error) {
      appLogger.error(`Failed to load page: ${pagePath}`, error);
      this.showError('页面加载失败');
    }
  }

  /**
   * 获取当前页面路径
   * @returns {string} 页面路径
   */
  getCurrentPagePath() {
    const path = window.location.pathname;

    // 移除文件扩展名和前导斜杠
    const cleanPath = path.replace(/^\//, '').replace(/\.html$/, '');

    // 映射路径到页面模块
    const pageMap = {
      '': 'navigation',
      'index': 'navigation',
      'user-home': 'user-home',
      'drink-water': 'trackers/drink-water',
      'bowel-tracker': 'trackers/bowel-tracker',
      'slack-tracker': 'trackers/slack-tracker',
      'smoking-tracker': 'trackers/smoking-tracker',
      'mini-games': 'games/mini-games',
      'schulte-table': 'games/schulte-table',
      'memory-flip': 'games/memory-flip',
      'reaction-test': 'games/reaction-test',
      'sudoku': 'games/sudoku'
    };

    return pageMap[cleanPath] || 'navigation';
  }

  /**
   * 加载页面模块
   * @param {string} pagePath - 页面路径
   * @returns {Promise<Object>} 页面模块
   */
  async loadPageModule(pagePath) {
    try {
      // 动态导入页面模块
      const module = await import(`../src/js/pages/${pagePath}.js`);
      return module;
    } catch (error) {
      appLogger.warn(`Page module not found: ${pagePath}`, error);

      // 返回默认页面
      try {
        return await import('../src/js/pages/navigation.js');
      } catch (fallbackError) {
        appLogger.error('Failed to load fallback page:', fallbackError);
        return null;
      }
    }
  }

  /**
   * 初始化全局事件监听
   */
  initGlobalEvents() {
    // 监听路由变化
    window.addEventListener('popstate', () => {
      this.handleRouteChange();
    });

    // 监听点击事件（用于处理导航）
    document.addEventListener('click', (event) => {
      this.handleNavigationClick(event);
    });

    // 监听键盘快捷键
    document.addEventListener('keydown', (event) => {
      this.handleKeyboardShortcuts(event);
    });

    // 监听在线状态变化
    window.addEventListener('online', () => {
      this.showSuccess('网络连接已恢复');
    });

    window.addEventListener('offline', () => {
      this.showWarning('网络连接已断开');
    });

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange();
    });

    // 错误处理
    window.addEventListener('error', (event) => {
      appLogger.error('Global error:', event.error);
      this.showError('发生了未知错误');
    });

    window.addEventListener('unhandledrejection', (event) => {
      appLogger.error('Unhandled promise rejection:', event.reason);
      this.showError('请求处理失败');
    });
  }

  /**
   * 处理导航点击
   * @param {Event} event - 点击事件
   */
  handleNavigationClick(event) {
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');

    // 只处理内部链接
    if (href.startsWith('/') || href.startsWith('./') || href.endsWith('.html')) {
      event.preventDefault();
      this.navigateTo(href);
    }
  }

  /**
   * 导航到指定页面
   * @param {string} path - 页面路径
   */
  async navigateTo(path) {
    try {
      appLogger.debug('Navigating to:', path);

      // 更新浏览器历史
      if (path !== window.location.pathname) {
        history.pushState(null, '', path);
      }

      // 清理当前页面
      if (this.currentPage) {
        await this.currentPage.destroy();
        this.currentPage = null;
      }

      // 加载新页面
      await this.initCurrentPage();

    } catch (error) {
      appLogger.error('Navigation failed:', error);
      this.showError('页面跳转失败');
    }
  }

  /**
   * 处理路由变化
   */
  async handleRouteChange() {
    await this.initCurrentPage();
  }

  /**
   * 处理键盘快捷键
   * @param {KeyboardEvent} event - 键盘事件
   */
  handleKeyboardShortcuts(event) {
    // Ctrl/Cmd + K: 搜索快捷键
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.emit('shortcut:search');
    }

    // Ctrl/Cmd + /: 显示快捷键帮助
    if ((event.ctrlKey || event.metaKey) && event.key === '/') {
      event.preventDefault();
      this.emit('shortcut:help');
    }

    // Escape: 关闭模态框或取消操作
    if (event.key === 'Escape') {
      this.emit('shortcut:escape');
    }
  }

  /**
   * 处理页面可见性变化
   */
  handleVisibilityChange() {
    if (document.hidden) {
      this.emit('app:hidden');
    } else {
      this.emit('app:visible');
    }
  }

  /**
   * 显示成功消息
   * @param {string} message - 消息内容
   */
  showSuccess(message) {
    this.showToast(message, 'success');
  }

  /**
   * 显示错误消息
   * @param {string} message - 消息内容
   */
  showError(message) {
    this.showToast(message, 'error');
  }

  /**
   * 显示警告消息
   * @param {string} message - 消息内容
   */
  showWarning(message) {
    this.showToast(message, 'warning');
  }

  /**
   * 显示信息消息
   * @param {string} message - 消息内容
   */
  showInfo(message) {
    this.showToast(message, 'info');
  }

  /**
   * 显示 Toast 消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型
   * @param {number} duration - 显示时长
   */
  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
      toast.classList.add('toast-show');
    });

    // 自动移除
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }

  /**
   * 注册模块
   * @param {string} name - 模块名称
   * @param {Object} module - 模块实例
   */
  registerModule(name, module) {
    this.modules.set(name, module);
    appLogger.debug(`Module registered: ${name}`);
  }

  /**
   * 获取模块
   * @param {string} name - 模块名称
   * @returns {Object|null} 模块实例
   */
  getModule(name) {
    return this.modules.get(name) || null;
  }

  /**
   * 事件发射器
   */
  emit(eventName, data = {}) {
    const event = new CustomEvent(eventName, {
      detail: { app: this, ...data }
    });
    document.dispatchEvent(event);
    appLogger.debug(`Event emitted: ${eventName}`, data);
  }

  /**
   * 监听事件
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  on(eventName, handler) {
    document.addEventListener(eventName, handler);
  }

  /**
   * 移除事件监听
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  off(eventName, handler) {
    document.removeEventListener(eventName, handler);
  }
}

// 创建应用实例
const app = new WellnessHub();

// 等待 DOM 加载完成后初始化应用
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// 导出到全局（便于调试）
window.WellnessHub = app;

// 导出应用实例
export default app;