/**
 * 应用配置文件
 */

// 应用基本信息
export const APP_CONFIG = {
  name: 'Wellness Hub',
  version: '2.0.0',
  description: '健康生活管理平台',

  // API配置
  api: {
    baseURL: '',
    timeout: 10000,
    retries: 3
  },

  // 本地存储配置
  storage: {
    prefix: 'wellness_',
    indexedDB: {
      name: 'WellnessHubDB',
      version: 1,
      stores: {
        activities: 'activities',
        settings: 'settings',
        cache: 'cache'
      }
    }
  },

  // WebSocket配置
  websocket: {
    url: `ws://${window.location.host}/ws`,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10
  },

  // 游戏配置
  games: {
    schulte: {
      minSize: 3,
      maxSize: 9,
      defaultSize: 5
    },
    memory: {
      defaultPairs: 8,
      maxPairs: 20
    },
    sudoku: {
      difficulties: ['easy', 'medium', 'hard'],
      defaultDifficulty: 'medium'
    }
  },

  // 追踪器配置
  trackers: {
    water: {
      dailyGoal: 2000, // ml
      unitSize: 250    // ml
    },
    smoking: {
      dailyGoal: 0,
      trackingMethod: 'count'
    }
  },

  // UI配置
  ui: {
    animations: true,
    theme: 'dark',
    language: 'zh-CN',
    pageSize: 20
  }
};

// 环境配置
export const ENV = {
  development: process.env.NODE_ENV === 'development',
  production: process.env.NODE_ENV === 'production',
  test: process.env.NODE_ENV === 'test'
};

// 错误代码
export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  GAME_ERROR: 'GAME_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// 事件类型
export const EVENT_TYPES = {
  // 用户事件
  USER_LOGIN: 'user:login',
  USER_LOGOUT: 'user:logout',
  USER_UPDATE: 'user:update',

  // 活动事件
  ACTIVITY_CREATE: 'activity:create',
  ACTIVITY_UPDATE: 'activity:update',
  ACTIVITY_DELETE: 'activity:delete',

  // 游戏事件
  GAME_START: 'game:start',
  GAME_END: 'game:end',
  GAME_SCORE: 'game:score',

  // WebSocket事件
  WS_CONNECT: 'ws:connect',
  WS_DISCONNECT: 'ws:disconnect',
  WS_MESSAGE: 'ws:message',
  WS_ERROR: 'ws:error',

  // UI事件
  THEME_CHANGE: 'ui:theme-change',
  LANGUAGE_CHANGE: 'ui:language-change'
};

// HTTP状态码
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
};

// 默认设置
export const DEFAULT_SETTINGS = {
  theme: 'dark',
  language: 'zh-CN',
  animations: true,
  notifications: true,
  autoSave: true,
  soundEffects: true
};

// 工具函数
export const isDevelopment = () => ENV.development;
export const isProduction = () => ENV.production;
export const isTest = () => ENV.test;

export const getApiUrl = (path = '') => {
  const baseURL = APP_CONFIG.api.baseURL || '';
  return `${baseURL}${path}`.replace(/\/+/g, '/');
};

export const getWebSocketUrl = (path = '') => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${path}`;
};