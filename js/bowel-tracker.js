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
const template = document.getElementById('history-item-template');
const solidNote = document.querySelector('[data-role="solid-note"]');
const liquidNote = document.querySelector('[data-role="liquid-note"]');
const solidButton = document.querySelector('[data-role="solid-submit"]');
const liquidButton = document.querySelector('[data-role="liquid-submit"]');

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
    empty.innerHTML = '<span class="history__time">--:--</span><p class="history__summary">暂无排便记录</p><p class="history__meta">点击上方按钮开始记录。</p>';
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
      summaryEl.textContent = activity.action === 'solid' ? '大便打卡' : '小便打卡';
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
    const activities = await fetchUserActivity(currentUser.username, { category: 'bowel' });
    renderHistory(activities);
  } catch (error) {
    console.error(error);
    setStatus(error.message || '刷新记录失败', 'is-error');
  }
}

async function handleSubmit(type) {
  const noteField = type === 'solid' ? solidNote : liquidNote;
  const note = noteField?.value.trim();

  try {
    await logActivity('bowel', type, note ? { note } : {});
    setStatus('记录成功！', 'is-success');
    if (noteField) {
      noteField.value = '';
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

solidButton?.addEventListener('click', () => handleSubmit('solid'));
liquidButton?.addEventListener('click', () => handleSubmit('liquid'));

init();
