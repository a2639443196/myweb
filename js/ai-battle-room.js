class HttpError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.payload = payload;
  }
}

const state = {
  user: null,
  game: null,
  history: [],
  isCreator: false,
  socket: null,
  reconnectTimer: null,
  shouldReconnect: true,
  isStarting: false,
};

const elements = {
  chatArea: document.querySelector('[data-role="chat-area"]'),
  emptyState: document.querySelector('[data-role="empty-state"]'),
  roomTitle: document.querySelector('[data-role="room-title"]'),
  phase: document.querySelector('[data-role="phase"]'),
  round: document.querySelector('[data-role="round"]'),
  targetCard: document.querySelector('[data-role="target-card"]'),
  judgeName: document.querySelector('[data-role="judge-name"]'),
  roomCreated: document.querySelector('[data-role="room-created"]'),
  roomBackground: document.querySelector('[data-role="room-background"]'),
  chatLog: document.querySelector('[data-role="chat-log"]'),
  participantList: document.querySelector('[data-role="participant-list"]'),
  participantCount: document.querySelector('[data-role="participant-count"]'),
  judgeControls: document.querySelector('[data-role="judge-controls"]'),
  closeRoom: document.querySelector('[data-role="close-room"]'),
  roundError: document.querySelector('[data-role="round-error"]'),
  latestMessage: document.querySelector('[data-role="latest-message"]'),
  roomStatus: document.querySelector('[data-role="room-status"]'),
  autoStartButton: document.querySelector('[data-role="auto-start"]'),
  autoStartError: document.querySelector('[data-role="auto-start-error"]'),
};

const requestJSON = async (url, options = {}) => {
  const init = { ...options };
  init.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(url, init);
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
  }
  if (!response.ok) {
    const message = data?.error || `请求失败 (${response.status})`;
    throw new HttpError(message, response.status, data);
  }
  return data;
};

const fetchSession = async () => {
  try {
    const result = await requestJSON('/api/session');
    state.user = result?.user ?? null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      state.user = null;
    } else {
      console.error('获取会话失败', error);
    }
  }
};

const fetchGameState = async () => {
  try {
    const snapshot = await requestJSON('/api/liars-bar/game');
    applyGameSnapshot(snapshot);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      applyGameSnapshot(null);
    } else {
      console.error('加载对局状态失败', error);
    }
  }
};

const applyGameSnapshot = (payload) => {
  if (!payload || !payload.game) {
    state.game = null;
    state.history = [];
    state.isCreator = false;
  } else {
    state.game = payload.game;
    state.history = payload.history ?? [];
    state.isCreator = Boolean(
      state.user && payload.game?.creator?.id && payload.game.creator.id === state.user.id,
    );
  }
  updateLayout();
};

const updateLayout = () => {
  const hasGame = Boolean(state.game);
  if (elements.chatArea) {
    elements.chatArea.hidden = !hasGame;
  }
  if (elements.emptyState) {
    elements.emptyState.hidden = hasGame;
  }
  if (hasGame) {
    updateChatArea();
  } else {
    clearChatArea();
    updateControls();
    updateAutoStartControls();
  }
};

const clearChatArea = () => {
  if (elements.chatLog) {
    elements.chatLog.innerHTML = '';
  }
  if (elements.participantList) {
    elements.participantList.innerHTML = '';
  }
  if (elements.participantCount) {
    elements.participantCount.textContent = '0';
  }
  if (elements.latestMessage) {
    elements.latestMessage.textContent = '-';
  }
  if (elements.roomStatus) {
    elements.roomStatus.textContent = '-';
  }
  if (elements.phase) {
    elements.phase.textContent = '-';
  }
  if (elements.round) {
    elements.round.textContent = '0';
  }
  if (elements.targetCard) {
    elements.targetCard.textContent = '-';
  }
  if (elements.roomBackground) {
    elements.roomBackground.textContent = '-';
  }
  if (elements.roomTitle) {
    elements.roomTitle.textContent = '骗子酒馆对决';
  }
  if (elements.judgeName) {
    elements.judgeName.textContent = '-';
  }
  if (elements.roomCreated) {
    elements.roomCreated.textContent = '-';
  }
};

const updateChatArea = () => {
  const game = state.game;
  if (!game) return;

  if (elements.roomTitle) {
    elements.roomTitle.textContent = game.title?.trim() || '未命名的骗子酒馆';
  }
  if (elements.phase) {
    elements.phase.textContent = formatStatus(game.status);
  }
  if (elements.round) {
    elements.round.textContent = String(game.round ?? 0);
  }
  if (elements.targetCard) {
    elements.targetCard.textContent = game.targetCard ? String(game.targetCard) : '未揭晓';
  }
  if (elements.judgeName) {
    elements.judgeName.textContent = game.creator?.username ?? '未知';
  }
  if (elements.roomCreated) {
    elements.roomCreated.textContent = formatDate(game.createdAt);
  }
  if (elements.roomBackground) {
    elements.roomBackground.textContent = game.scenario?.trim() || '暂无场景描述。';
  }

  renderParticipants(game.players ?? []);
  renderHistory(state.history);
  updateControls();
  updateRoomStats();
};

const renderParticipants = (participants) => {
  if (!elements.participantList) return;
  elements.participantList.innerHTML = '';
  participants.forEach((participant, index) => {
    const item = document.createElement('li');
    item.className = 'participant-list__item';
    if (!participant.alive) {
      item.classList.add('participant-list__item--dead');
    }

    const title = document.createElement('strong');
    title.textContent = `${index + 1}. ${participant.name ?? participant.agentId}`;

    const meta = document.createElement('span');
    const providerLabel = participant.provider ? ` · ${participant.provider}` : '';
    const modelLabel = participant.model ? ` · ${participant.model}` : '';
    const statusLabel = participant.alive ? '存活' : '出局';
    meta.textContent = `${statusLabel} · 手牌 ${participant.handSize ?? 0} 张${providerLabel}${modelLabel}`;

    item.append(title, meta);
    elements.participantList.append(item);
  });
  if (elements.participantCount) {
    elements.participantCount.textContent = String(participants.length);
  }
};

const renderHistory = (history) => {
  if (!elements.chatLog) return;
  elements.chatLog.innerHTML = '';
  history.forEach((entry) => {
    const message = document.createElement('li');
    message.className = `message message--${entry.type || 'system'}`;

    const avatar = document.createElement('div');
    avatar.className = 'message__avatar';
    if (entry.type === 'play') {
      avatar.classList.add('message__avatar--ai');
    } else if (entry.type === 'challenge') {
      avatar.classList.add('message__avatar--judge');
    } else if (entry.type === 'penalty') {
      avatar.classList.add('message__avatar--system');
    }
    avatar.textContent = getAvatarInitial(entry.author);

    const body = document.createElement('div');
    body.className = 'message__body';

    const meta = document.createElement('div');
    meta.className = 'message__meta';

    const author = document.createElement('span');
    author.className = 'message__author';
    author.textContent = entry.author ?? '系统';

    const tag = document.createElement('span');
    tag.className = 'message__tag';
    tag.textContent = formatMessageTag(entry);

    const timestamp = document.createElement('time');
    timestamp.className = 'message__timestamp';
    timestamp.dateTime = entry.createdAt ?? '';
    timestamp.textContent = formatTime(entry.createdAt);

    meta.append(author, tag, timestamp);

    const content = document.createElement('p');
    content.className = 'message__content';
    content.textContent = entry.content ?? '';

    body.append(meta, content);

    if (entry.thinking) {
      const details = document.createElement('details');
      details.className = 'message__thinking';
      const summary = document.createElement('summary');
      summary.textContent = '查看推理过程';
      const pre = document.createElement('pre');
      pre.textContent = entry.thinking;
      details.append(summary, pre);
      body.append(details);
    }

    message.append(avatar, body);
    elements.chatLog.append(message);
  });
  elements.chatLog.scrollTo({ top: elements.chatLog.scrollHeight, behavior: 'smooth' });
};

const updateControls = () => {
  if (!elements.judgeControls) return;
  const hasGame = Boolean(state.game);
  const gameActive = hasGame && ['running', 'preparing'].includes(state.game.status ?? '');
  const visible = state.isCreator && gameActive;
  elements.judgeControls.hidden = !visible;
  if (elements.closeRoom) {
    elements.closeRoom.disabled = !visible;
  }
};

const updateAutoStartControls = () => {
  if (!elements.autoStartButton) return;
  elements.autoStartButton.disabled = state.isStarting;
  if (state.isStarting) {
    elements.autoStartButton.textContent = '正在开局…';
  } else {
    elements.autoStartButton.textContent = '立即开局';
  }
  if (!state.isStarting) {
    hideAutoStartError();
  }
};

const updateRoomStats = () => {
  const game = state.game;
  if (!game) return;
  if (elements.roomStatus) {
    elements.roomStatus.textContent = `第 ${game.round ?? 0} 轮`;
  }
  if (elements.latestMessage) {
    const current = game.currentPlayer || (state.history[state.history.length - 1]?.author ?? '-');
    elements.latestMessage.textContent = current || '-';
  }
};

const getAvatarInitial = (name) => {
  const text = name || '系统';
  const first = text.trim().charAt(0);
  return first || '系';
};

const formatMessageTag = (entry) => {
  switch (entry.type) {
    case 'play':
      return '出牌动作';
    case 'challenge':
      return '质疑判定';
    case 'penalty':
      return '惩罚阶段';
    case 'reflection':
      return '轮次反思';
    case 'system_challenge':
      return '系统介入';
    case 'game_finished':
      return '胜负揭晓';
    default:
      return '系统播报';
  }
};

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatStatus = (status) => {
  switch ((status || '').toLowerCase()) {
    case 'running':
      return '进行中';
    case 'preparing':
      return '准备中';
    case 'finished':
      return '已结束';
    case 'stopped':
      return '已终止';
    case 'error':
      return '异常';
    default:
      return '未知';
  }
};

const handleCloseRoom = async () => {
  if (!state.isCreator) return;
  try {
    setControlsDisabled(true);
    await requestJSON('/api/liars-bar/game', { method: 'DELETE' });
    applyGameSnapshot(null);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '结束对局失败';
    showControlError(message);
  } finally {
    setControlsDisabled(false);
  }
};

const setControlsDisabled = (disabled) => {
  if (elements.closeRoom) elements.closeRoom.disabled = disabled || !state.isCreator;
};

const showControlError = (message) => {
  if (!elements.roundError) return;
  if (message) {
    elements.roundError.hidden = false;
    elements.roundError.textContent = message;
  } else {
    elements.roundError.hidden = true;
    elements.roundError.textContent = '';
  }
};

const showAutoStartError = (message) => {
  if (!elements.autoStartError) return;
  if (message) {
    elements.autoStartError.hidden = false;
    elements.autoStartError.textContent = message;
  } else {
    hideAutoStartError();
  }
};

const hideAutoStartError = () => {
  if (!elements.autoStartError) return;
  elements.autoStartError.hidden = true;
  elements.autoStartError.textContent = '';
};

const ensureGameStarted = async () => {
  if (state.isStarting) return;
  try {
    state.isStarting = true;
    updateAutoStartControls();
    const snapshot = await requestJSON('/api/liars-bar/game/auto-start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (snapshot?.game) {
      hideAutoStartError();
      applyGameSnapshot(snapshot);
    } else {
      await fetchGameState();
    }
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '启动对局失败';
    showAutoStartError(message);
  } finally {
    state.isStarting = false;
    updateAutoStartControls();
  }
};

const connectSocket = () => {
  if (state.socket) {
    state.shouldReconnect = false;
    state.socket.__skipReconnect = true;
    state.socket.close();
  }
  state.shouldReconnect = true;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/liars-bar`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'game_state') {
        applyGameSnapshot({ game: data.game, history: data.history });
      }
    } catch (error) {
      console.error('解析 WebSocket 消息失败', error);
    }
  });

  socket.addEventListener('close', () => {
    if (socket.__skipReconnect) return;
    if (!state.shouldReconnect) return;
    if (state.reconnectTimer) return;
    state.reconnectTimer = window.setTimeout(connectSocket, 2000);
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
};

const initEvents = () => {
  elements.closeRoom?.addEventListener('click', handleCloseRoom);
  elements.autoStartButton?.addEventListener('click', ensureGameStarted);
  window.addEventListener('pagehide', () => {
    state.shouldReconnect = false;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.socket?.close();
  });
};

const bootstrap = async () => {
  initEvents();
  await fetchSession();
  await fetchGameState();
  connectSocket();
};

bootstrap().catch((error) => {
  console.error('初始化失败', error);
});
