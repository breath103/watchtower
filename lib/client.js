class WatchtowerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function createWatchtowerClient({ baseUrl, apiKey, timeoutMs = 1e4, onUnauthorized }) {
  return async function request(path, method, ...[options]) {
    const { params, query, body, signal } = options ?? {};
    let url = baseUrl + path.replace(/:(\w+)/g, (_, key) => encodeURIComponent(params?.[key] ?? ""));
    if (query) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === void 0) continue;
        search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
      url += `?${search}`;
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method,
      headers: {
        ...body === void 0 ? {} : { "Content-Type": "application/json" },
        ...apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      const payload = await response.json().catch(() => null);
      throw new WatchtowerError(
        response.status,
        payload?.error?.code ?? `http_${response.status}`,
        payload?.error?.message ?? `${method} ${path} \u2192 HTTP ${response.status}`
      );
    }
    return await response.json();
  };
}
export {
  WatchtowerError,
  createWatchtowerClient
};
