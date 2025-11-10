/**
 * 日志工具
 */

import { APP_CONFIG, isDevelopment } from './config.js';

// 日志级别
export const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// 当前日志级别
let currentLogLevel = isDevelopment() ? LOG_LEVELS.DEBUG : LOG_LEVELS.ERROR;

/**
 * 日志记录器类
 */
export class Logger {
  constructor(name = 'App') {
    this.name = name;
  }

  /**
   * 设置日志级别
   * @param {number} level - 日志级别
   */
  setLevel(level) {
    currentLogLevel = level;
  }

  /**
   * 获取当前时间戳
   * @returns {string} 格式化的时间戳
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * 格式化日志消息
   * @param {string} level - 日志级别
   * @param {any[]} args - 日志参数
   * @returns {any[]} 格式化后的参数
   */
  formatMessage(level, args) {
    const timestamp = this.getTimestamp();
    const prefix = `[${timestamp}] [${level}] [${this.name}]`;
    return [prefix, ...args];
  }

  /**
   * 记录错误日志
   * @param {any[]} args - 日志参数
   */
  error(...args) {
    if (currentLogLevel >= LOG_LEVELS.ERROR) {
      const formatted = this.formatMessage('ERROR', args);
      console.error(...formatted);
      this.sendToServer('error', args);
    }
  }

  /**
   * 记录警告日志
   * @param {any[]} args - 日志参数
   */
  warn(...args) {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
      const formatted = this.formatMessage('WARN', args);
      console.warn(...formatted);
      this.sendToServer('warn', args);
    }
  }

  /**
   * 记录信息日志
   * @param {any[]} args - 日志参数
   */
  info(...args) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
      const formatted = this.formatMessage('INFO', args);
      console.info(...formatted);
      this.sendToServer('info', args);
    }
  }

  /**
   * 记录调试日志
   * @param {any[]} args - 日志参数
   */
  debug(...args) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
      const formatted = this.formatMessage('DEBUG', args);
      console.debug(...formatted);
      this.sendToServer('debug', args);
    }
  }

  /**
   * 记录性能日志
   * @param {string} label - 性能标签
   * @param {Function} fn - 要测量的函数
   * @returns {*} 函数执行结果
   */
  async time(label, fn) {
    const start = performance.now();
    this.debug(`Starting ${label}`);

    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.debug(`Completed ${label} in ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`Failed ${label} in ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }

  /**
   * 发送日志到服务器（在生产环境中）
   * @param {string} level - 日志级别
   * @param {any[]} args - 日志参数
   */
  async sendToServer(level, args) {
    if (!isDevelopment() && level === 'error') {
      try {
        const logData = {
          level,
          message: args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ).join(' '),
          timestamp: this.getTimestamp(),
          userAgent: navigator.userAgent,
          url: window.location.href
        };

        // 使用 sendBeacon API 异步发送日志
        if (navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify(logData)], {
            type: 'application/json'
          });
          navigator.sendBeacon('/api/logs', blob);
        }
      } catch (error) {
        // 忽略日志发送错误，避免无限循环
        console.warn('Failed to send log to server:', error);
      }
    }
  }

  /**
   * 创建子日志记录器
   * @param {string} childName - 子日志记录器名称
   * @returns {Logger} 子日志记录器
   */
  child(childName) {
    return new Logger(`${this.name}:${childName}`);
  }
}

// 创建默认日志记录器
export const logger = new Logger('WellnessHub');

// 创建特定模块的日志记录器
export const authLogger = logger.child('Auth');
export const apiLogger = logger.child('API');
export const storageLogger = logger.child('Storage');
export const gameLogger = logger.child('Game');
export const trackerLogger = logger.child('Tracker');

// 导出便捷方法
export const logError = (...args) => logger.error(...args);
export const logWarn = (...args) => logger.warn(...args);
export const logInfo = (...args) => logger.info(...args);
export const logDebug = (...args) => logger.debug(...args);

// 错误处理全局监听
window.addEventListener('error', (event) => {
  logger.error('Global error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.stack
  });
});

window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection:', {
    reason: event.reason,
    promise: event.promise
  });
});

export default logger;