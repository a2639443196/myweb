/**
 * 存储工具函数
 */

import { APP_CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';

const storageLogger = logger.child('Storage');

/**
 * 本地存储工具类
 */
export class LocalStorage {
  constructor(prefix = APP_CONFIG.storage.prefix) {
    this.prefix = prefix;
  }

  /**
   * 生成完整的存储键名
   * @param {string} key - 原始键名
   * @returns {string} 带前缀的键名
   */
  getKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * 设置存储项
   * @param {string} key - 键名
   * @param {any} value - 值
   * @param {number} ttl - 过期时间（毫秒）
   */
  set(key, value, ttl) {
    try {
      const item = {
        value,
        timestamp: Date.now(),
        ttl: ttl || null
      };
      localStorage.setItem(this.getKey(key), JSON.stringify(item));
      storageLogger.debug('LocalStorage set:', key);
    } catch (error) {
      storageLogger.error('LocalStorage set error:', error);
      throw new Error('LocalStorage write failed');
    }
  }

  /**
   * 获取存储项
   * @param {string} key - 键名
   * @param {any} defaultValue - 默认值
   * @returns {any} 存储的值
   */
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(this.getKey(key));
      if (!item) return defaultValue;

      const parsed = JSON.parse(item);

      // 检查是否过期
      if (parsed.ttl && Date.now() - parsed.timestamp > parsed.ttl) {
        this.remove(key);
        return defaultValue;
      }

      storageLogger.debug('LocalStorage get:', key);
      return parsed.value;
    } catch (error) {
      storageLogger.error('LocalStorage get error:', error);
      return defaultValue;
    }
  }

  /**
   * 移除存储项
   * @param {string} key - 键名
   */
  remove(key) {
    try {
      localStorage.removeItem(this.getKey(key));
      storageLogger.debug('LocalStorage remove:', key);
    } catch (error) {
      storageLogger.error('LocalStorage remove error:', error);
    }
  }

  /**
   * 清空所有带前缀的存储项
   */
  clear() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
      storageLogger.debug('LocalStorage cleared');
    } catch (error) {
      storageLogger.error('LocalStorage clear error:', error);
    }
  }

  /**
   * 获取所有键名
   * @returns {string[]} 键名列表
   */
  keys() {
    try {
      const keys = Object.keys(localStorage);
      return keys
        .filter(key => key.startsWith(this.prefix))
        .map(key => key.substring(this.prefix.length));
    } catch (error) {
      storageLogger.error('LocalStorage keys error:', error);
      return [];
    }
  }

  /**
   * 检查是否存在
   * @param {string} key - 键名
   * @returns {boolean} 是否存在
   */
  has(key) {
    try {
      const item = localStorage.getItem(this.getKey(key));
      if (!item) return false;

      const parsed = JSON.parse(item);
      if (parsed.ttl && Date.now() - parsed.timestamp > parsed.ttl) {
        this.remove(key);
        return false;
      }

      return true;
    } catch (error) {
      storageLogger.error('LocalStorage has error:', error);
      return false;
    }
  }
}

/**
 * IndexedDB 工具类
 */
export class IndexedDBStorage {
  constructor() {
    this.dbName = APP_CONFIG.storage.indexedDB.name;
    this.version = APP_CONFIG.storage.indexedDB.version;
    this.stores = APP_CONFIG.storage.indexedDB.stores;
    this.db = null;
  }

  /**
   * 打开数据库连接
   * @returns {Promise<IDBDatabase>} 数据库连接
   */
  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        storageLogger.error('IndexedDB open error:', request.error);
        reject(new Error('IndexedDB open failed'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        storageLogger.debug('IndexedDB opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 创建对象存储
        Object.entries(this.stores).forEach(([name, keyPath]) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, {
              keyPath: keyPath || 'id',
              autoIncrement: true
            });

            // 创建索引
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('category', 'category', { unique: false });
          }
        });

        storageLogger.debug('IndexedDB upgraded');
      };
    });
  }

  /**
   * 获取对象存储
   * @param {string} storeName - 存储名称
   * @param {string} mode - 读写模式
   * @returns {IDBObjectStore} 对象存储
   */
  async getStore(storeName, mode = 'readonly') {
    await this.open();
    const transaction = this.db.transaction([storeName], mode);
    return transaction.objectStore(storeName);
  }

  /**
   * 添加数据
   * @param {string} storeName - 存储名称
   * @param {any} data - 数据
   * @returns {Promise<any>} 添加的数据
   */
  async add(storeName, data) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.add({
        ...data,
        timestamp: Date.now()
      });

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB add success:', storeName);
        resolve(request.result);
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB add error:', request.error);
        reject(new Error('IndexedDB add failed'));
      };
    });
  }

  /**
   * 更新数据
   * @param {string} storeName - 存储名称
   * @param {any} data - 数据
   * @returns {Promise<any>} 更新的数据
   */
  async update(storeName, data) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.put({
        ...data,
        timestamp: Date.now()
      });

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB update success:', storeName);
        resolve(request.result);
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB update error:', request.error);
        reject(new Error('IndexedDB update failed'));
      };
    });
  }

  /**
   * 获取数据
   * @param {string} storeName - 存储名称
   * @param {any} key - 键
   * @returns {Promise<any>} 数据
   */
  async get(storeName, key) {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(key);

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB get success:', storeName);
        resolve(request.result);
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB get error:', request.error);
        reject(new Error('IndexedDB get failed'));
      };
    });
  }

  /**
   * 获取所有数据
   * @param {string} storeName - 存储名称
   * @param {Object} options - 查询选项
   * @returns {Promise<any[]>} 数据列表
   */
  async getAll(storeName, options = {}) {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      let request;

      if (options.index) {
        const index = store.index(options.index);
        const range = options.range || IDBKeyRange.lowerBound(0);
        request = index.openCursor(range);
      } else {
        request = store.openCursor();
      }

      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (options.filter ? options.filter(cursor.value) : true) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          storageLogger.debug('IndexedDB getAll success:', storeName);
          resolve(results);
        }
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB getAll error:', request.error);
        reject(new Error('IndexedDB getAll failed'));
      };
    });
  }

  /**
   * 删除数据
   * @param {string} storeName - 存储名称
   * @param {any} key - 键
   * @returns {Promise<void>}
   */
  async remove(storeName, key) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.delete(key);

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB remove success:', storeName);
        resolve();
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB remove error:', request.error);
        reject(new Error('IndexedDB remove failed'));
      };
    });
  }

  /**
   * 清空存储
   * @param {string} storeName - 存储名称
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.clear();

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB clear success:', storeName);
        resolve();
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB clear error:', request.error);
        reject(new Error('IndexedDB clear failed'));
      };
    });
  }

  /**
   * 计数
   * @param {string} storeName - 存储名称
   * @returns {Promise<number>} 数据数量
   */
  async count(storeName) {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.count();

      request.onsuccess = () => {
        storageLogger.debug('IndexedDB count success:', storeName);
        resolve(request.result);
      };

      request.onerror = () => {
        storageLogger.error('IndexedDB count error:', request.error);
        reject(new Error('IndexedDB count failed'));
      };
    });
  }
}

// 创建默认实例
export const localStorage = new LocalStorage();
export const indexedDB = new IndexedDBStorage();

// 导出便捷函数
export const setLocalItem = (key, value, ttl) => localStorage.set(key, value, ttl);
export const getLocalItem = (key, defaultValue) => localStorage.get(key, defaultValue);
export const removeLocalItem = (key) => localStorage.remove(key);
export const clearLocalItems = () => localStorage.clear();

export const addIndexedDBItem = (storeName, data) => indexedDB.add(storeName, data);
export const getIndexedDBItem = (storeName, key) => indexedDB.get(storeName, key);
export const getAllIndexedDBItems = (storeName, options) => indexedDB.getAll(storeName, options);
export const updateIndexedDBItem = (storeName, data) => indexedDB.update(storeName, data);
export const removeIndexedDBItem = (storeName, key) => indexedDB.remove(storeName, key);
export const clearIndexedDBStore = (storeName) => indexedDB.clear(storeName);