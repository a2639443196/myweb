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
  room: null,
  history: [],
  isJudge: false,
  socket: null,
  reconnectTimer: null,
  shouldReconnect: true,
};

const elements = {
  chatArea: document.querySelector('[data-role="chat-area"]'),
  emptyState: document.querySelector('[data-role="empty-state"]'),
  roomTitle: document.querySelector('[data-role="room-title"]'),
  phase: document.querySelector('[data-role="phase"]'),
  round: document.querySelector('[data-role="round"]'),
  judgeName: document.querySelector('[data-role="judge-name"]'),
  roomCreated: document.querySelector('[data-role="room-created"]'),
  roomBackground: document.querySelector('[data-role="room-background"]'),
  roomRules: document.querySelector('[data-role="room-rules"]'),
  chatLog: document.querySelector('[data-role="chat-log"]'),
  participantList: document.querySelector('[data-role="participant-list"]'),
  participantCount: document.querySelector('[data-role="participant-count"]'),
  judgeControls: document.querySelector('[data-role="judge-controls"]'),
  judgeMessage: document.querySelector('[data-role="judge-message"]'),
  triggerRound: document.querySelector('[data-role="trigger-round"]'),
  closeRoom: document.querySelector('[data-role="close-room"]'),
  roundError: document.querySelector('[data-role="round-error"]'),
  latestMessage: document.querySelector('[data-role="latest-message"]'),
  roomStatus: document.querySelector('[data-role="room-status"]'),
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

const fetchRoomState = async () => {
  try {
    const payload = await requestJSON('/api/werewolf/room');
    applyRoomPayload(payload);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      applyRoomPayload(null);
    } else {
      console.error('加载房间状态失败', error);
    }
  }
};

const applyRoomPayload = (payload) => {
  if (!payload) {
    state.room = null;
    state.history = [];
    state.isJudge = false;
  } else {
    state.room = payload.room;
    state.history = payload.history ?? [];
    state.isJudge = Boolean(state.user && payload.room?.judge?.id === state.user.id);
  }
  updateLayout();
};

const updateLayout = () => {
  const hasRoom = Boolean(state.room);
  if (elements.chatArea) {
    elements.chatArea.hidden = !hasRoom;
  }
  if (elements.emptyState) {
    elements.emptyState.hidden = hasRoom;
  }
  if (hasRoom) {
    updateChatArea();
  } else {
    clearChatArea();
    updateJudgeControls();
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
    elements.latestMessage.textContent = '暂无消息';
  }
  if (elements.roomStatus) {
    elements.roomStatus.textContent = '等待创建房间';
  }
  if (elements.phase) {
    elements.phase.textContent = '-';
  }
  if (elements.round) {
    elements.round.textContent = '0';
  }
  if (elements.roomBackground) {
    elements.roomBackground.textContent = '-';
  }
  if (elements.roomRules) {
    elements.roomRules.textContent = '如未填写特殊规则，则采用经典狼人杀流程。';
  }
};

const updateChatArea = () => {
  const room = state.room;
  if (!room) return;

  if (elements.roomTitle) {
    elements.roomTitle.textContent = room.gameName || '未命名的狼人村';
  }
  if (elements.round) {
    elements.round.textContent = String(room.day ?? 0);
  }
  if (elements.phase) {
    elements.phase.textContent = room.phaseTitle || room.phase || '未知阶段';
  }
  if (elements.judgeName) {
    elements.judgeName.textContent = room.judge?.username ?? '未知';
  }
  if (elements.roomCreated) {
    elements.roomCreated.textContent = formatDate(room.createdAt);
  }
  if (elements.roomBackground) {
    elements.roomBackground.textContent = room.background || '暂无背景信息。';
  }
  if (elements.roomRules) {
    elements.roomRules.textContent = room.specialRules?.trim()
      ? room.specialRules
      : '如未填写特殊规则，则采用经典狼人杀流程。';
  }

  renderParticipants(room.players ?? []);
  renderHistory(state.history);
  updateJudgeControls();
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
    title.textContent = `${index + 1}. ${participant.displayName ?? participant.id}`;

    const meta = document.createElement('span');
    const roleLabel = participant.role ? ` · 身份：${participant.role}` : '';
    const statusLabel = participant.alive ? '存活' : '出局';
    meta.textContent = `${statusLabel}${roleLabel}`;

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
    if (entry.type === 'judge') {
      avatar.classList.add('message__avatar--judge');
    } else if (entry.type === 'system') {
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
    message.append(avatar, body);
    elements.chatLog.append(message);
  });
  elements.chatLog.scrollTo({ top: elements.chatLog.scrollHeight, behavior: 'smooth' });
};

const updateJudgeControls = () => {
  if (!elements.judgeControls) return;
  elements.judgeControls.hidden = !state.isJudge;
  const disabled = !state.isJudge;
  if (elements.triggerRound) elements.triggerRound.disabled = disabled;
  if (elements.closeRoom) elements.closeRoom.disabled = disabled;
  if (elements.judgeMessage) elements.judgeMessage.disabled = disabled;
};

const updateRoomStats = () => {
  const room = state.room;
  if (!room) return;
  if (elements.latestMessage) {
    const lastEntry = state.history[state.history.length - 1];
    const summary = lastEntry?.content ? truncate(lastEntry.content, 120) : '暂无消息';
    elements.latestMessage.textContent = summary;
  }
  if (elements.roomStatus) {
    const phase = room.phaseTitle || room.phase;
    const day = room.day ?? 0;
    elements.roomStatus.textContent = `${phase ?? '未知阶段'} · 第 ${day} 天`;
  }
};

const truncate = (value, maxLength) => {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
};

const getAvatarInitial = (name) => {
  const text = name || '系统';
  const first = text.trim().charAt(0);
  return first || '系';
};

const formatMessageTag = (entry) => {
  const baseTag = (() => {
    switch (entry.type) {
      case 'ai':
        return 'AI 发言';
      case 'judge':
        return '主持人提示';
      case 'system':
      default:
        return '系统播报';
    }
  })();
  if (entry.phase) {
    return `${baseTag} · ${entry.phase}`;
  }
  if (entry.round) {
    return `${baseTag} · 第 ${entry.round} 天`;
  }
  return baseTag;
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

const handleRound = async () => {
  if (!state.isJudge) return;
  const judgeMessage = elements.judgeMessage?.value ?? '';
  try {
    setJudgeDisabled(true);
    const result = await requestJSON('/api/werewolf/advance', {
      method: 'POST',
      body: JSON.stringify({ judgeMessage }),
    });
    if (elements.judgeMessage) {
      elements.judgeMessage.value = '';
    }
    applyRoomPayload(result);
    showRoundError('');
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '推进阶段失败';
    showRoundError(message);
  } finally {
    setJudgeDisabled(false);
  }
};

const handleCloseRoom = async () => {
  if (!state.isJudge) return;
  try {
    setJudgeDisabled(true);
    await requestJSON('/api/werewolf/room', { method: 'DELETE' });
    applyRoomPayload(null);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '结束房间失败';
    showRoundError(message);
  } finally {
    setJudgeDisabled(false);
  }
};

const setJudgeDisabled = (disabled) => {
  if (elements.triggerRound) elements.triggerRound.disabled = disabled || !state.isJudge;
  if (elements.closeRoom) elements.closeRoom.disabled = disabled || !state.isJudge;
  if (elements.judgeMessage) elements.judgeMessage.disabled = disabled || !state.isJudge;
};

const showRoundError = (message) => {
  if (!elements.roundError) return;
  if (message) {
    elements.roundError.hidden = false;
    elements.roundError.textContent = message;
  } else {
    elements.roundError.hidden = true;
    elements.roundError.textContent = '';
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
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/werewolf`);
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
      if (data.type === 'room_state') {
        applyRoomPayload({ room: data.room, history: data.history });
      } else if (data.type === 'room_closed') {
        applyRoomPayload(null);
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
  elements.triggerRound?.addEventListener('click', handleRound);
  elements.closeRoom?.addEventListener('click', handleCloseRoom);
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
  await fetchRoomState();
  connectSocket();
};

bootstrap().catch((error) => {
  console.error('初始化失败', error);
});
