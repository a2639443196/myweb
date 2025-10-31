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

const loginModal = document.querySelector('[data-role="login-modal"]');
const registerModal = document.querySelector('[data-role="register-modal"]');
const loginForm = loginModal?.querySelector('[data-role="login-form"]') ?? null;
const registerForm = registerModal?.querySelector('[data-role="register-form"]') ?? null;
const loginError = loginModal?.querySelector('[data-role="login-error"]') ?? null;
const registerError = registerModal?.querySelector('[data-role="register-error"]') ?? null;
const openRegisterButtons = Array.from(document.querySelectorAll('[data-role="open-register"]'));
const openLoginButtons = Array.from(document.querySelectorAll('[data-role="open-login"]'));
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
  activeModal: null,
  heartbeatTimer: null,
  onlineSocket: null,
  onlineReconnectTimer: null,
  shouldReconnectOnline: false,
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

const setModalVisible = (modal, visible) => {
  if (!modal) return;
  if (visible) {
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
  } else {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
};

const updateBodyScrollLock = () => {
  const hasVisibleModal = (loginModal && !loginModal.hidden) || (registerModal && !registerModal.hidden);
  document.body.style.overflow = hasVisibleModal ? 'hidden' : '';
};

const showLoginModal = () => {
  state.activeModal = 'login';
  setModalVisible(loginModal, true);
  setModalVisible(registerModal, false);
  clearAuthErrors();
  updateBodyScrollLock();
  focusFirstField(loginForm);
};

const showRegisterModal = () => {
  state.activeModal = 'register';
  setModalVisible(registerModal, true);
  setModalVisible(loginModal, false);
  clearAuthErrors();
  updateBodyScrollLock();
  focusFirstField(registerForm);
};

const hideAuthModals = () => {
  state.activeModal = null;
  setModalVisible(loginModal, false);
  setModalVisible(registerModal, false);
  updateBodyScrollLock();
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

    const link = document.createElement('a');
    link.className = 'online-users__link';
    link.href = `user-home.html?username=${encodeURIComponent(user.username)}`;
    link.setAttribute('data-username', user.username);

    const details = document.createElement('div');
    details.className = 'online-users__details';

    const identity = document.createElement('span');
    identity.className = 'online-users__chip online-users__chip--identity';

    const dot = document.createElement('span');
    dot.className = 'online-users__dot';
    if (user.online) {
      dot.classList.add('is-online');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'online-users__username';
    nameSpan.textContent = user.username;
    if (user.username && user.username.length > 12) {
      nameSpan.classList.add('is-long');
    }

    identity.append(dot, nameSpan);

    const presenceSpan = document.createElement('span');
    presenceSpan.className = 'online-users__chip online-users__chip--state';
    if (user.online) {
      presenceSpan.textContent = '在线';
      presenceSpan.classList.add('is-online');
    } else {
      presenceSpan.textContent = user.lastSeen ? `离线 · ${formatRelativeTime(user.lastSeen)}` : '离线 · 暂无记录';
    }

    const phoneSpan = document.createElement('span');
    phoneSpan.className = 'online-users__chip online-users__chip--phone';
    phoneSpan.textContent = user.phone;

    details.append(identity, presenceSpan, phoneSpan);
    link.append(details);
    item.append(link);
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

const stopHeartbeat = () => {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
};

const disconnectOnlineSocket = () => {
  state.shouldReconnectOnline = false;
  if (state.onlineReconnectTimer) {
    window.clearTimeout(state.onlineReconnectTimer);
    state.onlineReconnectTimer = null;
  }
  const socket = state.onlineSocket;
  if (socket) {
    state.onlineSocket = null;
    try {
      socket.close(1000, 'logout');
    } catch (error) {
      console.warn('关闭在线用户连接失败', error);
    }
  }
};

const scheduleOnlineReconnect = () => {
  if (!state.shouldReconnectOnline) return;
  if (state.onlineReconnectTimer) return;
  state.onlineReconnectTimer = window.setTimeout(() => {
    state.onlineReconnectTimer = null;
    connectOnlineSocket();
  }, 3_000);
};

const connectOnlineSocket = () => {
  if (!state.shouldReconnectOnline) return;
  if (state.onlineReconnectTimer) {
    window.clearTimeout(state.onlineReconnectTimer);
    state.onlineReconnectTimer = null;
  }
  if (!('WebSocket' in window)) {
    console.warn('当前浏览器不支持 WebSocket，无法实时更新在线状态。');
    return;
  }
  const existing = state.onlineSocket;
  if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let socket;
  try {
    socket = new WebSocket(`${protocol}://${window.location.host}/ws/online`);
  } catch (error) {
    console.warn('创建在线用户连接失败', error);
    scheduleOnlineReconnect();
    return;
  }

  state.onlineSocket = socket;

  socket.addEventListener('open', () => {
    if (state.onlineReconnectTimer) {
      window.clearTimeout(state.onlineReconnectTimer);
      state.onlineReconnectTimer = null;
    }
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data && data.type === 'online_users' && Array.isArray(data.users)) {
        renderOnlineUsers(data.users);
      }
    } catch (error) {
      console.warn('解析在线用户数据失败', error);
    }
  });

  socket.addEventListener('close', () => {
    state.onlineSocket = null;
    if (state.shouldReconnectOnline) {
      scheduleOnlineReconnect();
    }
  });

  socket.addEventListener('error', (event) => {
    console.warn('在线用户连接错误', event);
    try {
      socket.close();
    } catch (error) {
      console.warn('关闭异常的在线用户连接失败', error);
    }
  });
};

const handleSessionExpired = () => {
  stopHeartbeat();
  disconnectOnlineSocket();
  state.user = null;
  renderUserBanner();
  setProtectedAreasVisible(false);
  setOnlineSectionVisible(false);
  clearAuthErrors();
  clearAuthForms();
  showLoginModal();
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

const handleAuthSuccess = (user) => {
  state.user = user;
  renderUserBanner();
  setProtectedAreasVisible(true);
  setOnlineSectionVisible(true);
  renderOnlineUsers([]);
  hideAuthModals();
  clearAuthErrors();
  clearAuthForms();
  startHeartbeat();
  state.shouldReconnectOnline = true;
  connectOnlineSocket();
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

if (loginModal && registerModal && userBanner) {
  openRegisterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showRegisterModal();
    });
  });

  openLoginButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showLoginModal();
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
