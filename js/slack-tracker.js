import {
  fetchCurrentUser,
  fetchUserActivity,
  logActivity,
  formatTime,
  formatDateTime
} from './activity-api.js';

const page = document.querySelector('[data-role="page"]');
const emptyState = document.querySelector('[data-role="empty-state"]');
const historyList = document.querySelector('[data-role="history"]');
const statusEl = document.querySelector('[data-role="status"]');
const durationInput = document.querySelector('[data-role="duration"]');
const noteInput = document.querySelector('[data-role="note"]');
const submitButton = document.querySelector('[data-role="submit"]');
const template = document.getElementById('history-item-template');

let currentUser = null;

function showEmpty() {
  if (page) {
    page.hidden = true;
  }
  if (emptyState) {
    emptyState.hidden = false;
  }
}

function showPage() {
  if (page) {
    page.hidden = false;
  }
  if (emptyState) {
    emptyState.hidden = true;
  }
}

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.remove('is-success', 'is-error');
  if (type) {
    statusEl.classList.add(type);
  }
}

function renderHistory(activities) {
  if (!historyList || !template) return;
  historyList.innerHTML = '';

  if (!activities.length) {
    const empty = document.createElement('li');
    empty.className = 'history__item';
    empty.innerHTML = '<span class="history__time">--:--</span><p class="history__summary">暂无摸鱼记录</p><p class="history__meta">安排一段轻松时光吧。</p>';
    historyList.append(empty);
    return;
  }

  activities.forEach((activity) => {
    const clone = template.content.firstElementChild.cloneNode(true);
    const timeEl = clone.querySelector('[data-role="item-time"]');
    const summaryEl = clone.querySelector('[data-role="item-summary"]');
    const metaEl = clone.querySelector('[data-role="item-meta"]');

    if (timeEl) {
      timeEl.textContent = formatTime(activity.createdAt);
    }

    if (summaryEl) {
      const minutes = Number(activity.details?.durationMinutes) || 0;
      summaryEl.textContent = minutes ? `摸鱼 ${minutes} 分钟` : '一次摸鱼记录';
    }

    if (metaEl) {
      const note = activity.details?.note;
      const dateText = formatDateTime(activity.createdAt);
      metaEl.textContent = note ? `${note} · ${dateText}` : dateText;
    }

    historyList.append(clone);
  });
}

async function refreshHistory() {
  if (!currentUser) return;
  try {
    const activities = await fetchUserActivity(currentUser.username, { category: 'slacking' });
    renderHistory(activities);
  } catch (error) {
    console.error(error);
    setStatus(error.message || '刷新记录失败', 'is-error');
  }
}

async function handleSubmit() {
  const minutes = Number(durationInput?.value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    setStatus('请输入有效的时长。', 'is-error');
    return;
  }
  if (minutes > 240) {
    setStatus('一次摸鱼时长建议不超过 240 分钟。', 'is-error');
    return;
  }

  const note = noteInput?.value.trim();

  try {
    await logActivity('slacking', 'session', {
      durationMinutes: minutes,
      ...(note ? { note } : {})
    });
    setStatus('记录成功！', 'is-success');
    if (noteInput) {
      noteInput.value = '';
    }
    refreshHistory();
  } catch (error) {
    console.error(error);
    setStatus(error.message || '记录失败，请稍后再试。', 'is-error');
  }
}

async function init() {
  try {
    currentUser = await fetchCurrentUser();
    if (!currentUser) {
      showEmpty();
      return;
    }
    showPage();
    refreshHistory();
  } catch (error) {
    console.error(error);
    showEmpty();
  }
}

submitButton?.addEventListener('click', handleSubmit);

init();
