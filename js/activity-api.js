export async function fetchCurrentUser() {
  const response = await fetch('/api/session', {
    credentials: 'include'
  });
  if (response.status === 401) {
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '无法获取当前用户');
  }
  return data.user || null;
}

export async function logActivity(category, action, details = {}) {
  const response = await fetch('/api/activity', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ category, action, details })
  });
  if (response.status === 401) {
    throw new Error('未登录');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '记录活动失败');
  }
  return data.activity;
}

export async function fetchUserActivity(username, { category } = {}) {
  const params = new URLSearchParams();
  if (category) {
    params.set('category', category);
  }
  const query = params.toString();
  const url = query
    ? `/api/users/${encodeURIComponent(username)}/activity?${query}`
    : `/api/users/${encodeURIComponent(username)}/activity`;
  const response = await fetch(url, {
    credentials: 'include'
  });
  if (response.status === 401) {
    throw new Error('未登录');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '获取活动失败');
  }
  return data.activities || [];
}

export async function fetchUserProfile(username) {
  const response = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    credentials: 'include'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '获取用户信息失败');
  }
  return data.user || null;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}
