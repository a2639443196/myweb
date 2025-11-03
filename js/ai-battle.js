const SAMPLE_RULES = `【示例模版】
1. 游戏目标：描述各 AI 需要达成的共同或对抗目标。
2. 回合流程：
   - 裁判概述局势并触发下一回合。
   - 按照 AI 列表顺序依次发言。
   - 裁判可以随时终止或调整规则。
3. 胜负判定：描述何种条件下游戏结束、谁获胜。
4. 特殊说明：列出禁止事项、时间限制或评分标准。
`;

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
  agents: [],
  room: null,
  history: [],
  isJudge: false,
  socket: null,
  reconnectTimer: null,
  shouldReconnect: true,
};

const elements = {
  authWarning: document.querySelector('[data-role="auth-warning"]'),
  creationSection: document.querySelector('[data-role="creation-section"]'),
  createForm: document.querySelector('[data-role="create-form"]'),
  createError: document.querySelector('[data-role="create-error"]'),
  agentList: document.querySelector('[data-role="agent-list"]'),
  fillTemplate: document.querySelector('[data-role="fill-template"]'),
  battleSection: document.querySelector('[data-role="battle-section"]'),
  roomTitle: document.querySelector('[data-role="room-title"]'),
  roomRules: document.querySelector('[data-role="room-rules"]'),
  judgeName: document.querySelector('[data-role="judge-name"]'),
  round: document.querySelector('[data-role="round"]'),
  participantList: document.querySelector('[data-role="participant-list"]'),
  judgeControls: document.querySelector('[data-role="judge-controls"]'),
  judgeMessage: document.querySelector('[data-role="judge-message"]'),
  triggerRound: document.querySelector('[data-role="trigger-round"]'),
  closeRoom: document.querySelector('[data-role="close-room"]'),
  roundError: document.querySelector('[data-role="round-error"]'),
  chatLog: document.querySelector('[data-role="chat-log"]'),
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
  toggleAuthWarning(!state.user);
};

const toggleAuthWarning = (visible) => {
  if (!elements.authWarning) return;
  elements.authWarning.hidden = !visible;
};

const loadAgents = async () => {
  try {
    const snapshot = await requestJSON('/api/battle/agents');
    state.agents = snapshot?.agents ?? [];
    renderAgentOptions();
  } catch (error) {
    console.error('加载 AI 列表失败', error);
  }
};

const fetchRoomState = async () => {
  try {
    const payload = await requestJSON('/api/battle/room');
    applyRoomPayload(payload);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      applyRoomPayload(null);
    } else {
      console.error('获取房间状态失败', error);
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

const renderAgentOptions = () => {
  if (!elements.agentList) return;
  elements.agentList.innerHTML = '';
  state.agents.forEach((agent) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = agent.id;
    checkbox.name = 'agentIds';
    const content = document.createElement('div');
    content.className = 'field__option-body';

    const title = document.createElement('strong');
    title.textContent = agent.displayName || agent.id;
    const meta = document.createElement('p');
    const provider = agent.provider ?? 'unknown';
    const description = agent.description ? ` · ${agent.description}` : '';
    meta.textContent = `${provider}${description}`;
    meta.style.margin = '4px 0 0';
    meta.style.fontSize = '0.82rem';
    meta.style.color = 'var(--muted)';

    content.append(title, meta);
    label.append(checkbox, content);
    elements.agentList.append(label);
  });
};

const updateLayout = () => {
  const hasRoom = Boolean(state.room);
  if (elements.battleSection) {
    elements.battleSection.hidden = !hasRoom;
  }
  if (hasRoom) {
    updateBattleSection();
  }
  updateCreationAvailability();
};

const updateCreationAvailability = () => {
  if (!elements.createForm) return;
  const hasRoom = Boolean(state.room);
  const disabled = hasRoom && !state.isJudge;
  const inputs = elements.createForm.querySelectorAll('input, textarea, button');
  inputs.forEach((element) => {
    if (element === elements.fillTemplate) return;
    element.disabled = disabled;
  });
  if (elements.createError) {
    if (disabled) {
      elements.createError.textContent = '当前已有房间在运行，仅裁判可管理。';
      elements.createError.hidden = false;
    } else {
      elements.createError.textContent = '';
      elements.createError.hidden = true;
    }
  }
};

const updateBattleSection = () => {
  const room = state.room;
  if (!room || !elements.battleSection) {
    if (elements.chatLog) elements.chatLog.innerHTML = '';
    return;
  }
  if (elements.roomTitle) {
    elements.roomTitle.textContent = room.gameName || '未命名对局';
  }
  if (elements.roomRules) {
    elements.roomRules.textContent = room.gameRules || '';
  }
  if (elements.judgeName) {
    elements.judgeName.textContent = room.judge?.username ?? '未知';
  }
  if (elements.round) {
    elements.round.textContent = String(room.round ?? 0);
  }
  renderParticipants(room.agents ?? []);
  renderHistory(state.history);
  if (elements.judgeControls) {
    elements.judgeControls.hidden = !state.isJudge;
  }
};

const renderParticipants = (participants) => {
  if (!elements.participantList) return;
  elements.participantList.innerHTML = '';
  participants.forEach((participant, index) => {
    const item = document.createElement('li');
    const title = document.createElement('div');
    title.textContent = `${index + 1}. ${participant.displayName ?? participant.id}`;
    const meta = document.createElement('small');
    meta.textContent = `${participant.provider ?? '未知来源'}${participant.description ? ` · ${participant.description}` : ''}`;
    meta.style.color = 'var(--muted)';
    item.append(title, meta);
    elements.participantList.append(item);
  });
};

const renderHistory = (history) => {
  if (!elements.chatLog) return;
  elements.chatLog.innerHTML = '';
  history.forEach((entry) => {
    const item = document.createElement('li');
    item.dataset.type = entry.type || 'system';

    const meta = document.createElement('div');
    meta.className = 'chat-log__meta';
    const author = document.createElement('span');
    author.textContent = `${entry.author ?? '系统'} · 第 ${entry.round ?? 0} 回合`;
    const time = document.createElement('span');
    time.textContent = formatTime(entry.createdAt);
    meta.append(author, time);

    const content = document.createElement('div');
    content.className = 'chat-log__content';
    content.textContent = entry.content ?? '';

    item.append(meta, content);
    elements.chatLog.append(item);
  });
  elements.chatLog.scrollTo({ top: elements.chatLog.scrollHeight, behavior: 'smooth' });
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

const collectSelectedAgents = () => {
  if (!elements.agentList) return [];
  return Array.from(elements.agentList.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
};

const handleCreate = async (event) => {
  event.preventDefault();
  if (!elements.createForm) return;
  const formData = new FormData(elements.createForm);
  const gameName = formData.get('gameName')?.toString().trim() ?? '';
  const gameRules = formData.get('gameRules')?.toString().trim() ?? '';
  const agentIds = collectSelectedAgents();

  if (agentIds.length < 4 || agentIds.length > 5) {
    showCreateError('请选择 4-5 个 AI。');
    return;
  }

  const payload = { gameName, gameRules, agentIds };
  try {
    setCreateDisabled(true);
    const result = await requestJSON('/api/battle/room', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    applyRoomPayload(result);
    showCreateError('');
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '创建房间失败';
    showCreateError(message);
  } finally {
    setCreateDisabled(false);
  }
};

const showCreateError = (message) => {
  if (!elements.createError) return;
  if (message) {
    elements.createError.textContent = message;
    elements.createError.hidden = false;
  } else {
    elements.createError.textContent = '';
    elements.createError.hidden = true;
  }
};

const setCreateDisabled = (disabled) => {
  if (!elements.createForm) return;
  elements.createForm.querySelectorAll('input, textarea, button').forEach((element) => {
    if (element === elements.fillTemplate) return;
    element.disabled = disabled;
  });
};

const handleRound = async () => {
  if (!state.isJudge) return;
  const judgeMessage = elements.judgeMessage?.value ?? '';
  try {
    setRoundDisabled(true);
    const result = await requestJSON('/api/battle/round', {
      method: 'POST',
      body: JSON.stringify({ judgeMessage }),
    });
    if (elements.judgeMessage) {
      elements.judgeMessage.value = '';
    }
    applyRoomPayload(result);
    showRoundError('');
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '触发回合失败';
    showRoundError(message);
  } finally {
    setRoundDisabled(false);
  }
};

const setRoundDisabled = (disabled) => {
  if (elements.triggerRound) {
    elements.triggerRound.disabled = disabled;
  }
  if (elements.closeRoom) {
    elements.closeRoom.disabled = disabled;
  }
  if (elements.judgeMessage) {
    elements.judgeMessage.disabled = disabled;
  }
};

const showRoundError = (message) => {
  if (!elements.roundError) return;
  if (message) {
    elements.roundError.textContent = message;
    elements.roundError.hidden = false;
  } else {
    elements.roundError.textContent = '';
    elements.roundError.hidden = true;
  }
};

const handleCloseRoom = async () => {
  if (!state.isJudge) return;
  try {
    setRoundDisabled(true);
    await requestJSON('/api/battle/room', { method: 'DELETE' });
    applyRoomPayload(null);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : '结束房间失败';
    showRoundError(message);
  } finally {
    setRoundDisabled(false);
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
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/battle`);
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
  elements.createForm?.addEventListener('submit', handleCreate);
  elements.fillTemplate?.addEventListener('click', () => {
    const textarea = elements.createForm?.querySelector('textarea[name="gameRules"]');
    if (textarea) {
      textarea.value = SAMPLE_RULES;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
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
  await loadAgents();
  await fetchRoomState();
  connectSocket();
};

bootstrap().catch((error) => {
  console.error('初始化失败', error);
});
