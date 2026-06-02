// ============ 常量 & 工具函数 ============

// 默认配置
export const DEFAULT_CONFIG = {
  enabled: true,
  autoOpenPanel: false,
  maxLogEntries: 200,
  notifications: true,
};

// 默认规则示例
export const SAMPLE_RULES = [
  {
    id: 'sample-1',
    name: '示例：修改用户信息',
    urlPattern: '*/api/user/info*',
    method: 'GET',
    responseStatus: 200,
    responseBody: JSON.stringify({ id: 1, name: 'Mock User', role: 'admin' }, null, 2),
    responseHeaders: { 'Content-Type': 'application/json' },
    enabled: true,
    delay: 0,
    description: '',
    createdAt: Date.now(),
  },
];

// HTTP 方法选项
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

// 常用状态码
export const HTTP_STATUS_CODES = [
  { code: 200, label: '200 OK' },
  { code: 201, label: '201 Created' },
  { code: 204, label: '204 No Content' },
  { code: 400, label: '400 Bad Request' },
  { code: 401, label: '401 Unauthorized' },
  { code: 403, label: '403 Forbidden' },
  { code: 404, label: '404 Not Found' },
  { code: 500, label: '500 Internal Server Error' },
  { code: 502, label: '502 Bad Gateway' },
  { code: 503, label: '503 Service Unavailable' },
];

// 生成唯一 ID
export function generateId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// 格式化时间戳
export function formatTime(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// 将 URL pattern 转换为正则表达式
export function patternToRegex(pattern) {
  // 支持 * 作为通配符，* 仅匹配非 / 字符
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}`);
}

// 检查 URL 是否匹配规则
export function urlMatches(url, rule) {
  if (!rule.enabled) return false;

  const rulePattern = rule.urlPattern || rule.url;
  if (!rulePattern) return false;

  // 支持带通配符的 URL pattern
  const regex = patternToRegex(rulePattern);
  return regex.test(url);
}

// 判断 URL 是否匹配多个规则
export function findMatchingRules(url, method, rules) {
  return rules.filter(rule => {
    if (rule.method && rule.method !== '*' && rule.method !== method) {
      return false;
    }
    return urlMatches(url, rule);
  });
}

// 深拷贝
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// 防抖函数
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 节流函数
export function throttle(fn, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// 验证 JSON 字符串
export function isValidJSON(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// 格式化 JSON（美化）
export function prettyJSON(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

// 获取 URL 的基础信息
export function parseUrl(fullUrl) {
  try {
    const url = new URL(fullUrl);
    return {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      host: url.host,
      hostname: url.hostname,
    };
  } catch {
    return { origin: '', pathname: fullUrl, search: '', host: '', hostname: '' };
  }
}

// 压缩 JSON 字符串（去掉空白）
export function minifyJSON(str) {
  try {
    return JSON.stringify(JSON.parse(str));
  } catch {
    return str;
  }
}
