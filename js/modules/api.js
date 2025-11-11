// /js/modules/api.js

class HttpError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

async function requestJson(url, options = {}) {
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
}

export const api = {
    session: {
        get: async () => {
            const data = await requestJson('/api/session');
            return data.user;
        },
        login: async (credentials) => {
            const data = await requestJson('/api/login', {
                method: 'POST',
                body: JSON.stringify(credentials),
            });
            return data.user;
        },
        logout: async () => {
            await requestJson('/api/logout', { method: 'POST' });
        },
        register: async (userInfo) => {
            const data = await requestJson('/api/register', {
                method: 'POST',
                body: JSON.stringify(userInfo),
            });
            return data.user;
        },
    },
    // Other API modules can be added here
};
