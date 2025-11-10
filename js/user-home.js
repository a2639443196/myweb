import {
  fetchUserProfile,
  fetchUserActivity,
  formatDateTime,
  formatTime
} from './activity-api.js';

const params = new URLSearchParams(window.location.search);
const username = params.get('username');

const page = document.querySelector('[data-role="page"]');
const emptyState = document.querySelector('[data-role="empty-state"]');
const emptyMessage = document.querySelector('[data-role="empty-message"]');
const nameEl = document.querySelector('[data-role="username"]');
const phoneEl = document.querySelector('[data-role="phone"]');
const createdEl = document.querySelector('[data-role="created"]');
const timelineSection = document.querySelector('[data-role="timeline-section"]');
const timelineHint = timelineSection?.querySelector('.timeline__hint');
const defaultTimelineHint = timelineHint?.textContent ?? '';
const timelineEl = document.querySelector('[data-role="timeline"]');
const template = document.getElementById('timeline-item-template');

function showEmpty(message) {
  if (page) {
    page.hidden = true;
    page.setAttribute('hidden', '');
    page.style.display = 'none';
    page.setAttribute('aria-hidden', 'true');
  }
  if (emptyState) {
    emptyState.hidden = false;
    emptyState.removeAttribute('hidden');
    emptyState.style.display = 'grid';
    emptyState.removeAttribute('aria-hidden');
  }
  if (emptyMessage) {
    emptyMessage.textContent = message;
  }
}

function showPage() {
  if (timelineSection) {
    timelineSection.removeAttribute('data-empty');
  }
  if (page) {
    page.hidden = false;
    page.removeAttribute('hidden');
    page.style.removeProperty('display');
    page.removeAttribute('aria-hidden');
  }
  if (emptyState) {
    emptyState.hidden = true;
    emptyState.setAttribute('hidden', '');
    emptyState.style.display = 'none';
    emptyState.setAttribute('aria-hidden', 'true');
  }
}

function describeActivity(activity) {
  const { category, action, details = {} } = activity;
  const volume = details.volume ?? details.amount;
  const parts = {
    summary: '记录了一条活动',
    meta: ''
  };

  if (category === 'hydration') {
    if (action === 'drink') {
      parts.summary = volume ? `喝了 ${volume} ml 水` : '喝了水';
    } else if (action === 'undo_drink') {
      parts.summary = volume ? `撤销了 ${volume} ml 的喝水记录` : '撤销了一次喝水记录';
    } else if (action === 'goal_reached') {
      parts.summary = '完成了今日喝水目标';
      if (details.goal) {
        parts.meta = `目标 ${details.goal} ml`;
      }
    }
  } else if (category === 'bowel') {
    if (action === 'solid') {
      parts.summary = '完成了一次大便打卡';
    } else if (action === 'liquid') {
      parts.summary = '完成了一次小便打卡';
    }
    if (details.note) {
      parts.meta = details.note;
    }
  } else if (category === 'slacking') {
    if (action === 'session') {
      const minutes = Number(details.durationMinutes) || 0;
      parts.summary = minutes
        ? `摸鱼 ${minutes} 分钟`
        : '记录了一次摸鱼时刻';
      if (details.note) {
        parts.meta = details.note;
      }
    }
  } else if (category === 'smoking') {
    if (action === 'cigarette') {
      const count = Number(details.count) || 1;
      parts.summary = `抽了 ${count} 支烟`;
      if (details.mood) {
        parts.meta = details.mood;
      }
    }
  } else if (category === 'schulte') {
    if (action === 'best_record') {
      const gridSize = Number(details.gridSize) || 0;
      const elapsedMs = Number(details.elapsedMs) || 0;
      const sizeText = gridSize ? `${gridSize}×${gridSize}` : '舒尔特表格';
      const duration = elapsedMs
        ? `${Math.floor(elapsedMs / 1000)}.${Math.floor((elapsedMs % 1000) / 100)} 秒`
        : '';
      parts.summary = `刷新了${sizeText}最佳成绩`;
      if (duration) {
        parts.meta = `用时 ${duration}`;
      }
    }
  }

  if (!parts.meta && details.note) {
    parts.meta = details.note;
  }

  return parts;
}

function renderTimeline(activities) {
  if (!timelineEl || !template) return;
  timelineEl.innerHTML = '';

  if (!activities.length) {
    const empty = document.createElement('li');
    empty.className = 'timeline-item';
    empty.innerHTML =
      '<div class="timeline-item__time">--:--</div><div class="timeline-item__content"><p class="timeline-item__summary">暂无活动</p><p class="timeline-item__meta">快去记录一点内容吧。</p></div>';
    timelineEl.append(empty);
    if (timelineSection) {
      timelineSection.setAttribute('data-empty', 'true');
    }
    if (timelineHint) {
      timelineHint.textContent = '这个人的主页还没有任何动态';
    }
    return;
  }

  if (timelineHint) {
    timelineHint.textContent = defaultTimelineHint;
  }

  activities.forEach((activity) => {
    const clone = template.content.firstElementChild.cloneNode(true);
    const timeEl = clone.querySelector('[data-role="item-time"]');
    const summaryEl = clone.querySelector('[data-role="item-summary"]');
    const metaEl = clone.querySelector('[data-role="item-meta"]');
    const { summary, meta } = describeActivity(activity);

    if (timeEl) {
      timeEl.textContent = formatTime(activity.createdAt);
    }

    if (summaryEl) {
      summaryEl.textContent = summary;
    }

    if (metaEl) {
      const dateText = formatDateTime(activity.createdAt);
      metaEl.textContent = meta ? `${meta} · ${dateText}` : dateText;
    }

    timelineEl.append(clone);
  });
}

function populateProfile(profile = {}) {
  if (nameEl) {
    nameEl.textContent = profile.username || username || '未知用户';
  }
  if (phoneEl) {
    phoneEl.textContent = profile.phone || '暂无联系方式';
  }
  if (createdEl) {
    if (profile.createdAt) {
      createdEl.textContent = formatDateTime(profile.createdAt);
    } else {
      createdEl.textContent = '暂无加入时间';
    }
  }
}

function renderEmptyProfile() {
  populateProfile({ username });
  renderTimeline([]);
  showPage();
}

async function init() {
  if (!username) {
    showEmpty('缺少用户名参数。');
    return;
  }

  try {
    const profile = await fetchUserProfile(username);
    if (!profile) {
      renderEmptyProfile();
      return;
    }

    populateProfile(profile);

    const activities = await fetchUserActivity(username);
    renderTimeline(activities);
    showPage();
  } catch (error) {
    console.error(error);
    showEmpty(error.message || '加载用户信息失败。');
  }
}

init();
