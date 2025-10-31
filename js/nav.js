const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
  const cards = document.querySelectorAll('.nav-card');
  cards.forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const rotateX = ((rect.height / 2 - y) / rect.height) * 10;
      const rotateY = ((x - rect.width / 2) / rect.width) * 12;
      card.style.setProperty('--tiltX', `${rotateX.toFixed(2)}deg`);
      card.style.setProperty('--tiltY', `${rotateY.toFixed(2)}deg`);
    });

    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tiltX', '0deg');
      card.style.setProperty('--tiltY', '0deg');
    });
  });

  const orb = document.querySelector('.gradient-orb');
  if (orb) {
    window.addEventListener('pointermove', (event) => {
      const { innerWidth, innerHeight } = window;
      const offsetX = (event.clientX / innerWidth - 0.5) * 100;
      const offsetY = (event.clientY / innerHeight - 0.5) * 100;
      orb.style.transform = `translate3d(${offsetX}%, ${offsetY}%, 0)`;
    });
  }
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const HEARTBEAT_INTERVAL = 30_000;
const ONLINE_REFRESH_INTERVAL = 10_000;

const authModal = document.querySelector('[data-role="auth-modal"]');
const authTabs = authModal ? Array.from(authModal.querySelectorAll('[data-role="auth-tab"]')) : [];
const loginForm = authModal?.querySelector('[data-role="login-form"]') ?? null;
const registerForm = authModal?.querySelector('[data-role="register-form"]') ?? null;
const loginError = authModal?.querySelector('[data-role="login-error"]') ?? null;
const registerError = authModal?.querySelector('[data-role="register-error"]') ?? null;
const userBanner = document.querySelector('[data-role="user-banner"]');
const userName = userBanner?.querySelector('[data-role="user-name"]') ?? null;
const userPhone = userBanner?.querySelector('[data-role="user-phone"]') ?? null;
const userCreated = userBanner?.querySelector('[data-role="user-created"]') ?? null;
const logoutButton = document.querySelector('[data-role="logout"]');
const protectedAreas = Array.from(document.querySelectorAll('[data-role="protected-area"]'));
const onlineSection = document.querySelector('[data-role="online-users"]');
const onlineList = onlineSection?.querySelector('[data-role="online-user-list"]') ?? null;

const state = {
  user: null,
  authView: 'login',
  heartbeatTimer: null,
  onlineTimer: null,
};

const showError = (element, message) => {
  if (!element) return;
  if (message) {
    element.textContent = message;
    element.hidden = false;
  } else {
    element.textContent = '';
    element.hidden = true;
  }
};

const setFormDisabled = (form, disabled) => {
  if (!form) return;
  form.querySelectorAll('input, button').forEach((field) => {
    field.disabled = disabled;
  });
};

const focusFirstField = (form) => {
  if (!form) return;
  const firstInput = form.querySelector('input');
  if (firstInput) {
    queueMicrotask(() => firstInput.focus());
  }
};

const setAuthView = (view) => {
  state.authView = view;
  if (loginForm) {
    loginForm.hidden = view !== 'login';
  }
  if (registerForm) {
    registerForm.hidden = view !== 'register';
  }
  authTabs.forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
};

const focusActiveForm = () => {
  const form = state.authView === 'login' ? loginForm : registerForm;
  focusFirstField(form);
};

const clearAuthForms = () => {
  loginForm?.reset();
  registerForm?.reset();
};

const clearAuthErrors = () => {
  showError(loginError, '');
  showError(registerError, '');
};

const setProtectedAreasVisible = (visible) => {
  protectedAreas.forEach((section) => {
    if (visible) {
      section.hidden = false;
      section.removeAttribute('aria-hidden');
    } else {
      section.hidden = true;
      section.setAttribute('aria-hidden', 'true');
    }
  });
};

const setOnlineSectionVisible = (visible) => {
  if (!onlineSection) return;
  if (visible) {
    onlineSection.hidden = false;
    onlineSection.removeAttribute('aria-hidden');
  } else {
    onlineSection.hidden = true;
    onlineSection.setAttribute('aria-hidden', 'true');
    if (onlineList) {
      onlineList.innerHTML = '';
    }
  }
};

const showAuthModal = () => {
  if (!authModal) return;
  authModal.hidden = false;
  authModal.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
  focusActiveForm();
};

const hideAuthModal = () => {
  if (!authModal) return;
  authModal.hidden = true;
  authModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const formatRelativeTime = (value) => {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 30) return '刚刚';
  if (diffSeconds < 60) return '1 分钟内';
  if (diffSeconds < 3_600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86_400) return `${Math.floor(diffSeconds / 3_600)} 小时前`;
  const days = Math.floor(diffSeconds / 86_400);
  if (days <= 7) return `${days} 天前`;
  return formatDateTime(value);
};

const renderUserBanner = () => {
  if (!userBanner) return;
  if (!state.user) {
    userBanner.hidden = true;
    userBanner.setAttribute('aria-hidden', 'true');
    return;
  }

  if (userName) {
    userName.textContent = state.user.username;
  }
  if (userPhone) {
    userPhone.textContent = state.user.phone;
  }
  if (userCreated) {
    userCreated.textContent = formatDateTime(state.user.createdAt);
  }

  userBanner.hidden = false;
  userBanner.removeAttribute('aria-hidden');
};

const renderOnlineUsers = (users) => {
  if (!onlineList) return;
  onlineList.innerHTML = '';

  if (!users.length) {
    const empty = document.createElement('li');
    empty.className = 'online-users__empty';
    empty.textContent = '暂无注册用户';
    onlineList.append(empty);
    return;
  }

  users.forEach((user) => {
    const item = document.createElement('li');
    item.className = 'online-users__item';

    const identity = document.createElement('div');
    identity.className = 'online-users__identity';

    const dot = document.createElement('span');
    dot.className = 'online-users__dot';
    if (user.online) {
      dot.classList.add('is-online');
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user.username;

    identity.append(dot, nameSpan);

    const status = document.createElement('div');
    status.className = 'online-users__status';

    const phoneSpan = document.createElement('span');
    phoneSpan.className = 'online-users__phone';
    phoneSpan.textContent = user.phone;

    const stateSpan = document.createElement('span');
    if (user.online) {
      stateSpan.textContent = '在线';
    } else {
      stateSpan.textContent = user.lastSeen ? `离线 · ${formatRelativeTime(user.lastSeen)}` : '离线 · 暂无记录';
    }

    status.append(phoneSpan, stateSpan);

    item.append(identity, status);
    onlineList.append(item);
  });
};

const fetchSession = async () => {
  const response = await fetch('/api/session', {
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(data.error || '加载会话失败', response.status);
  }
  return data.user;
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(data.error || '请求失败', response.status);
  }
  return data;
};

const login = async (payload) => {
  const data = await requestJson('/api/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.user;
};

const register = async (payload) => {
  const data = await requestJson('/api/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.user;
};

const logout = async () => {
  await requestJson('/api/logout', { method: 'POST' }).catch(() => ({}));
};

const sendHeartbeat = async () => {
  const response = await fetch('/api/session/heartbeat', {
    method: 'POST',
    credentials: 'include',
  });
  if (response.status === 401) {
    throw new HttpError('未登录', response.status);
  }
};

const fetchOnlineUsers = async () => {
  const response = await fetch('/api/online-users', {
    credentials: 'include',
  });
  if (response.status === 401) {
    throw new HttpError('未登录', response.status);
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.users) ? data.users : [];
};

const stopHeartbeat = () => {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
};

const stopOnlinePolling = () => {
  if (state.onlineTimer) {
    window.clearInterval(state.onlineTimer);
    state.onlineTimer = null;
  }
};

const handleSessionExpired = () => {
  stopHeartbeat();
  stopOnlinePolling();
  state.user = null;
  renderUserBanner();
  setProtectedAreasVisible(false);
  setOnlineSectionVisible(false);
  clearAuthErrors();
  clearAuthForms();
  setAuthView('login');
  showAuthModal();
};

const startHeartbeat = () => {
  stopHeartbeat();
  const run = () => {
    sendHeartbeat().catch((error) => {
      if (error instanceof HttpError && error.status === 401) {
        handleSessionExpired();
      } else {
        console.warn('心跳失败', error);
      }
    });
  };
  run();
  state.heartbeatTimer = window.setInterval(run, HEARTBEAT_INTERVAL);
};

const startOnlinePolling = () => {
  stopOnlinePolling();
  const poll = () => {
    fetchOnlineUsers()
      .then((users) => {
        renderOnlineUsers(users);
      })
      .catch((error) => {
        if (error instanceof HttpError && error.status === 401) {
          handleSessionExpired();
        } else {
          console.warn('获取在线用户失败', error);
        }
      });
  };
  poll();
  state.onlineTimer = window.setInterval(poll, ONLINE_REFRESH_INTERVAL);
};

const handleAuthSuccess = (user) => {
  state.user = user;
  renderUserBanner();
  setProtectedAreasVisible(true);
  setOnlineSectionVisible(true);
  hideAuthModal();
  clearAuthErrors();
  clearAuthForms();
  startHeartbeat();
  startOnlinePolling();
};

const loadSession = async () => {
  try {
    const user = await fetchSession();
    handleAuthSuccess(user);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      handleSessionExpired();
      return;
    }
    console.error('加载用户会话失败', error);
    handleSessionExpired();
    showError(loginError, '无法加载会话，请重新登录。');
  }
};

if (authModal && userBanner) {
  setAuthView('login');

  authTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view || 'login';
      setAuthView(view);
      clearAuthErrors();
      focusActiveForm();
    });
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!loginForm) return;
    const formData = new FormData(loginForm);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '').trim();

    if (!username || !password) {
      showError(loginError, '请输入用户名和密码。');
      return;
    }

    showError(loginError, '');
    setFormDisabled(loginForm, true);

    try {
      const user = await login({ username, password });
      handleAuthSuccess(user);
    } catch (error) {
      if (error instanceof HttpError) {
        showError(loginError, error.message);
      } else {
        console.error('登录失败', error);
        showError(loginError, '登录失败，请稍后再试。');
      }
    } finally {
      setFormDisabled(loginForm, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!registerForm) return;
    const formData = new FormData(registerForm);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '').trim();
    const phone = String(formData.get('phone') || '').trim();

    if (!username || !password || !phone) {
      showError(registerError, '请完整填写注册信息。');
      return;
    }

    showError(registerError, '');
    setFormDisabled(registerForm, true);

    try {
      const user = await register({ username, password, phone });
      handleAuthSuccess(user);
    } catch (error) {
      if (error instanceof HttpError) {
        showError(registerError, error.message);
      } else {
        console.error('注册失败', error);
        showError(registerError, '注册失败，请稍后再试。');
      }
    } finally {
      setFormDisabled(registerForm, false);
    }
  });

  logoutButton?.addEventListener('click', async () => {
    try {
      await logout();
    } finally {
      handleSessionExpired();
    }
  });

  loadSession();
}
