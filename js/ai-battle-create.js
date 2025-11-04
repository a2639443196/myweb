const TEMPLATE = {
  title: '午夜的空弹轮盘',
  scenario:
    '深夜的地下酒馆里，六名老千围桌对赌。左轮手枪有一发实弹，每轮必须宣称打出目标牌。若被拆穿，就要扣动扳机。桌面上散落的筹码暗示：有人在暗中交换牌。',
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
    const snapshot = await requestJSON('/api/liars-bar/agents');
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
  const title = formData.get('title')?.toString().trim() ?? '';
  const scenario = formData.get('scenario')?.toString().trim() ?? '';
  const agentIds = collectSelectedAgents();

  if (!scenario) {
    showCreateError('请填写场景设定，为 AI 提供足够的对局背景。');
    return;
  }
  if (agentIds.length < 4) {
    showCreateError('请选择至少 4 名 AI。');
    return;
  }

  const payload = { title, scenario, agentIds };

  try {
    setSubmitting(true);
    const result = await requestJSON('/api/liars-bar/game', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!result) {
      throw new Error('房间创建失败，请稍后再试。');
    }
    showCreateError('');
    window.location.href = 'ai-battle-room.html';
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) {
        showCreateError('未登录或会话已过期，请先登录后再操作。');
      } else if (error.status === 409) {
        showCreateError('当前已有骗子酒馆对决在进行，请稍后再试。');
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
  const title = elements.form.querySelector('input[name="title"]');
  const scenario = elements.form.querySelector('textarea[name="scenario"]');

  if (title) title.value = TEMPLATE.title;
  if (scenario) scenario.value = TEMPLATE.scenario;
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
