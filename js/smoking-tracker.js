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
const countInput = document.querySelector('[data-role="count"]');
const moodSelect = document.querySelector('[data-role="mood"]');
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
    empty.innerHTML = '<span class="history__time">--:--</span><p class="history__summary">暂无抽烟记录</p><p class="history__meta">记录下次想点烟的原因。</p>';
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
      const count = Number(activity.details?.count) || 1;
      summaryEl.textContent = `抽了 ${count} 支烟`;
    }

    if (metaEl) {
      const mood = activity.details?.mood;
      const note = activity.details?.note;
      const dateText = formatDateTime(activity.createdAt);
      const extras = [mood, note].filter(Boolean).join(' · ');
      metaEl.textContent = extras ? `${extras} · ${dateText}` : dateText;
    }

    historyList.append(clone);
  });
}

async function refreshHistory() {
  if (!currentUser) return;
  try {
    const activities = await fetchUserActivity(currentUser.username, { category: 'smoking' });
    renderHistory(activities);
  } catch (error) {
    console.error(error);
    setStatus(error.message || '刷新记录失败', 'is-error');
  }
}

async function handleSubmit() {
  const count = Number(countInput?.value || 0);
  if (!Number.isFinite(count) || count <= 0) {
    setStatus('请输入有效的支数。', 'is-error');
    return;
  }
  if (count > 20) {
    setStatus('一次记录建议不超过 20 支。', 'is-error');
    return;
  }

  const mood = moodSelect?.value || '';
  const note = noteInput?.value.trim();

  try {
    await logActivity('smoking', 'cigarette', {
      count,
      ...(mood ? { mood } : {}),
      ...(note ? { note } : {})
    });
    setStatus('记录成功！', 'is-success');
    if (noteInput) {
      noteInput.value = '';
    }
    if (moodSelect) {
      moodSelect.value = '';
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
