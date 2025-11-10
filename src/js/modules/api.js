/**
 * API 请求模块
 */

import { APP_CONFIG, HTTP_STATUS, ERROR_CODES } from '../core/config.js';
import { logger } from '../core/logger.js';
import { getLocalItem, setLocalItem } from '../utils/storage.js';

const apiLogger = logger.child('API');

/**
 * API 错误类
 */
export class ApiError extends Error {
  constructor(message, code = ERROR_CODES.UNKNOWN_ERROR, status = null, data = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * HTTP 客户端类
 */
export class HttpClient {
  constructor(baseURL = APP_CONFIG.api.baseURL) {
    this.baseURL = baseURL;
    this.timeout = APP_CONFIG.api.timeout;
    this.retries = APP_CONFIG.api.retries;
    this.abortController = null;
  }

  /**
   * 构建完整 URL
   * @param {string} path - 请求路径
   * @returns {string} 完整 URL
   */
  buildURL(path) {
    const url = `${this.baseURL}${path}`;
    return url.replace(/\/+/g, '/');
  }

  /**
   * 获取请求头
   * @param {Object} options - 请求选项
   * @returns {Object} 请求头
   */
  async getHeaders(options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };

    // 添加认证头
    const token = getLocalItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * 处理响应
   * @param {Response} response - 响应对象
   * @returns {Promise<any>} 响应数据
   */
  async handleResponse(response) {
    const contentType = response.headers.get('content-type');
    const isJSON = contentType && contentType.includes('application/json');

    let data;
    try {
      data = isJSON ? await response.json() : await response.text();
    } catch (error) {
      apiLogger.warn('Failed to parse response:', error);
      data = null;
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `HTTP ${response.status}`;
      const code = this.getErrorCode(response.status);
      throw new ApiError(message, code, response.status, data);
    }

    return data;
  }

  /**
   * 获取错误代码
   * @param {number} status - HTTP 状态码
   * @returns {string} 错误代码
   */
  getErrorCode(status) {
    switch (status) {
      case HTTP_STATUS.UNAUTHORIZED:
        return ERROR_CODES.AUTH_ERROR;
      case HTTP_STATUS.BAD_REQUEST:
        return ERROR_CODES.VALIDATION_ERROR;
      case HTTP_STATUS.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        return ERROR_CODES.NETWORK_ERROR;
      default:
        return ERROR_CODES.UNKNOWN_ERROR;
    }
  }

  /**
   * 执行请求
   * @param {string} method - HTTP 方法
   * @param {string} path - 请求路径
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  async request(method, path, options = {}) {
    const url = this.buildURL(path);
    const headers = await this.getHeaders(options);

    // 创建 AbortController
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 构建请求配置
    const config = {
      method: method.toUpperCase(),
      headers,
      signal,
      ...options
    };

    // 添加请求体
    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    // 添加超时
    const timeoutId = setTimeout(() => {
      this.abortController.abort();
    }, this.timeout);

    apiLogger.debug(`API Request: ${method} ${url}`, config);

    try {
      let lastError;

      // 重试逻辑
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          const response = await fetch(url, config);
          const data = await this.handleResponse(response);

          apiLogger.debug(`API Response: ${method} ${url}`, data);
          return data;
        } catch (error) {
          lastError = error;

          // 如果是认证错误，不重试
          if (error.code === ERROR_CODES.AUTH_ERROR) {
            throw error;
          }

          // 如果是最后一次尝试，抛出错误
          if (attempt === this.retries) {
            throw error;
          }

          // 等待后重试
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }

      throw lastError;
    } catch (error) {
      apiLogger.error(`API Error: ${method} ${url}`, error);

      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout', ERROR_CODES.NETWORK_ERROR);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟时间（毫秒）
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 取消当前请求
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * GET 请求
   * @param {string} path - 请求路径
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  get(path, options = {}) {
    return this.request('GET', path, options);
  }

  /**
   * POST 请求
   * @param {string} path - 请求路径
   * @param {any} data - 请求数据
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  post(path, data, options = {}) {
    return this.request('POST', path, { ...options, body: data });
  }

  /**
   * PUT 请求
   * @param {string} path - 请求路径
   * @param {any} data - 请求数据
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  put(path, data, options = {}) {
    return this.request('PUT', path, { ...options, body: data });
  }

  /**
   * PATCH 请求
   * @param {string} path - 请求路径
   * @param {any} data - 请求数据
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  patch(path, data, options = {}) {
    return this.request('PATCH', path, { ...options, body: data });
  }

  /**
   * DELETE 请求
   * @param {string} path - 请求路径
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 响应数据
   */
  delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }
}

// 创建默认 HTTP 客户端实例
export const httpClient = new HttpClient();

// API 方法封装
export const api = {
  // 用户相关 API
  auth: {
    // 登录
    login: (credentials) => httpClient.post('/api/login', credentials),

    // 注册
    register: (userData) => httpClient.post('/api/register', userData),

    // 登出
    logout: () => httpClient.post('/api/logout'),

    // 获取当前用户信息
    getCurrentUser: () => httpClient.get('/api/session'),

    // 心跳
    heartbeat: () => httpClient.post('/api/session/heartbeat')
  },

  // 活动相关 API
  activities: {
    // 创建活动
    create: (activity) => httpClient.post('/api/activity', activity),

    // 获取用户活动
    getUserActivities: (username, category) => {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      return httpClient.get(`/api/users/${username}/activity${params.toString() ? '?' + params.toString() : ''}`);
    }
  },

  // 游戏相关 API
  games: {
    // 舒尔特方格
    schulte: {
      // 获取个人记录
      getPersonalRecords: () => httpClient.get('/api/schulte/records/me'),

      // 获取排行榜
      getLeaderboard: () => httpClient.get('/api/schulte/leaderboard'),

      // 提交成绩
      submitRecord: (record) => httpClient.post('/api/schulte/records', record)
    },

    // 反应力测试
    reaction: {
      getPersonalRecords: () => httpClient.get('/api/reaction/records/me'),
      getLeaderboard: () => httpClient.get('/api/reaction/leaderboard'),
      submitRecord: (record) => httpClient.post('/api/reaction/records', record)
    },

    // 记忆翻牌
    memory: {
      getPersonalRecords: () => httpClient.get('/api/memory-flip/records/me'),
      getLeaderboard: () => httpClient.get('/api/memory-flip/leaderboard'),
      submitRecord: (record) => httpClient.post('/api/memory-flip/records', record)
    },

    // 数独
    sudoku: {
      getPersonalRecords: () => httpClient.get('/api/sudoku/records/me'),
      getLeaderboard: () => httpClient.get('/api/sudoku/leaderboard'),
      submitRecord: (record) => httpClient.post('/api/sudoku/records', record)
    }
  },

  // 用户相关 API
  users: {
    // 获取用户信息
    getUser: (username) => httpClient.get(`/api/users/${username}`),

    // 获取在线用户
    getOnlineUsers: () => httpClient.get('/api/online-users')
  },

  // 系统 API
  system: {
    // 健康检查
    healthCheck: () => httpClient.get('/api/healthz')
  }
};

// 导出便捷函数
export const login = (credentials) => api.auth.login(credentials);
export const register = (userData) => api.auth.register(userData);
export const logout = () => api.auth.logout();
export const getCurrentUser = () => api.auth.getCurrentUser();
export const createActivity = (activity) => api.activities.create(activity);
export const getUserActivities = (username, category) => api.activities.getUserActivities(username, category);

export default httpClient;