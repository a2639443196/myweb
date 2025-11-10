/**
 * 基础游戏类
 */

import { logger } from '../core/logger.js';
import { createElement, on, $, $$ } from '../utils/dom.js';
import { api } from '../modules/api.js';

const gameLogger = logger.child('Game');

/**
 * 基础游戏类
 */
export class BaseGame {
  constructor(options = {}) {
    this.name = options.name || 'BaseGame';
    this.version = options.version || '1.0.0';
    this.container = options.container || document.body;
    this.enabled = options.enabled !== false;
    this.debug = options.debug || false;

    // 游戏状态
    this.state = {
      isPlaying: false,
      isPaused: false,
      score: 0,
      startTime: null,
      endTime: null,
      moves: 0,
      mistakes: 0
    };

    // 配置
    this.config = {
      ...this.getDefaultConfig(),
      ...options.config
    };

    // 事件监听器清理数组
    this.eventCleanup = [];

    // 初始化
    this.init();
  }

  /**
   * 获取默认配置
   * @returns {Object} 默认配置
   */
  getDefaultConfig() {
    return {
      showTimer: true,
      showScore: true,
      showMoves: true,
      autoSave: true,
      soundEffects: true,
      animations: true
    };
  }

  /**
   * 初始化游戏
   */
  init() {
    gameLogger.debug(`Initializing game: ${this.name}`);
    this.createDOM();
    this.bindEvents();
    this.loadSettings();
    this.render();
  }

  /**
   * 创建游戏 DOM 结构
   */
  createDOM() {
    this.elements = {};

    // 游戏容器
    this.elements.container = createElement('div', {
      className: 'game-container',
      'data-game': this.name
    });

    // 游戏头部
    this.elements.header = createElement('div', {
      className: 'game-header'
    });

    // 游戏标题
    this.elements.title = createElement('h1', {
      className: 'game-title',
      textContent: this.name
    });

    // 游戏控制区
    this.elements.controls = createElement('div', {
      className: 'game-controls'
    });

    // 游戏状态区
    this.elements.status = createElement('div', {
      className: 'game-status'
    });

    // 游戏区域
    this.elements.gameArea = createElement('div', {
      className: 'game-area'
    });

    // 游戏消息区
    this.elements.message = createElement('div', {
      className: 'game-message',
      style: { display: 'none' }
    });

    // 组装结构
    this.elements.header.appendChild(this.elements.title);
    this.elements.container.appendChild(this.elements.header);
    this.elements.container.appendChild(this.elements.controls);
    this.elements.container.appendChild(this.elements.status);
    this.elements.container.appendChild(this.elements.gameArea);
    this.elements.container.appendChild(this.elements.message);

    // 插入到指定容器
    if (this.container) {
      this.container.appendChild(this.elements.container);
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 开始按钮
    this.elements.startButton = this.createButton('开始游戏', () => this.start());
    this.elements.controls.appendChild(this.elements.startButton);

    // 重置按钮
    this.elements.resetButton = this.createButton('重置', () => this.reset());
    this.elements.controls.appendChild(this.elements.resetButton);

    // 暂停按钮
    if (this.config.allowPause) {
      this.elements.pauseButton = this.createButton('暂停', () => this.togglePause());
      this.elements.controls.appendChild(this.elements.pauseButton);
    }

    // 键盘事件
    const keydownHandler = (e) => this.handleKeydown(e);
    this.eventCleanup.push(on(document, 'keydown', keydownHandler));

    // 页面可见性变化
    const visibilityHandler = () => this.handleVisibilityChange();
    this.eventCleanup.push(on(document, 'visibilitychange', visibilityHandler));
  }

  /**
   * 创建按钮
   * @param {string} text - 按钮文本
   * @param {Function} handler - 点击处理函数
   * @param {string} className - CSS 类名
   * @returns {HTMLButtonElement} 按钮元素
   */
  createButton(text, handler, className = 'game-button') {
    return createElement('button', {
      className,
      textContent: text,
      onclick: handler
    });
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      // 从本地存储加载设置
      const settings = localStorage.getItem(`game_${this.name}_settings`);
      if (settings) {
        this.config = { ...this.config, ...JSON.parse(settings) };
      }
    } catch (error) {
      gameLogger.warn('Failed to load settings:', error);
    }
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    try {
      localStorage.setItem(`game_${this.name}_settings`, JSON.stringify(this.config));
    } catch (error) {
      gameLogger.warn('Failed to save settings:', error);
    }
  }

  /**
   * 渲染游戏
   */
  render() {
    this.renderStatus();
    this.renderControls();
    this.renderGameArea();
  }

  /**
   * 渲染状态显示
   */
  renderStatus() {
    this.elements.status.innerHTML = '';

    // 计时器
    if (this.config.showTimer) {
      const timerElement = createElement('div', {
        className: 'game-stat'
      });
      const timerLabel = createElement('span', {
        className: 'game-stat-label',
        textContent: '时间'
      });
      const timerValue = createElement('span', {
        className: 'game-stat-value game-timer',
        textContent: this.formatTime()
      });
      timerElement.appendChild(timerLabel);
      timerElement.appendChild(timerValue);
      this.elements.status.appendChild(timerElement);
      this.elements.timerValue = timerValue;
    }

    // 得分
    if (this.config.showScore) {
      const scoreElement = createElement('div', {
        className: 'game-stat'
      });
      const scoreLabel = createElement('span', {
        className: 'game-stat-label',
        textContent: '得分'
      });
      const scoreValue = createElement('span', {
        className: 'game-stat-value game-score',
        textContent: this.state.score.toString()
      });
      scoreElement.appendChild(scoreLabel);
      scoreElement.appendChild(scoreValue);
      this.elements.status.appendChild(scoreElement);
      this.elements.scoreValue = scoreValue;
    }

    // 步数
    if (this.config.showMoves) {
      const movesElement = createElement('div', {
        className: 'game-stat'
      });
      const movesLabel = createElement('span', {
        className: 'game-stat-label',
        textContent: '步数'
      });
      const movesValue = createElement('span', {
        className: 'game-stat-value',
        textContent: this.state.moves.toString()
      });
      movesElement.appendChild(movesLabel);
      movesElement.appendChild(movesValue);
      this.elements.status.appendChild(movesValue);
      this.elements.movesValue = movesValue;
    }
  }

  /**
   * 渲染控制按钮
   */
  renderControls() {
    if (this.elements.startButton) {
      this.elements.startButton.textContent = this.state.isPlaying ? '重新开始' : '开始游戏';
      this.elements.startButton.disabled = !this.enabled;
    }

    if (this.elements.pauseButton) {
      this.elements.pauseButton.textContent = this.state.isPaused ? '继续' : '暂停';
      this.elements.pauseButton.disabled = !this.state.isPlaying;
    }

    if (this.elements.resetButton) {
      this.elements.resetButton.disabled = this.state.isPlaying;
    }
  }

  /**
   * 渲染游戏区域（子类实现）
   */
  renderGameArea() {
    // 子类实现
    this.elements.gameArea.innerHTML = `
      <div class="game-placeholder">
        <p>游戏内容将由子类实现</p>
      </div>
    `;
  }

  /**
   * 开始游戏
   */
  start() {
    if (this.state.isPlaying && !confirm('确定要重新开始游戏吗？')) {
      return;
    }

    gameLogger.info(`Starting game: ${this.name}`);

    this.reset();
    this.state.isPlaying = true;
    this.state.startTime = Date.now();

    this.onStart();
    this.render();
    this.startTimer();

    this.emit('game:start');
  }

  /**
   * 暂停/继续游戏
   */
  togglePause() {
    if (!this.state.isPlaying) return;

    this.state.isPaused = !this.state.isPaused;

    if (this.state.isPaused) {
      this.stopTimer();
      this.onPause();
      this.showMessage('游戏已暂停');
    } else {
      this.startTimer();
      this.onResume();
      this.hideMessage();
    }

    this.renderControls();
    this.emit('game:pause', { paused: this.state.isPaused });
  }

  /**
   * 重置游戏
   */
  reset() {
    gameLogger.debug(`Resetting game: ${this.name}`);

    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.score = 0;
    this.state.startTime = null;
    this.state.endTime = null;
    this.state.moves = 0;
    this.state.mistakes = 0;

    this.stopTimer();
    this.hideMessage();
    this.onReset();
    this.render();

    this.emit('game:reset');
  }

  /**
   * 结束游戏
   */
  end() {
    if (!this.state.isPlaying) return;

    gameLogger.info(`Ending game: ${this.name}`);

    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.endTime = Date.now();

    this.stopTimer();
    this.onEnd();
    this.renderControls();

    const duration = this.state.endTime - this.state.startTime;
    this.showResults(duration);

    this.emit('game:end', {
      score: this.state.score,
      duration,
      moves: this.state.moves,
      mistakes: this.state.mistakes
    });
  }

  /**
   * 显示游戏结果
   * @param {number} duration - 游戏时长
   */
  showResults(duration) {
    const results = this.calculateResults(duration);
    const resultElement = this.createResultElement(results);

    this.elements.gameArea.appendChild(resultElement);

    // 自动保存成绩
    if (this.config.autoSave && results.isValid) {
      this.saveScore(results);
    }
  }

  /**
   * 计算游戏结果（子类实现）
   * @param {number} duration - 游戏时长
   * @returns {Object} 游戏结果
   */
  calculateResults(duration) {
    return {
      score: this.state.score,
      duration,
      moves: this.state.moves,
      mistakes: this.state.mistakes,
      isValid: duration > 0
    };
  }

  /**
   * 创建结果显示元素
   * @param {Object} results - 游戏结果
   * @returns {HTMLElement} 结果元素
   */
  createResultElement(results) {
    const container = createElement('div', {
      className: 'game-result'
    });

    const title = createElement('h2', {
      className: 'game-result-title',
      textContent: '游戏结束！'
    });

    const stats = createElement('div', {
      className: 'game-result-stats'
    });

    // 得分
    if (this.config.showScore) {
      const scoreStat = createElement('div', {
        className: 'game-result-stat'
      });
      scoreStat.appendChild(createElement('span', {
        className: 'game-result-label',
        textContent: '得分'
      }));
      scoreStat.appendChild(createElement('span', {
        className: 'game-result-value',
        textContent: results.score.toString()
      }));
      stats.appendChild(scoreStat);
    }

    // 时间
    const timeStat = createElement('div', {
      className: 'game-result-stat'
    });
    timeStat.appendChild(createElement('span', {
      className: 'game-result-label',
      textContent: '用时'
    }));
    timeStat.appendChild(createElement('span', {
      className: 'game-result-value',
      textContent: this.formatTime(results.duration)
    }));
    stats.appendChild(timeStat);

    // 步数
    if (this.config.showMoves) {
      const movesStat = createElement('div', {
        className: 'game-result-stat'
      });
      movesStat.appendChild(createElement('span', {
        className: 'game-result-label',
        textContent: '步数'
      }));
      movesStat.appendChild(createElement('span', {
        className: 'game-result-value',
        textContent: results.moves.toString()
      }));
      stats.appendChild(movesStat);
    }

    // 关闭按钮
    const closeButton = createElement('button', {
      className: 'game-button',
      textContent: '关闭',
      onclick: () => container.remove()
    });

    container.appendChild(title);
    container.appendChild(stats);
    container.appendChild(closeButton);

    return container;
  }

  /**
   * 保存分数（子类实现）
   * @param {Object} results - 游戏结果
   */
  async saveScore(results) {
    // 子类实现具体的保存逻辑
    gameLogger.debug('Saving score:', results);
  }

  /**
   * 启动计时器
   */
  startTimer() {
    if (this.timerInterval) return;

    this.timerInterval = setInterval(() => {
      this.updateTimer();
    }, 100);
  }

  /**
   * 停止计时器
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * 更新计时器显示
   */
  updateTimer() {
    if (this.elements.timerValue && this.state.startTime) {
      const elapsed = this.state.isPaused
        ? this.pausedDuration
        : Date.now() - this.state.startTime + (this.pausedDuration || 0);

      this.elements.timerValue.textContent = this.formatTime(elapsed);
    }
  }

  /**
   * 格式化时间
   * @param {number} milliseconds - 毫秒数
   * @returns {string} 格式化的时间字符串
   */
  formatTime(milliseconds = 0) {
    if (!milliseconds && this.state.startTime) {
      milliseconds = this.state.isPaused
        ? this.pausedDuration
        : Date.now() - this.state.startTime + (this.pausedDuration || 0);
    }

    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const ms = Math.floor((milliseconds % 1000) / 100);

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms}`;
  }

  /**
   * 显示消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型
   */
  showMessage(message, type = 'info') {
    this.elements.message.textContent = message;
    this.elements.message.className = `game-message ${type}`;
    this.elements.message.style.display = 'block';
  }

  /**
   * 隐藏消息
   */
  hideMessage() {
    this.elements.message.style.display = 'none';
  }

  /**
   * 更新分数
   * @param {number} score - 新分数
   */
  updateScore(score) {
    this.state.score = score;
    if (this.elements.scoreValue) {
      this.elements.scoreValue.textContent = score.toString();
    }
    this.emit('game:score', { score });
  }

  /**
   * 增加步数
   */
  incrementMoves() {
    this.state.moves++;
    if (this.elements.movesValue) {
      this.elements.movesValue.textContent = this.state.moves.toString();
    }
    this.emit('game:move');
  }

  /**
   * 增加错误次数
   */
  incrementMistakes() {
    this.state.mistakes++;
    this.emit('game:mistake');
  }

  /**
   * 处理键盘事件（子类可重写）
   * @param {KeyboardEvent} e - 键盘事件
   */
  handleKeydown(e) {
    if (e.key === 'Escape') {
      if (this.state.isPlaying) {
        this.togglePause();
      }
    }
  }

  /**
   * 处理页面可见性变化
   */
  handleVisibilityChange() {
    if (document.hidden && this.state.isPlaying && !this.state.isPaused) {
      this.togglePause();
      this.showMessage('游戏已自动暂停');
    }
  }

  /**
   * 生命周期钩子（子类可重写）
   */
  onStart() {
    // 子类实现
  }

  onPause() {
    // 子类实现
    this.pausedDuration = Date.now() - this.state.startTime;
  }

  onResume() {
    // 子类实现
    this.state.startTime = Date.now() - this.pausedDuration;
  }

  onReset() {
    // 子类实现
    this.pausedDuration = 0;
  }

  onEnd() {
    // 子类实现
  }

  /**
   * 事件发射器
   */
  emit(eventName, data = {}) {
    const event = new CustomEvent(eventName, {
      detail: { game: this.name, ...data }
    });
    this.elements.container.dispatchEvent(event);
  }

  /**
   * 监听事件
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  on(eventName, handler) {
    this.eventCleanup.push(on(this.elements.container, eventName, handler));
  }

  /**
   * 销毁游戏
   */
  destroy() {
    gameLogger.debug(`Destroying game: ${this.name}`);

    // 停止游戏
    if (this.state.isPlaying) {
      this.end();
    }

    // 清理事件监听器
    this.eventCleanup.forEach(cleanup => cleanup());
    this.eventCleanup = [];

    // 移除 DOM 元素
    if (this.elements.container && this.elements.container.parentNode) {
      this.elements.container.parentNode.removeChild(this.elements.container);
    }

    // 清理引用
    this.elements = {};
    this.timerInterval = null;

    this.emit('game:destroy');
  }

  /**
   * 启用/禁用游戏
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.renderControls();
  }

  /**
   * 调试日志
   * @param {any} args - 日志参数
   */
  debug(...args) {
    if (this.debug) {
      gameLogger.debug(`[${this.name}]`, ...args);
    }
  }
}

export default BaseGame;