/**
 * DOM 操作工具函数
 */

import { logger } from '../core/logger.js';

/**
 * 等待 DOM 加载完成
 * @returns {Promise<void>}
 */
export function waitForDOMReady() {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
}

/**
 * 查询 DOM 元素
 * @param {string} selector - CSS 选择器
 * @param {Element} context - 查询上下文，默认为 document
 * @returns {Element|null} 找到的元素
 */
export function $(selector, context = document) {
  try {
    return context.querySelector(selector);
  } catch (error) {
    logger.warn('Invalid selector:', selector);
    return null;
  }
}

/**
 * 查询多个 DOM 元素
 * @param {string} selector - CSS 选择器
 * @param {Element} context - 查询上下文，默认为 document
 * @returns {NodeList} 找到的元素列表
 */
export function $$(selector, context = document) {
  try {
    return context.querySelectorAll(selector);
  } catch (error) {
    logger.warn('Invalid selector:', selector);
    return [];
  }
}

/**
 * 创建 DOM 元素
 * @param {string} tagName - 标签名
 * @param {Object} attributes - 属性对象
 * @param {string|Node|Node[]} children - 子元素
 * @returns {Element} 创建的元素
 */
export function createElement(tagName, attributes = {}, children = []) {
  const element = document.createElement(tagName);

  // 设置属性
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('data-') || key.startsWith('aria-')) {
      element.setAttribute(key, value);
    } else if (key in element) {
      element[key] = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  // 添加子元素
  if (typeof children === 'string') {
    element.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    });
  } else if (children instanceof Node) {
    element.appendChild(children);
  }

  return element;
}

/**
 * 添加事件监听器
 * @param {Element|Window|Document} target - 目标元素
 * @param {string} event - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {Object} options - 事件选项
 * @returns {Function} 移除监听器的函数
 */
export function on(target, event, handler, options = {}) {
  if (!target || typeof handler !== 'function') {
    logger.warn('Invalid event listener arguments');
    return () => {};
  }

  target.addEventListener(event, handler, options);

  return () => {
    target.removeEventListener(event, handler, options);
  };
}

/**
 * 添加一次性事件监听器
 * @param {Element|Window|Document} target - 目标元素
 * @param {string} event - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {Object} options - 事件选项
 */
export function once(target, event, handler, options = {}) {
  const onceHandler = (e) => {
    handler(e);
    target.removeEventListener(event, onceHandler, options);
  };

  target.addEventListener(event, onceHandler, options);
}

/**
 * 事件委托
 * @param {Element} container - 容器元素
 * @param {string} selector - 目标选择器
 * @param {string} event - 事件名称
 * @param {Function} handler - 事件处理函数
 * @returns {Function} 移除监听器的函数
 */
export function delegate(container, selector, event, handler) {
  const delegateHandler = (e) => {
    const target = e.target.closest(selector);
    if (target && container.contains(target)) {
      handler.call(target, e);
    }
  };

  container.addEventListener(event, delegateHandler);

  return () => {
    container.removeEventListener(event, delegateHandler);
  };
}

/**
 * 添加 CSS 类
 * @param {Element} element - 目标元素
 * @param {string|Array} classNames - 类名
 */
export function addClass(element, classNames) {
  if (!element || !element.classList) return;

  if (typeof classNames === 'string') {
    element.classList.add(...classNames.trim().split(/\s+/));
  } else if (Array.isArray(classNames)) {
    element.classList.add(...classNames.filter(Boolean));
  }
}

/**
 * 移除 CSS 类
 * @param {Element} element - 目标元素
 * @param {string|Array} classNames - 类名
 */
export function removeClass(element, classNames) {
  if (!element || !element.classList) return;

  if (typeof classNames === 'string') {
    element.classList.remove(...classNames.trim().split(/\s+/));
  } else if (Array.isArray(classNames)) {
    element.classList.remove(...classNames.filter(Boolean));
  }
}

/**
 * 切换 CSS 类
 * @param {Element} element - 目标元素
 * @param {string} className - 类名
 * @param {boolean} force - 强制添加或移除
 * @returns {boolean} 是否包含该类
 */
export function toggleClass(element, className, force) {
  if (!element || !element.classList) return false;
  return element.classList.toggle(className, force);
}

/**
 * 检查是否包含 CSS 类
 * @param {Element} element - 目标元素
 * @param {string} className - 类名
 * @returns {boolean} 是否包含该类
 */
export function hasClass(element, className) {
  if (!element || !element.classList) return false;
  return element.classList.contains(className);
}

/**
 * 设置元素样式
 * @param {Element} element - 目标元素
 * @param {Object|string} styles - 样式对象或属性名
 * @param {string} value - 样式值（当第一个参数为字符串时）
 */
export function setStyle(element, styles, value) {
  if (!element || !element.style) return;

  if (typeof styles === 'string') {
    element.style[styles] = value;
  } else if (typeof styles === 'object') {
    Object.entries(styles).forEach(([property, val]) => {
      element.style[property] = val;
    });
  }
}

/**
 * 获取元素样式
 * @param {Element} element - 目标元素
 * @param {string} property - 样式属性
 * @returns {string} 样式值
 */
export function getStyle(element, property) {
  if (!element) return '';

  if (element.style && element.style[property]) {
    return element.style[property];
  }

  const computedStyle = window.getComputedStyle(element);
  return computedStyle ? computedStyle[property] : '';
}

/**
 * 显示元素
 * @param {Element} element - 目标元素
 * @param {string} display - 显示类型，默认为 'block'
 */
export function show(element, display = 'block') {
  if (element) {
    element.style.display = display;
  }
}

/**
 * 隐藏元素
 * @param {Element} element - 目标元素
 */
export function hide(element) {
  if (element) {
    element.style.display = 'none';
  }
}

/**
 * 检查元素是否可见
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否可见
 */
export function isVisible(element) {
  if (!element) return false;
  return element.style.display !== 'none' &&
         element.style.visibility !== 'hidden' &&
         element.offsetParent !== null;
}

/**
 * 滚动到元素
 * @param {Element} element - 目标元素
 * @param {Object} options - 滚动选项
 */
export function scrollToElement(element, options = {}) {
  if (!element) return;

  const defaultOptions = {
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest'
  };

  element.scrollIntoView({ ...defaultOptions, ...options });
}

/**
 * 获取元素相对于视口的位置
 * @param {Element} element - 目标元素
 * @returns {Object} 位置信息
 */
export function getElementRect(element) {
  if (!element) return { top: 0, left: 0, width: 0, height: 0 };

  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom + window.scrollY,
    right: rect.right + window.scrollX
  };
}

/**
 * 检查元素是否在视口中
 * @param {Element} element - 目标元素
 * @param {number} threshold - 阈值（0-1）
 * @returns {boolean} 是否在视口中
 */
export function isInViewport(element, threshold = 0) {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  const vertInView = (rect.top <= windowHeight * (1 - threshold)) &&
                    ((rect.top + rect.height) >= windowHeight * threshold);
  const horInView = (rect.left <= windowWidth * (1 - threshold)) &&
                    ((rect.left + rect.width) >= windowWidth * threshold);

  return vertInView && horInView;
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} delay - 延迟时间
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} delay - 延迟时间
 * @returns {Function} 节流后的函数
 */
export function throttle(func, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func.apply(this, args);
    }
  };
}

/**
 * 等待元素出现
 * @param {string} selector - 选择器
 * @param {number} timeout - 超时时间
 * @returns {Promise<Element>} 找到的元素
 */
export function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = $(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = $(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}