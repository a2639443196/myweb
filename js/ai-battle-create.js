const TEMPLATE = {
  objective:
    '人类殖民舰队抵达火星轨道，四支 AI 顾问团队需要在 12 小时内提交联合行动方案，以确保首次登陆成功并维持殖民地的长期可持续性。',
  rules: `回合流程：\n1. 裁判发布局势更新或新的约束条件。\n2. AI 按照编号顺序依次发言，需在上一位发言基础上推进策略。\n3. 每回合至少给出一个可执行的决策或评估指标。\n限制：\n- 禁止出现不切实际的超光速、瞬移等设定。\n- 回应需包含推理链或资源评估。`,
  winCondition:
    '当团队提交的联合方案满足能源自足、资源补给、安全登陆、生态循环四项指标且经过至少两轮交叉验证时结束博弈，由裁判宣布达成目标。',
  specialNotes:
    '初始资源：三艘登陆舱、两套核能模块、可部署温室系统一套。环境风暴将在 18 小时后抵达。',
  openingBrief:
    '当前时间为火星日出前 4 小时，轨道监测到南半球即将形成的沙尘暴。请各团队就登陆地点选择与能源部署给出首轮建议。',
};

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
  submitting: false,
};

const elements = {
  authWarning: document.querySelector('[data-role="auth-warning"]'),
  form: document.querySelector('[data-role="create-form"]'),
  createError: document.querySelector('[data-role="create-error"]'),
  agentList: document.querySelector('[data-role="agent-list"]'),
  fillTemplate: document.querySelector('[data-role="fill-template"]'),
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
  if (elements.authWarning) {
    elements.authWarning.hidden = !visible;
  }
  updateFormAvailability(!visible);
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

const renderAgentOptions = () => {
  if (!elements.agentList) return;
  elements.agentList.innerHTML = '';
  state.agents.forEach((agent) => {
    const card = document.createElement('label');
    card.className = 'agent-card';
    const providerKey = (agent.provider || 'ai').toString().toLowerCase();
    card.dataset.provider = providerKey;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = agent.id;
    checkbox.name = 'agentIds';
    checkbox.className = 'agent-card__checkbox';

    checkbox.addEventListener('change', () => {
      card.classList.toggle('agent-card--checked', checkbox.checked);
    });

    const defaultSelected = agent.default_selected ?? agent.defaultSelected ?? false;
    if (defaultSelected) {
      checkbox.checked = true;
      card.classList.add('agent-card--checked');
    }

    const badge = document.createElement('span');
    badge.className = 'agent-card__badge';
    const badgeLabel = agent.badge_label || agent.badgeLabel || agent.provider || 'AI';
    badge.textContent = badgeLabel;

    const title = document.createElement('div');
    title.className = 'agent-card__title';
    title.textContent = agent.displayName || agent.id;

    const meta = document.createElement('p');
    meta.className = 'agent-card__meta';
    const provider = agent.provider ?? '未注明提供方';
    const providerLabel = badgeLabel || provider;
    meta.textContent = `${providerLabel} · ${agent.id}`;

    const description = document.createElement('p');
    description.className = 'agent-card__description';
    description.textContent = agent.description || '暂无简介';

    card.append(checkbox, badge, title, meta, description);

    if (Array.isArray(agent.strengths) && agent.strengths.length) {
      const list = document.createElement('ul');
      list.className = 'agent-card__strengths';
      agent.strengths.forEach((text) => {
        const label = text?.toString().trim();
        if (!label) return;
        const item = document.createElement('li');
        item.textContent = label;
        list.append(item);
      });
      if (list.childElementCount > 0) {
        card.append(list);
      }
    }

    elements.agentList.append(card);
  });
};

const collectSelectedAgents = () => {
  if (!elements.agentList) return [];
  return Array.from(
    elements.agentList.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => input.value);
};

const handleCreate = async (event) => {
  event.preventDefault();
  if (!elements.form || state.submitting) return;

  const formData = new FormData(elements.form);
  const gameName = formData.get('gameName')?.toString().trim() ?? '';
  const objective = formData.get('gameObjective')?.toString().trim() ?? '';
  const rules = formData.get('gameRules')?.toString().trim() ?? '';
  const winCondition = formData.get('winCondition')?.toString().trim() ?? '';
  const notes = formData.get('specialNotes')?.toString().trim() ?? '';
  const openingBrief = formData.get('openingBrief')?.toString().trim() ?? '';
  const agentIds = collectSelectedAgents();

  if (!gameName) {
    showCreateError('请输入博弈名称。');
    return;
  }
  if (!objective || !rules || !winCondition) {
    showCreateError('请完整填写目标、规则与胜利条件。');
    return;
  }
  if (agentIds.length < 4 || agentIds.length > 5) {
    showCreateError('请选择 4-5 名参赛 AI。');
    return;
  }

  const gameRules = composeRules({ objective, rules, winCondition, notes });
  const payload = { gameName, gameRules, agentIds };

  try {
    setSubmitting(true);
    const result = await requestJSON('/api/battle/room', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!result) {
      throw new Error('房间创建失败，请稍后再试。');
    }
    await triggerFirstRound(openingBrief);
    showCreateError('');
    window.location.href = 'ai-battle-room.html';
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) {
        showCreateError('未登录或会话已过期，请先登录后再操作。');
      } else if (error.status === 409) {
        showCreateError('当前已存在运行中的房间，请先在聊天室结束后再尝试。');
      } else {
        showCreateError(error.message);
      }
    } else {
      showCreateError(error?.message || '创建房间失败');
    }
  } finally {
    setSubmitting(false);
  }
};

const composeRules = ({ objective, rules, winCondition, notes }) => {
  const lines = [
    `【博弈目标】\n${objective}`,
    `\n【关键规则】\n${rules}`,
    `\n【胜利条件】\n${winCondition}`,
  ];
  if (notes) {
    lines.push(`\n【限制与资源】\n${notes}`);
  }
  return lines.join('\n');
};

const triggerFirstRound = async (openingBrief) => {
  try {
    await requestJSON('/api/battle/round', {
      method: 'POST',
      body: JSON.stringify({ judgeMessage: openingBrief }),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(`首回合触发失败：${error.message}`, error.status, error.payload);
    }
    throw error;
  }
};

const showCreateError = (message) => {
  if (!elements.createError) return;
  if (message) {
    elements.createError.hidden = false;
    elements.createError.textContent = message;
  } else {
    elements.createError.hidden = true;
    elements.createError.textContent = '';
  }
};

const setSubmitting = (submitting) => {
  state.submitting = submitting;
  if (!elements.form) return;
  if (submitting) {
    elements.form.querySelectorAll('input, textarea, button').forEach((element) => {
      element.disabled = true;
    });
  } else {
    updateFormAvailability(Boolean(state.user));
  }
};

const updateFormAvailability = (enabled) => {
  if (state.submitting) return;
  if (!elements.form) return;
  elements.form.querySelectorAll('input, textarea, button').forEach((element) => {
    element.disabled = !enabled;
  });
};

const fillTemplate = () => {
  if (!elements.form) return;
  const name = elements.form.querySelector('input[name="gameName"]');
  const objective = elements.form.querySelector('textarea[name="gameObjective"]');
  const rules = elements.form.querySelector('textarea[name="gameRules"]');
  const win = elements.form.querySelector('textarea[name="winCondition"]');
  const notes = elements.form.querySelector('textarea[name="specialNotes"]');
  const opening = elements.form.querySelector('textarea[name="openingBrief"]');

  if (name) name.value = '火星殖民议事会';
  if (objective) objective.value = TEMPLATE.objective;
  if (rules) rules.value = TEMPLATE.rules;
  if (win) win.value = TEMPLATE.winCondition;
  if (notes) notes.value = TEMPLATE.specialNotes;
  if (opening) opening.value = TEMPLATE.openingBrief;
};

const initEvents = () => {
  elements.form?.addEventListener('submit', handleCreate);
  elements.fillTemplate?.addEventListener('click', () => {
    fillTemplate();
  });
};

const bootstrap = async () => {
  initEvents();
  await fetchSession();
  await loadAgents();
};

bootstrap().catch((error) => {
  console.error('初始化失败', error);
});
