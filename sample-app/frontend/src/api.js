export function getToken() {
  return localStorage.getItem('carddemo_token');
}

function setToken(token) {
  localStorage.setItem('carddemo_token', token);
}

function clearToken() {
  localStorage.removeItem('carddemo_token');
  localStorage.removeItem('carddemo_user');
}

export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.href = '/';
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Could not parse error JSON, use default message
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function login(userId, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });

  if (!response.ok) {
    let errorMessage = 'Login failed';
    try {
      const errorData = await response.json();
      if (errorData.message) errorMessage = errorData.message;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  setToken(data.token);
  localStorage.setItem('carddemo_user', JSON.stringify({
    userId: data.userId,
    userType: data.userType,
    firstName: data.firstName,
    lastName: data.lastName,
  }));
  return data;
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors
  }
  clearToken();
}

export async function getAccounts(accountId) {
  const params = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  return apiFetch(`/api/accounts${params}`);
}

export async function getAccountDetail(id) {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}`);
}

export async function updateAccount(id, data) {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getCards(accountId) {
  const params = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  return apiFetch(`/api/cards${params}`);
}

export async function getCardDetail(cardNum) {
  return apiFetch(`/api/cards/${encodeURIComponent(cardNum)}`);
}

export async function updateCard(cardNum, data) {
  return apiFetch(`/api/cards/${encodeURIComponent(cardNum)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getTransactions({ accountId, cardNum, page, size } = {}) {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  if (cardNum) params.set('cardNum', cardNum);
  if (page !== undefined) params.set('page', page);
  if (size !== undefined) params.set('size', size);
  const qs = params.toString();
  return apiFetch(`/api/transactions${qs ? '?' + qs : ''}`);
}

export async function getTransactionDetail(id) {
  return apiFetch(`/api/transactions/${encodeURIComponent(id)}`);
}

export async function addTransaction(data) {
  return apiFetch('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function payBill(accountId) {
  return apiFetch('/api/billing/pay', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

export async function getUsers({ page, size } = {}) {
  const params = new URLSearchParams();
  if (page !== undefined) params.set('page', page);
  if (size !== undefined) params.set('size', size);
  const qs = params.toString();
  return apiFetch(`/api/users${qs ? '?' + qs : ''}`);
}

export async function getUser(id) {
  return apiFetch(`/api/users/${encodeURIComponent(id)}`);
}

export async function addUser(data) {
  return apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUser(id, data) {
  return apiFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id) {
  return apiFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function generateReport(data) {
  return apiFetch('/api/reports/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function postTransactions() {
  return apiFetch('/api/batch/post-transactions', {
    method: 'POST',
  });
}

export async function calculateInterest() {
  return apiFetch('/api/batch/calculate-interest', {
    method: 'POST',
  });
}
