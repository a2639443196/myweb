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

const USER_STORAGE_KEY = 'wellnessHubUsers';
const ACTIVE_USER_KEY = 'wellnessHubActiveUser';

const userModal = document.querySelector('[data-role="user-modal"]');
const userBanner = document.querySelector('[data-role="user-banner"]');

if (userModal && userBanner) {
  const manageButton = document.querySelector('[data-role="manage-profile"]');
  const userName = userBanner.querySelector('[data-role="user-name"]');
  const userGoal = userBanner.querySelector('[data-role="user-goal"]');
  const userFocus = userBanner.querySelector('[data-role="user-focus"]');
  const userTagline = userBanner.querySelector('[data-role="user-tagline"]');
  const existingSection = userModal.querySelector('[data-role="existing-users"]');
  const userSelect = userModal.querySelector('[data-role="user-select"]');
  const activateButton = userModal.querySelector('[data-role="activate-user"]');
  const userForm = userModal.querySelector('[data-role="user-form"]');
  const dismissTriggers = userModal.querySelectorAll('[data-role="close-modal"]');

  const defaultTagline = '保持探索与节奏，稳步前进。';

  const safeParse = (value, fallback) => {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      console.error('无法解析本地用户数据，已重置。', error);
      return fallback;
    }
  };

  let state = {
    users: safeParse(localStorage.getItem(USER_STORAGE_KEY), []),
    activeId: localStorage.getItem(ACTIVE_USER_KEY) || null,
  };

  const persistUsers = () => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(state.users));
  };

  const setActiveUser = (id) => {
    state.activeId = id;
    if (id) {
      localStorage.setItem(ACTIVE_USER_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_USER_KEY);
    }
  };

  const findUser = (id) => state.users.find((user) => user.id === id) || null;

  const ensureActiveUserConsistency = () => {
    if (!state.activeId) return;
    if (!findUser(state.activeId)) {
      setActiveUser(null);
    }
  };

  const renderBanner = () => {
    ensureActiveUserConsistency();
    const user = state.activeId ? findUser(state.activeId) : null;
    if (!user) {
      userBanner.hidden = true;
      userBanner.setAttribute('aria-hidden', 'true');
      return;
    }

    userName.textContent = user.name;
    userGoal.textContent = user.goal;
    userFocus.textContent = user.focus;
    userTagline.textContent = user.tagline || defaultTagline;
    userBanner.hidden = false;
    userBanner.removeAttribute('aria-hidden');
  };

  const updateExistingUsersSection = () => {
    const hasUsers = state.users.length > 0;
    if (!existingSection) return;

    if (!hasUsers) {
      existingSection.hidden = true;
      userSelect.innerHTML = '';
      return;
    }

    existingSection.hidden = false;
    userSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择一个档案';
    placeholder.disabled = true;
    placeholder.selected = !state.activeId;
    userSelect.append(placeholder);

    state.users.forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = `${user.name} · ${user.goal}`;
      if (user.id === state.activeId) {
        option.selected = true;
      }
      userSelect.append(option);
    });

    if (state.activeId) {
      userSelect.value = state.activeId;
    }
  };

  const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  };

  const closeModal = () => {
    if (!state.activeId) {
      return;
    }
    userModal.hidden = true;
    userModal.setAttribute('aria-hidden', 'true');
  };

  const openModal = () => {
    userModal.hidden = false;
    userModal.removeAttribute('aria-hidden');
    updateExistingUsersSection();
    if (userForm) {
      const firstInput = userForm.querySelector('input[name="name"]');
      if (firstInput) {
        queueMicrotask(() => firstInput.focus());
      }
    }
  };

  const activateUser = (user) => {
    setActiveUser(user.id);
    renderBanner();
    closeModal();
  };

  userForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(userForm);
    const name = String(formData.get('name') || '').trim();
    const goal = String(formData.get('goal') || '').trim();
    const focus = String(formData.get('focus') || '').trim();
    const tagline = String(formData.get('tagline') || '').trim();

    if (!name || !goal || !focus) {
      return;
    }

    const newUser = {
      id: generateId(),
      name,
      goal,
      focus,
      tagline,
      createdAt: new Date().toISOString(),
    };

    state.users.push(newUser);
    persistUsers();
    activateUser(newUser);
    userForm.reset();
  });

  activateButton?.addEventListener('click', () => {
    const selected = userSelect?.value || '';
    if (!selected) return;
    const user = findUser(selected);
    if (!user) return;
    activateUser(user);
  });

  userSelect?.addEventListener('change', () => {
    activateButton?.focus();
  });

  dismissTriggers.forEach((button) => {
    button.addEventListener('click', () => {
      closeModal();
    });
  });

  manageButton?.addEventListener('click', () => {
    openModal();
  });

  ensureActiveUserConsistency();
  if (state.activeId) {
    renderBanner();
  } else {
    openModal();
  }
}
