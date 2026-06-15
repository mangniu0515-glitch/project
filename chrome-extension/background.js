import './extension-config.js';

const MESSAGES = {
  UPLOAD_QR: 'UPLOAD_QR'
};

const PACKAGED_CONFIG = globalThis.__QRCODE_EXTENSION_CONFIG__ || {};
const FALLBACK_SERVER_URL = 'http://127.0.0.1:3000';
const DEFAULT_SERVER_URL = normalizeServerUrl(PACKAGED_CONFIG.serverUrl || FALLBACK_SERVER_URL);

const DEFAULT_CONFIG = {
  serverUrl: DEFAULT_SERVER_URL,
  token: null,
  user: null,
  clientAuthStatus: null,
  autoCollect: true,
  interval: 5,
  boundSelectors: {},
  collectionPolicy: null,
  policyFetchedAt: 0
};

let config = DEFAULT_CONFIG;
const POLICY_TTL = 5 * 60 * 1000;
const PUBLIC_HIDDEN_POLICY_TTL = 5 * 60 * 1000;
const CAPTURE_CACHE_TTL = 1200;
let visibleCaptureInFlight = null;
let lastVisibleCapture = null;

function normalizeServerUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function getPreferredServerUrl(data = {}, sender = null) {
  return DEFAULT_SERVER_URL;
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('QR Scanner Extension installed');
  await loadConfig();
  await refreshCollectionPolicy();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup');
  await loadConfig();
  await refreshCollectionPolicy();
});

async function removedLegacyMenuSetup() {
  try {
    return;
    
    void ({
      id: 'removed',
      title: '🔍 识别二维码并上传',
      contexts: ['image']
    });
    
    console.log('Context menus created');
  } catch (error) {
    console.error('Failed to create context menus:', error);
  }
}

void (async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId, info);
  
  if (!info.srcUrl) {
    showNotification('无法获取图片地址', 'error');
    return;
  }
  
  if (info.menuItemId === 'removed') {
    try {
      await refreshCollectionPolicy();
      chrome.tabs.sendMessage(tab.id, {
        type: 'REMOVED_LEGACY_IMAGE_QR',
        imageUrl: info.srcUrl,
        tabId: tab.id,
        pageUrl: tab.url,
        pageTitle: tab.title
      });
    } catch (error) {
      console.error('Failed to send message to content script:', error);
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_QR_RESULT',
        success: false,
        message: '❌ 无法连接页面脚本'
      });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup');
  await loadConfig();
  await refreshCollectionPolicy();
});

async function loadConfig() {
  try {
    const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
    config = { ...DEFAULT_CONFIG, ...result };
    const normalizedServerUrl = normalizeServerUrl(config.serverUrl);
    if (normalizedServerUrl !== DEFAULT_SERVER_URL) {
      config = {
        ...config,
        serverUrl: DEFAULT_SERVER_URL,
        token: null,
        user: null,
        clientAuthStatus: null
      };
      await chrome.storage.sync.set({
        serverUrl: DEFAULT_SERVER_URL,
        token: null,
        user: null,
        clientAuthStatus: null
      });
      await refreshPublicHiddenPolicy(true, { replace: true, skipLoadConfig: true });
    }
    console.log('Config loaded:', {
      serverUrl: config.serverUrl,
      hasToken: !!config.token,
      user: config.user
    });
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

function getAuthState() {
  return {
    authenticated: !!(config.token && config.user),
    user: config.user || null,
    clientAuthStatus: config.clientAuthStatus || null,
    serverUrl: config.serverUrl || DEFAULT_CONFIG.serverUrl
  };
}

async function broadcastAuthState() {
  const authState = getAuthState();
  const tabs = await chrome.tabs.query({});

  await Promise.allSettled(tabs.map(async (tab) => {
    if (!tab.id || !chrome.scripting?.executeScript) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [authState],
      func: (state) => {
        globalThis.__qrSelectorInstance?.handleAuthStateChanged?.(state);
      }
    });
  }));
}

async function clearAuthState() {
  await chrome.storage.sync.remove(['token', 'user', 'clientAuthStatus']);
  await chrome.storage.local.remove([
    'collectionPolicy',
    'policyFetchedAt',
    'publicHiddenPolicy',
    'publicHiddenPolicyFetchedAt'
  ]);
  const publicHiddenPolicy = await refreshPublicHiddenPolicy(true, { replace: true });
  config = {
    ...config,
    token: null,
    user: null,
    clientAuthStatus: null,
    collectionPolicy: publicHiddenPolicy || null,
    policyFetchedAt: 0
  };
  await broadcastAuthState();
  return getAuthState();
}

async function setPreferredServerUrl(serverUrl) {
  const normalizedServerUrl = DEFAULT_SERVER_URL;
  const currentServerUrl = normalizeServerUrl(config.serverUrl || DEFAULT_SERVER_URL);
  if (normalizedServerUrl === currentServerUrl) return;

  await chrome.storage.sync.set({
    serverUrl: normalizedServerUrl,
    token: null,
    user: null,
    clientAuthStatus: null
  });
  await chrome.storage.local.remove(['collectionPolicy', 'policyFetchedAt']);
  await loadConfig();
}

async function clientAuthCheckIn(data = {}, sender = null) {
  const serverUrl = await getPreferredServerUrl(data, sender);
  await setPreferredServerUrl(serverUrl);

  try {
    const response = await fetch(`${serverUrl}/api/client-auth/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extension_version: chrome.runtime.getManifest().version
      })
    });

    const result = await response.json().catch(() => null);
    const clientAuthStatus = {
      status: result?.status || (response.status === 403 ? 'pending' : 'error'),
      ip_address: result?.ip_address || result?.authorization?.ip_address || null,
      role: result?.role || result?.user?.role || null,
      qrcode_enabled: result?.qrcode_enabled ?? result?.authorization?.qrcode_enabled,
      email_enabled: result?.email_enabled ?? result?.authorization?.email_enabled,
      message: result?.message || result?.error || ''
    };

    if (!response.ok) {
      await chrome.storage.sync.set({
        serverUrl,
        clientAuthStatus,
        token: null,
        user: null
      });
      await refreshPublicHiddenPolicy(true, { replace: true });
      await loadConfig();
      await broadcastAuthState();
      return { success: false, authState: getAuthState(), clientAuthStatus, error: clientAuthStatus.message || '当前 IP 未授权' };
    }

    if (!result?.token || !result?.user) {
      throw new Error('授权响应无效');
    }

    await chrome.storage.sync.set({
      token: result.token,
      user: result.user,
      serverUrl,
      clientAuthStatus
    });
  await chrome.storage.local.remove([
    'collectionPolicy',
    'policyFetchedAt',
    'publicHiddenPolicy',
    'publicHiddenPolicyFetchedAt'
  ]);
    await loadConfig();
    const policy = await refreshCollectionPolicy(true);
    await broadcastAuthState();
    return { success: true, authState: getAuthState(), clientAuthStatus, policy };
  } catch (error) {
    console.error('Client auth check-in error:', error);
    const clientAuthStatus = {
      status: 'error',
      ip_address: null,
      role: null,
      message: error.message || 'IP 授权检测失败'
    };
    await chrome.storage.sync.set({ serverUrl, clientAuthStatus });
    await refreshPublicHiddenPolicy(true, { replace: true });
    await loadConfig();
    await broadcastAuthState();
    return { success: false, authState: getAuthState(), clientAuthStatus, error: clientAuthStatus.message };
  }
}

async function authLogin(data = {}, sender = null) {
  const serverUrl = await getPreferredServerUrl(data, sender);
  await setPreferredServerUrl(serverUrl);
  const username = String(data.username || '').trim();
  const password = String(data.password || '');

  if (!username || !password) {
    return { success: false, error: '请输入用户名和密码' };
  }

  try {
    const response = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.token || !result?.user) {
      throw new Error(result?.error || result?.message || '登录失败，请检查账号和密码');
    }

    await chrome.storage.sync.set({
      token: result.token,
      user: result.user,
      serverUrl,
      clientAuthStatus: null
    });
    await chrome.storage.local.remove([
      'collectionPolicy',
      'policyFetchedAt',
      'publicHiddenPolicy',
      'publicHiddenPolicyFetchedAt'
    ]);
    await loadConfig();
    const policy = await refreshCollectionPolicy(true);
    await broadcastAuthState();
    return { success: true, authState: getAuthState(), policy };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: error.message || '登录失败' };
  }
}

async function authLogout() {
  const authState = await clearAuthState();
  return { success: true, authState };
}

async function authedJsonRequest(path, options = {}) {
  await loadConfig();

  if (!config.serverUrl || !config.token) {
    return { success: false, error: 'Please sign in from the page drawer', isUnauthorized: true };
  }

  try {
    const response = await fetch(`${config.serverUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = { error: text };
    }

    if (response.status === 401 || response.status === 403 && String(result?.error || '').includes('authorization')) {
      await clearAuthState();
      return { success: false, error: result?.error || 'Authorization expired', isUnauthorized: true };
    }

    if (!response.ok) {
      return { success: false, error: result?.error || result?.message || `Request failed: ${response.status}` };
    }

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message || 'Request failed' };
  }
}

async function getLeaderWorkspace() {
  const [users, emailOptions] = await Promise.all([
    authedJsonRequest('/api/client-auth/my-users'),
    authedJsonRequest('/api/email-pool/assignments/options')
  ]);

  if (!users.success) return users;
  if (!emailOptions.success) return emailOptions;

  return {
    success: true,
    workspace: {
      users: users.data?.users || [],
      emailAccounts: emailOptions.data?.accounts || []
    }
  };
}

async function getUserAssignmentWorkspace() {
  const [assignment, emailAssignment] = await Promise.all([
    authedJsonRequest('/api/client-auth/my-assignment'),
    authedJsonRequest('/api/email-pool/assignments/me')
  ]);

  if (!assignment.success) return assignment;
  if (!emailAssignment.success) return emailAssignment;

  return {
    success: true,
    workspace: {
      assignment: assignment.data?.assignment || null,
      emailAssignment: emailAssignment.data?.assignment || null,
      emailFeatureEnabled: emailAssignment.data?.feature_enabled !== false
    }
  };
}

async function assignEmailAccount(data = {}) {
  return authedJsonRequest('/api/email-pool/assignments', {
    method: 'POST',
    body: {
      user_authorization_id: Number(data.userAuthorizationId),
      email_account_id: Number(data.emailAccountId)
    }
  });
}

async function releaseEmailAssignment(data = {}) {
  const assignmentId = Number(data.assignmentId);
  if (!assignmentId) {
    return { success: false, error: 'Email assignment id is required' };
  }
  return authedJsonRequest(`/api/email-pool/assignments/${assignmentId}`, {
    method: 'DELETE'
  });
}

async function getMessageTab(senderTab, tabId) {
  if (senderTab?.id) return senderTab;
  if (!tabId) return null;

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function requireAdmin() {
  await loadConfig();
  if (!config.token || !config.user) {
    return { success: false, error: '请先登录', isUnauthorized: true };
  }
  if (config.user.role !== 'admin') {
    return { success: false, error: '仅管理员可以使用此功能' };
  }
  return null;
}

async function startAdminCollectionAllFrames(senderTab, data = {}) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const tab = await getMessageTab(senderTab, data.tabId);
  if (!tab?.id) return { success: false, error: '未找到当前页面' };

  const payload = {
    draftType: data.draftType === 'email_verification'
      ? 'email_verification'
      : data.draftType === 'hidden_element'
        ? 'hidden_element'
        : 'qrcode_target',
    hideMethod: data.hideMethod === 'remove' ? 'remove' : 'cover',
    topUrl: tab.url || null,
    topTitle: tab.title || ''
  };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [payload],
      func: (options) => {
        globalThis.__qrSelectorInstance?.startAdminCollectionMode?.(
          options.draftType,
          options.hideMethod,
          options.topUrl,
          options.topTitle
        );
      }
    });
    return { success: true };
  } catch (error) {
    console.error('Start admin collection all frames error:', error);
    return { success: false, error: error.message || '无法连接当前页面，请刷新后重试' };
  }
}

async function createEmailVerificationTask(data = {}) {
  return authedJsonRequest('/api/email-pool/verification-tasks', {
    method: 'POST',
    body: {
      site_id: Number(data.siteId || data.site_id),
      rule_id: Number(data.ruleId || data.rule_id),
      source_url: data.sourceUrl || data.source_url,
      email_address: data.emailAddress || data.email_address
    }
  });
}

async function getEmailVerificationTask(data = {}) {
  const taskId = Number(data.taskId || data.id);
  if (!taskId) return { success: false, error: 'Task id is required' };
  return authedJsonRequest(`/api/email-pool/verification-tasks/${taskId}`);
}

async function fillAssignedEmailAllFrames(senderTab, data = {}) {
  const tab = await getMessageTab(senderTab, data.tabId);
  if (!tab?.id) return { success: false, error: '未找到当前页面' };

  const emailAddress = String(data.emailAddress || data.email_address || '').trim();
  if (!emailAddress) return { success: false, error: 'Email address is required' };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [emailAddress],
      func: (value) => {
        return !!globalThis.__qrSelectorInstance?.fillAssignedEmailInCurrentFrame?.(value);
      }
    });
    const filledFrames = (results || []).filter(item => item.result === true).length;
    return { success: true, filled: filledFrames > 0, filledFrames };
  } catch (error) {
    console.error('Fill assigned email all frames error:', error);
    return { success: false, error: error.message || '邮箱填充失败' };
  }
}

async function getHideRulesAllFramesState(senderTab, tabId) {
  const tab = await getMessageTab(senderTab, tabId);
  if (!tab?.id) return { success: false, error: '未找到当前页面' };

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_HIDE_RULES_STATE' }, { frameId: 0 });
  } catch (error) {
    return { success: false, error: error.message || '当前页面不可控制隐藏规则' };
  }
}

async function toggleHideRulesAllFrames(senderTab, data = {}) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const tab = await getMessageTab(senderTab, data.tabId);
  if (!tab?.id) return { success: false, error: '未找到当前页面' };

  try {
    const current = await getHideRulesAllFramesState(tab);
    const paused = typeof data.paused === 'boolean' ? data.paused : !current?.paused;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [paused],
      func: (nextPaused) => {
        globalThis.__qrSelectorInstance?.setHideRulesPaused?.(nextPaused);
      }
    });
    return { success: true, paused };
  } catch (error) {
    console.error('Toggle hide rules all frames error:', error);
    return { success: false, error: error.message || '无法连接当前页面，请刷新后重试' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type);

  switch (message.type) {
    case MESSAGES.UPLOAD_QR:
      handleQRUpload(message).then(sendResponse);
      return true;

    case 'AUTH_GET_STATE':
      loadConfig().then(() => sendResponse({ success: true, authState: getAuthState() }));
      return true;

    case 'AUTH_LOGIN':
      authLogin(message.data, sender).then(sendResponse);
      return true;

    case 'CLIENT_AUTH_CHECK_IN':
      clientAuthCheckIn(message.data, sender).then(sendResponse);
      return true;

    case 'SET_PREFERRED_SERVER_URL':
      getPreferredServerUrl(message.data, sender)
        .then(serverUrl => setPreferredServerUrl(serverUrl).then(() => ({ success: true, authState: getAuthState() })))
        .then(sendResponse);
      return true;

    case 'AUTH_LOGOUT':
      authLogout().then(sendResponse);
      return true;

    case 'CLIENT_AUTH_GET_LEADER_WORKSPACE':
      getLeaderWorkspace().then(sendResponse);
      return true;

    case 'CLIENT_AUTH_GET_USER_ASSIGNMENT':
      getUserAssignmentWorkspace().then(sendResponse);
      return true;

    case 'EMAIL_ASSIGNMENT_SAVE':
      assignEmailAccount(message.data).then(sendResponse);
      return true;

    case 'EMAIL_ASSIGNMENT_RELEASE':
      releaseEmailAssignment(message.data).then(sendResponse);
      return true;

    case 'EMAIL_VERIFICATION_TASK_CREATE':
      createEmailVerificationTask(message.data).then(sendResponse);
      return true;

    case 'EMAIL_VERIFICATION_TASK_GET':
      getEmailVerificationTask(message.data).then(sendResponse);
      return true;

    case 'FILL_ASSIGNED_EMAIL_ALL_FRAMES':
      fillAssignedEmailAllFrames(sender.tab, message.data).then(sendResponse);
      return true;

    case 'START_ADMIN_COLLECTION_ALL_FRAMES':
      startAdminCollectionAllFrames(sender.tab, message).then(sendResponse);
      return true;

    case 'TOGGLE_HIDE_RULES_ALL_FRAMES':
      toggleHideRulesAllFrames(sender.tab, message).then(sendResponse);
      return true;

    case 'GET_HIDE_RULES_ALL_FRAMES_STATE':
      getHideRulesAllFramesState(sender.tab, message.tabId).then(sendResponse);
      return true;

    case 'GET_COLLECTION_POLICY':
      refreshCollectionPolicy().then(policy => sendResponse({ success: true, policy }));
      return true;

    case 'REFRESH_COLLECTION_POLICY':
      refreshCollectionPolicy(true).then(policy => sendResponse({ success: true, policy }));
      return true;

    case 'CAPTURE_VISIBLE_TAB':
      captureVisibleTab(sender.tab).then(sendResponse);
      return true;

    case 'GET_FRAME_OFFSET':
      getFrameOffset(sender.tab, message.frameUrl).then(sendResponse);
      return true;

    case 'GET_TOP_PAGE_CONTEXT':
      sendResponse({
        success: true,
        url: sender.tab?.url || null,
        title: sender.tab?.title || ''
      });
      return false;

    case 'STOP_ADMIN_COLLECTION_ALL_FRAMES':
      getMessageTab(sender.tab, message.tabId)
        .then(tab => stopAdminCollectionAllFrames(tab))
        .then(sendResponse);
      return true;

    case 'REPORT_AUTHORIZED_DETECTION':
      forwardAuthorizedDetection(sender.tab, message.detection).then(sendResponse);
      return true;

    case 'REPORT_EMAIL_VERIFICATION_STATUS':
      forwardEmailVerificationStatus(sender.tab, message.status).then(sendResponse);
      return true;

    case 'CREATE_COLLECTION_DRAFT':
      createCollectionDraft(message.data).then(sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

async function captureVisibleTab(tab) {
  if (!tab?.windowId) {
    return { success: false, error: 'No active tab available' };
  }

  const now = Date.now();
  if (
    lastVisibleCapture?.windowId === tab.windowId &&
    lastVisibleCapture?.dataUrl &&
    now - lastVisibleCapture.capturedAt < CAPTURE_CACHE_TTL
  ) {
    return { success: true, dataUrl: lastVisibleCapture.dataUrl, cached: true };
  }

  if (visibleCaptureInFlight?.windowId === tab.windowId) {
    return visibleCaptureInFlight.promise;
  }

  const capturePromise = (async () => {
    const token = await suppressExtensionUiForCapture(tab);
    try {
      if (token) {
        await delay(80);
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      lastVisibleCapture = {
        windowId: tab.windowId,
        dataUrl,
        capturedAt: Date.now()
      };
      return { success: true, dataUrl };
    } catch (error) {
      console.error('Capture visible tab error:', error);
      return { success: false, error: error.message || 'Capture failed' };
    } finally {
      if (token) {
        await restoreExtensionUiAfterCapture(tab, token);
      }
      if (visibleCaptureInFlight?.promise === capturePromise) {
        visibleCaptureInFlight = null;
      }
    }
  })();

  visibleCaptureInFlight = { windowId: tab.windowId, promise: capturePromise };
  return capturePromise;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function suppressExtensionUiForCapture(tab) {
  if (!tab?.id || !chrome.scripting?.executeScript) return null;

  const token = `qr-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [token],
      func: async (captureToken) => {
        const overlaySelector = [
          '.qr-admin-collection-panel',
          '.qr-authorized-detection-panel',
          '.qr-selector-preview',
          '.qr-selector-bound',
          '.qr-result-notification'
        ].join(',');

        document.querySelectorAll(overlaySelector).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          if (!element.dataset.qrCaptureToken) {
            element.dataset.qrCaptureVisibility = element.style.visibility || '';
            element.dataset.qrCapturePointerEvents = element.style.pointerEvents || '';
          }
          element.dataset.qrCaptureToken = captureToken;
          element.style.visibility = 'hidden';
          element.style.pointerEvents = 'none';
        });

        document.querySelectorAll('.qr-selector-hover').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          element.dataset.qrCaptureHoverToken = captureToken;
          element.classList.remove('qr-selector-hover');
        });

        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    });
    return token;
  } catch (error) {
    console.warn('Suppress extension UI before capture failed:', error);
    return null;
  }
}

async function restoreExtensionUiAfterCapture(tab, token) {
  if (!tab?.id || !token || !chrome.scripting?.executeScript) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [token],
      func: (captureToken) => {
        document.querySelectorAll(`[data-qr-capture-token="${captureToken}"]`).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          element.style.visibility = element.dataset.qrCaptureVisibility || '';
          element.style.pointerEvents = element.dataset.qrCapturePointerEvents || '';
          delete element.dataset.qrCaptureToken;
          delete element.dataset.qrCaptureVisibility;
          delete element.dataset.qrCapturePointerEvents;
        });

        document.querySelectorAll(`[data-qr-capture-hover-token="${captureToken}"]`).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          element.classList.add('qr-selector-hover');
          delete element.dataset.qrCaptureHoverToken;
        });
      }
    });
  } catch (error) {
    console.warn('Restore extension UI after capture failed:', error);
  }
}

async function getFrameOffset(tab, frameUrl) {
  if (!tab?.id) {
    return { success: false, error: 'No active tab available' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_FRAME_OFFSET',
      frameUrl
    }, { frameId: 0 });

    return response || { success: false, error: 'No frame offset response' };
  } catch (error) {
    console.error('Get frame offset error:', error);
    return { success: false, error: error.message || 'Get frame offset failed' };
  }
}

async function stopAdminCollectionAllFrames(tab) {
  if (!tab?.id) {
    return { success: false, error: 'No active tab available' };
  }

  try {
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          globalThis.__qrSelectorInstance?.stopAdminCollectionMode?.();
        }
      });
    } else {
      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_SELECTION_MODE' });
    }
    return { success: true };
  } catch (error) {
    console.error('Stop admin collection all frames error:', error);
    return { success: false, error: error.message || 'Stop admin collection failed' };
  }
}

async function forwardAuthorizedDetection(tab, detection) {
  if (!tab?.id) {
    return { success: false, error: 'No active tab available' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_AUTHORIZED_DETECTION',
      detection
    }, { frameId: 0 });

    return response || { success: true };
  } catch (error) {
    console.error('Forward authorized detection error:', error);
    return { success: false, error: error.message || 'Forward detection failed' };
  }
}

async function forwardEmailVerificationStatus(tab, status) {
  if (!tab?.id) {
    return { success: false, error: 'No active tab available' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_EMAIL_VERIFICATION_STATUS',
      status
    }, { frameId: 0 });

    return response || { success: true };
  } catch (error) {
    console.error('Forward email verification status error:', error);
    return { success: false, error: error.message || 'Forward email verification status failed' };
  }
}

async function handleQRScan(data) {
  try {
    console.log('Scanning QR code:', data);

    if (!isPolicyMatchedPayload(data)) {
      throw new Error('该二维码不在允许采集范围内');
    }
    
    void config.autoCollect;
    
    return { success: true, data };
  } catch (error) {
    console.error('Scan error:', error);
    return { success: false, error: error.message };
  }
}

async function handleQRUpload(message) {
  const { data, tabId } = message;
  const uploadMode = data?.uploadMode || data?.upload_mode || 'manual';
  const isAutoUpload = true;
  
  console.log('handleQRUpload called:', data);
  
  try {
    if (!isPolicyMatchedPayload(data)) {
      throw new Error('该二维码不在允许采集范围内');
    }

    const result = await uploadToServer({ ...data, uploadMode });
    console.log('Upload result:', result);
    
    if (result.success) {
      return result;
      if (isAutoUpload) {
        await addToHistory({ ...data, uploadMode });
      } else {
        void data.id;
      }
      
      if (tabId && !isAutoUpload) {
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_QR_RESULT',
          success: true,
          message: '🎉 上传成功！',
          content: data.content
        });
      }
    } else {
      if (tabId && !isAutoUpload) {
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_QR_RESULT',
          success: true,
          message: '✅ 已保存到待上传队列',
          content: data.content
        });
      }
    }
    
    return result;
  } catch (error) {
    console.error('Upload error:', error);
    
    const isUnauthorized = error.message.includes('401') || error.message.includes('Unauthorized') || error.message.includes('请先登录');
    
    if (tabId && !isAutoUpload) {
      chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_QR_RESULT',
        success: false,
        message: isUnauthorized ? '🔐 请从页面右侧控制抽屉重新登录' : '❌ 上传失败',
        isUnauthorized: isUnauthorized
      });
    }
    
    return { success: false, error: error.message, isUnauthorized };
  }
}

async function uploadToServer(data) {
  await loadConfig();
  // 每次上传前重新读取最新配置
  await loadConfig();
  await refreshCollectionPolicy();
  
  if (!config.serverUrl || !config.token) {
    throw new Error('请从页面右侧控制抽屉重新登录');
  }

  const url = `${config.serverUrl}/api/qrcodes/upload`;
  
  console.log('Uploading to:', url);
  console.log('Token available:', !!config.token);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.token}`
    },
    body: JSON.stringify({
      content: data.content,
      image: data.image,
      source_url: data.source,
      source_page_title: data.pageTitle,
      site_id: data.siteId || data.site_id,
      target_id: data.targetId || data.target_id,
      matched_selector: data.matchedSelector || data.matched_selector,
      element_type: data.elementType || data.element_type || 'any',
      image_src: data.imageSrc || data.image_src || null,
      client_authorization_id: data.clientAuthorizationId || data.client_authorization_id || null,
      upload_mode: data.uploadMode || data.upload_mode || 'manual',
      extension_version: chrome.runtime.getManifest().version,
      timestamp: data.timestamp
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Upload failed:', errorText);
    
    if (response.status === 401) {
      await clearAuthState();
      throw new Error('401 - 请从页面右侧控制抽屉重新登录');
    }
    
    throw new Error(`上传失败: ${response.status}`);
  }

  const result = await response.json();
  console.log('Upload success:', result);
  return { success: true, data: result };
}

async function refreshCollectionPolicy(force = false) {
  await loadConfig();
  const cached = await chrome.storage.local.get({
    collectionPolicy: null,
    policyFetchedAt: 0,
    publicHiddenPolicy: null,
    publicHiddenPolicyFetchedAt: 0
  });
  config.collectionPolicy = cached.collectionPolicy || config.collectionPolicy;
  config.policyFetchedAt = cached.policyFetchedAt || config.policyFetchedAt;

  const now = Date.now();

  if (!force && config.collectionPolicy && config.policyFetchedAt && now - config.policyFetchedAt < POLICY_TTL) {
    return config.collectionPolicy;
  }

  if (!config.serverUrl || !config.token) {
    return refreshPublicHiddenPolicy(force, { replace: true });
  }

  try {
    const response = await fetch(`${config.serverUrl}/api/collection/policy`, {
      headers: {
        Authorization: `Bearer ${config.token}`
      }
    });

    if (response.status === 401) {
      await clearAuthState();
      return refreshPublicHiddenPolicy(true, { replace: true });
    }

    if (!response.ok) throw new Error(`Policy fetch failed: ${response.status}`);

    const policy = await response.json();
    config.collectionPolicy = policy;
    config.policyFetchedAt = now;
    await chrome.storage.local.set({
      collectionPolicy: policy,
      policyFetchedAt: now
    });
    return policy;
  } catch (error) {
    console.error('Failed to refresh collection policy:', error);
    return config.collectionPolicy || refreshPublicHiddenPolicy(force, { replace: true });
  }
}

function mergePublicHiddenIntoPolicy(basePolicy, publicHiddenPolicy) {
  const base = basePolicy && Array.isArray(basePolicy.sites)
    ? basePolicy
    : { sites: [] };
  const hidden = publicHiddenPolicy && Array.isArray(publicHiddenPolicy.sites)
    ? publicHiddenPolicy
    : { sites: [] };
  const sites = new Map();

  for (const site of base.sites || []) {
    sites.set(Number(site.id), {
      ...site,
      targets: Array.isArray(site.targets) ? site.targets : [],
      hidden_rules: Array.isArray(site.hidden_rules) ? site.hidden_rules : [],
      email_verification_rules: Array.isArray(site.email_verification_rules) ? site.email_verification_rules : []
    });
  }

  for (const site of hidden.sites || []) {
    const siteId = Number(site.id);
    const existing = sites.get(siteId);
    if (existing) {
      existing.hidden_rules = Array.isArray(site.hidden_rules) ? site.hidden_rules : [];
    } else {
      sites.set(siteId, {
        ...site,
        targets: [],
        hidden_rules: Array.isArray(site.hidden_rules) ? site.hidden_rules : [],
        email_verification_rules: []
      });
    }
  }

  return {
    version: base.version || hidden.version || new Date().toISOString(),
    sites: Array.from(sites.values())
  };
}

async function refreshPublicHiddenPolicy(force = false, options = {}) {
  if (!options.skipLoadConfig) {
    await loadConfig();
  }
  const cached = await chrome.storage.local.get({
    collectionPolicy: null,
    publicHiddenPolicy: null,
    publicHiddenPolicyFetchedAt: 0
  });
  const now = Date.now();

  if (
    !force &&
    cached.publicHiddenPolicy &&
    cached.publicHiddenPolicyFetchedAt &&
    now - cached.publicHiddenPolicyFetchedAt < PUBLIC_HIDDEN_POLICY_TTL
  ) {
    const cachedBase = options.replace ? null : (cached.collectionPolicy || config.collectionPolicy);
    const cachedMerged = mergePublicHiddenIntoPolicy(cachedBase, cached.publicHiddenPolicy);
    config.collectionPolicy = cachedMerged;
    await chrome.storage.local.set({ collectionPolicy: cachedMerged });
    return cachedMerged;
  }

  if (!config.serverUrl) {
    return cached.collectionPolicy || config.collectionPolicy;
  }

  try {
    const response = await fetch(`${config.serverUrl}/api/collection/public-hidden-policy`);
    if (!response.ok) throw new Error(`Public hidden policy fetch failed: ${response.status}`);

    const publicHiddenPolicy = await response.json();
    const basePolicy = options.replace ? null : (cached.collectionPolicy || config.collectionPolicy);
    const mergedPolicy = mergePublicHiddenIntoPolicy(basePolicy, publicHiddenPolicy);
    config.collectionPolicy = mergedPolicy;
    await chrome.storage.local.set({
      collectionPolicy: mergedPolicy,
      publicHiddenPolicy,
      publicHiddenPolicyFetchedAt: now
    });
    return mergedPolicy;
  } catch (error) {
    console.error('Failed to refresh public hidden policy:', error);
    return cached.collectionPolicy || config.collectionPolicy;
  }
}

async function createCollectionDraft(data) {
  await loadConfig();

  if (!config.serverUrl || !config.token) {
    return { success: false, error: '请从页面右侧控制抽屉重新登录' };
  }

  if (config.user?.role !== 'admin') {
    return { success: false, error: '仅管理员可以采集规则草稿' };
  }

  try {
    const response = await fetch(`${config.serverUrl}/api/collection/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify(data)
    });

    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = { error: text };
    }

    if (response.status === 401) {
      await clearAuthState();
      return { success: false, error: '请从页面右侧控制抽屉重新登录', isUnauthorized: true };
    }

    if (!response.ok) {
      throw new Error(result?.error || result?.message || `创建草稿失败: ${response.status}`);
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Create collection draft error:', error);
    return { success: false, error: error.message || '创建草稿失败' };
  }
}

function isPolicyMatchedPayload(data) {
  return !!(
    data &&
    data.source &&
    (data.content || data.image) &&
    (data.siteId || data.site_id) &&
    (data.targetId || data.target_id) &&
    (data.matchedSelector || data.matched_selector)
  );
}

function updateBadge(status) {
  const icons = {
    success: { text: '✓', color: '#4CAF50' },
    warning: { text: '!', color: '#FF9800' },
    error: { text: '✗', color: '#F44336' },
    scan: { text: '', color: '#2196F3' }
  };

  const icon = icons[status] || icons.success;
  
  chrome.action.setBadgeText({ text: icon.text });
  chrome.action.setBadgeBackgroundColor({ color: icon.color });
}

function showNotification(message, type = 'info') {
  if (!chrome.notifications) return;

  const notificationId = `qr-scanner-${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '二维码采集器',
    message: message,
    priority: 2
  });

  setTimeout(() => {
    chrome.notifications.clear(notificationId);
  }, 3000);
}

async function handleSelectionComplete(message) {
  console.log('Selection complete:', message);
  showNotification(`已成功绑定元素选择器: ${message.selector}`, 'success');
  
  await loadConfig();
  
  if (config.autoCollect) {
    console.log('Auto-collect enabled for this domain');
  }
}
