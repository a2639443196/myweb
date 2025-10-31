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

const userModal = document.querySelector('[data-role="user-modal"]');
const userBanner = document.querySelector('[data-role="user-banner"]');

if (userModal && userBanner) {
  const manageButton = document.querySelector('[data-role="manage-profile"]');
  const userName = userBanner.querySelector('[data-role="user-name"]');
  const userGoal = userBanner.querySelector('[data-role="user-goal"]');
  const userFocus = userBanner.querySelector('[data-role="user-focus"]');
  const userTagline = userBanner.querySelector('[data-role="user-tagline"]');
  const userForm = userModal.querySelector('[data-role="user-form"]');
  const dismissTriggers = userModal.querySelectorAll('[data-role="close-modal"]');
  const formError = userModal.querySelector('[data-role="form-error"]');

  const defaultTagline = '保持探索与节奏，稳步前进。';

  const state = {
    user: null,
  };

  const setFormDisabled = (disabled) => {
    if (!userForm) return;
    userForm.querySelectorAll('input, button').forEach((element) => {
      element.disabled = disabled;
    });
  };

  const showError = (message) => {
    if (!formError) return;
    if (message) {
      formError.textContent = message;
      formError.hidden = false;
    } else {
      formError.textContent = '';
      formError.hidden = true;
    }
  };

  const renderBanner = () => {
    if (!state.user) {
      userBanner.hidden = true;
      userBanner.setAttribute('aria-hidden', 'true');
      return;
    }

    userName.textContent = state.user.name;
    userGoal.textContent = state.user.goal;
    userFocus.textContent = state.user.focus;
    userTagline.textContent = state.user.tagline || defaultTagline;
    userBanner.hidden = false;
    userBanner.removeAttribute('aria-hidden');
  };

  const closeModal = () => {
    if (!userModal) return;
    userModal.hidden = true;
    userModal.setAttribute('aria-hidden', 'true');
  };

  const openModal = () => {
    if (!userModal) return;
    userModal.hidden = false;
    userModal.removeAttribute('aria-hidden');
    if (userForm) {
      const firstInput = userForm.querySelector('input[name="name"]');
      if (firstInput) {
        queueMicrotask(() => firstInput.focus());
      }
    }
  };

  const fetchCurrentUser = async () => {
    const response = await fetch('/api/session', {
      credentials: 'include',
    });

    if (response.status === 401) {
      throw new HttpError('未登录', response.status);
    }

    if (!response.ok) {
      throw new HttpError('加载用户信息失败', response.status);
    }

    const data = await response.json();
    return data.user;
  };

  const registerUser = async (payload) => {
    const response = await fetch('/api/session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error || '注册失败，请稍后再试';
      throw new HttpError(message, response.status);
    }

    return data.user;
  };

  const loadSession = async () => {
    try {
      const user = await fetchCurrentUser();
      state.user = user;
      renderBanner();
    } catch (error) {
      renderBanner();
      if (error instanceof HttpError && error.status === 401) {
        openModal();
        return;
      }
      console.error('加载用户信息失败', error);
      showError('无法加载用户信息，请稍后再试。');
      openModal();
    }
  };

  userForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(userForm);
    const name = String(formData.get('name') || '').trim();
    const goal = String(formData.get('goal') || '').trim();
    const focus = String(formData.get('focus') || '').trim();
    const tagline = String(formData.get('tagline') || '').trim();

    if (!name || !goal || !focus) {
      showError('请完整填写必填信息。');
      return;
    }

    showError('');
    setFormDisabled(true);

    try {
      const user = await registerUser({ name, goal, focus, tagline });
      state.user = user;
      renderBanner();
      closeModal();
      userForm.reset();
    } catch (error) {
      if (error instanceof HttpError) {
        showError(error.message);
      } else {
        console.error('注册用户失败', error);
        showError('注册失败，请稍后再试。');
      }
    } finally {
      setFormDisabled(false);
    }
  });

  dismissTriggers.forEach((button) => {
    button.addEventListener('click', () => {
      closeModal();
    });
  });

  manageButton?.addEventListener('click', () => {
    openModal();
  });

  loadSession();
}
