class QRCodeSelector {
  constructor() {
    this.isSelectionMode = false;
    this.isBound = false;
    this.boundSelector = null;
    this.boundElement = null;
    this.hoveredElement = null;
    this.bubbleElement = null;
    this.scanInterval = null;
    this.processedElements = new Set();
    this.currentQRData = null;
    this.boundSelectors = {};
    this.collectionPolicy = null;
    this.activeRules = [];
    this.activeEmailVerificationRules = [];
    this.zxingReader = null;
    this.detectedTargets = new Map();
    this.dismissedDetections = new Set();
    this.forwardedDetectionKeys = new Set();
    this.uploadingDetectionKeys = new Set();
    this.autoUploadInFlightKeys = new Set();
    this.autoUploadLastAt = new Map();
    this.autoUploadStatus = null;
    this.elementCaptureCache = new Map();
    this.detectionPanel = null;
    this.detectionPanelRenderSignature = '';
    this.detectionDrawerCollapsed = true;
    this.detectionDrawerIndex = 0;
    this.isAdminCollectionMode = false;
    this.adminInfoPanel = null;
    this.activeHiddenRules = [];
    this.hiddenRuleState = new Map();
    this.hidePaused = false;
    this.hideApplyTimer = null;
    this.hideMutationObserver = null;
    this.hideScrollHandler = null;
    this.hideResizeHandler = null;
    this.hiddenElementIds = new WeakMap();
    this.hiddenElementCounter = 0;
    this.adminCollectionDraftType = 'qrcode_target';
    this.adminCollectionHideMethod = 'cover';
    this.adminEmailCollection = null;
    this.adminCollectionPreviousHidePaused = null;
    this.adminCollectionTopUrl = null;
    this.adminCollectionTopTitle = null;
    this.adminCollectionPointerDownBound = null;
    this.adminCollectionMouseDownBound = null;
    this.adminCollectionLastPickAt = 0;
    this.adminCollectionCandidateElement = null;
    this.topPageUrl = null;
    this.topPageTitle = null;
    this.topPageContextFetchedAt = 0;
    this.frameOffsetCache = null;
    this.authState = {
      authenticated: false,
      user: null,
      clientAuthStatus: null,
      serverUrl: this.getDefaultServerUrl()
    };
    this.controlDrawerShadow = null;
    this.controlDrawerError = '';
    this.adminLoginVisible = false;
    this.userAssignmentWorkspace = null;
    this.leaderWorkspace = null;
    this.leaderWorkspaceError = '';
    this.selectedLeaderUserId = null;
    this.emailAssignmentBusy = false;
    this.emailAssignmentError = '';
    this.emailRuleBindings = new Map();
    this.emailVerificationTasks = new Map();
    this.emailRuleApplyTimer = null;
    this.emailVerificationStatus = null;
    
    this.init();
  }

  isInIframe() {
    return window.top !== window;
  }

  getDefaultServerUrl() {
    const packagedConfig = globalThis.__QRCODE_EXTENSION_CONFIG__ || {};
    return String(packagedConfig.serverUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  }

  getPolicyUrl() {
    return this.adminCollectionTopUrl ||
      this.topPageUrl ||
      (this.isInIframe() && document.referrer ? document.referrer : window.location.href);
  }

  getFrameUrl() {
    return window.location.href;
  }

  getPageTitle() {
    return this.adminCollectionTopTitle || this.topPageTitle || document.title;
  }

  getPolicyOrigin() {
    try {
      return new URL(this.getPolicyUrl()).origin;
    } catch {
      return window.location.origin;
    }
  }

  getLocalViewportSize() {
    return {
      width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
    };
  }

  getScreenshotViewportSize(rect = null) {
    const local = this.getLocalViewportSize();
    return {
      width: Math.max(1, Number(rect?.viewportWidth) || local.width),
      height: Math.max(1, Number(rect?.viewportHeight) || local.height)
    };
  }

  isFrameElement(element) {
    const tagName = element?.tagName?.toLowerCase();
    return tagName === 'iframe' || tagName === 'frame';
  }

  async init() {
    this.initZXingReader();
    await this.refreshTopPageContext(true);
    await this.loadConfig();
    this.setupMessageListener();
    await this.syncPreferredServerUrl();
    await this.refreshAuthState();
    if (!this.isInIframe() && this.authState.user?.auth_type === 'ip') {
      await this.checkInClientAuth(false);
    } else if (!this.authState.authenticated) {
      await this.checkInClientAuth(false);
    }
    await this.refreshCollectionPolicy(true);
    if (this.authState.authenticated) {
      await this.refreshRoleWorkspace();
    } else {
      this.activeRules = [];
      this.activeEmailVerificationRules = [];
      this.clearEmailVerificationBindings();
      this.boundSelector = null;
      this.isBound = false;
    }
    this.startHiddenRuleObserver();
    this.applyHiddenRules();
    await this.checkBoundSelector();
    
    if (this.isBound) {
      this.startAutoScan();
    }
    this.renderDetectionPanel();
  }

  async refreshTopPageContext(force = false) {
    if (!this.isInIframe()) return;

    const now = Date.now();
    if (!force && this.topPageUrl && now - this.topPageContextFetchedAt < 5000) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TOP_PAGE_CONTEXT' });
      if (response?.success && response.url) {
        this.topPageUrl = response.url;
        this.topPageTitle = response.title || this.topPageTitle;
        this.topPageContextFetchedAt = now;
      }
    } catch (error) {
      console.warn('Failed to load top page context:', error);
    }
  }

  initZXingReader() {
    try {
      if (typeof ZXing === 'undefined') {
        console.log('⚠️ ZXing not loaded');
        return false;
      }
      console.log('✅ ZXing library available');
      return true;
    } catch (error) {
      console.error('Failed to check ZXing:', error);
      return false;
    }
  }

  async loadConfig() {
    const result = await chrome.storage.sync.get({
      interval: 5,
      autoCollect: true,
      boundSelectors: {}
    });
    const localResult = await chrome.storage.local.get({
      collectionPolicy: null
    });
    
    this.interval = (result.interval || 5) * 1000;
    this.autoCollect = result.autoCollect !== false;
    this.boundSelectors = result.boundSelectors || {};
    this.collectionPolicy = localResult.collectionPolicy || null;
    this.activeRules = this.getRulesForUrl(this.getPolicyUrl());
    this.activeEmailVerificationRules = this.getEmailVerificationRulesForUrl(this.getPolicyUrl());
    this.activeHiddenRules = this.getHiddenRulesForUrl(this.getPolicyUrl());
    
    const domain = this.getPolicyOrigin();
    this.boundSelector = this.boundSelectors[domain] || null;
    this.isBound = !!this.boundSelector;
  }

  async refreshAuthState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AUTH_GET_STATE' });
      if (response?.success && response.authState) {
        this.authState = response.authState;
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
    return this.authState;
  }

  async syncPreferredServerUrl() {
    if (this.isInIframe()) return;

    const serverUrl = this.getDefaultServerUrl();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_PREFERRED_SERVER_URL',
        data: {
          serverUrl,
          pageUrl: this.getPolicyUrl()
        }
      });
      if (response?.authState) {
        this.authState = response.authState;
      }
    } catch (error) {
      console.warn('Failed to sync preferred server URL:', error);
    }
  }

  async handleAuthStateChanged(authState) {
    this.authState = authState || {
      authenticated: false,
      user: null,
      clientAuthStatus: null,
      serverUrl: this.getDefaultServerUrl()
    };
    this.controlDrawerError = '';

    if (this.authState.user?.auth_type !== 'ip' || this.authState.user?.role !== 'user') {
      this.clearEmailVerificationBindings();
      this.emailVerificationTasks.clear();
      this.emailVerificationStatus = null;
    }

    if (!this.authState.authenticated) {
      await this.refreshCollectionPolicy(true);
      this.activeRules = [];
      this.activeEmailVerificationRules = [];
      this.detectedTargets.clear();
      this.forwardedDetectionKeys.clear();
      this.clearEmailVerificationBindings();
      this.emailVerificationTasks.clear();
      this.emailVerificationStatus = null;
      this.userAssignmentWorkspace = null;
      this.leaderWorkspace = null;
      this.leaderWorkspaceError = '';
      this.selectedLeaderUserId = null;
      this.emailAssignmentBusy = false;
      this.emailAssignmentError = '';
      this.stopAutoScan();
      this.boundSelector = null;
      this.isBound = false;
      this.renderDetectionPanel();
      return;
    }

    await this.refreshCollectionPolicy(true);
    await this.refreshRoleWorkspace();
    await this.checkBoundSelector();
    if (this.isBound) this.startAutoScan();
    this.renderDetectionPanel();
  }

  async refreshCollectionPolicy(force = false) {
    await this.refreshTopPageContext(force);
    try {
      const response = await chrome.runtime.sendMessage({
        type: force ? 'REFRESH_COLLECTION_POLICY' : 'GET_COLLECTION_POLICY'
      });
      if (response && Object.prototype.hasOwnProperty.call(response, 'policy')) {
        this.collectionPolicy = response.policy;
      }
    } catch (error) {
      console.error('Failed to load collection policy:', error);
    }

    this.activeRules = this.getRulesForUrl(this.getPolicyUrl());
    this.activeEmailVerificationRules = this.getEmailVerificationRulesForUrl(this.getPolicyUrl());
    this.activeHiddenRules = this.getHiddenRulesForUrl(this.getPolicyUrl());
    this.boundSelector = this.activeRules[0]?.target?.selector || null;
    this.isBound = !!this.boundSelector;
    this.applyHiddenRules();
    this.applyEmailVerificationRules();
    this.renderDetectionPanel();
  }

  isCurrentPageWhitelisted() {
    const url = this.getPolicyUrl();
    return (this.collectionPolicy?.sites || []).some(site =>
      site.enabled && this.wildcardMatch(url, site.url_pattern)
    );
  }

  shouldShowControlDrawer() {
    if (this.isInIframe()) return false;
    if (!this.authState.authenticated) return true;
    if (this.authState.user?.role === 'admin') return true;
    if (this.authState.user?.role === 'leader') return true;
    if (this.authState.user?.role === 'user' && (
      !this.hasAssignedLeader() ||
      !this.isUserQrcodeEnabled() ||
      !this.isUserEmailEnabled() ||
      !this.userAssignmentWorkspace?.emailAssignment ||
      !!this.emailVerificationStatus
    )) return true;
    return this.isCurrentPageWhitelisted() || this.detectedTargets.size > 0 || !!this.autoUploadStatus || !!this.emailVerificationStatus;
  }

  canAutoUpload() {
    if (!this.authState.authenticated || this.authState.user?.auth_type !== 'ip') return false;
    if (this.authState.user?.role === 'user') return this.hasAssignedLeader() && this.isUserQrcodeEnabled();
    if (this.authState.user?.role === 'leader') return !!this.getSelectedLeaderUser()?.qrcode_enabled;
    return false;
  }

  getAutoUploadMode() {
    return this.authState.user?.role === 'leader' ? 'leader_assisted' : 'auto';
  }

  getAutoUploadClientAuthorizationId() {
    if (this.authState.user?.role === 'leader') return this.selectedLeaderUserId || null;
    return this.authState.user?.authorization_id || null;
  }

  hasAssignedLeader() {
    const assignmentLeaderId = this.userAssignmentWorkspace?.assignment?.leader_authorization_id;
    return !!(this.authState.user?.leader_authorization_id || assignmentLeaderId);
  }

  isFeatureEnabled(value) {
    return value !== false && value !== 0;
  }

  isUserQrcodeEnabled() {
    const assignmentValue = this.userAssignmentWorkspace?.assignment?.qrcode_enabled;
    if (assignmentValue !== undefined && assignmentValue !== null) {
      return this.isFeatureEnabled(assignmentValue);
    }
    return this.isFeatureEnabled(this.authState.user?.qrcode_enabled);
  }

  isUserEmailEnabled() {
    if (this.userAssignmentWorkspace?.emailFeatureEnabled === false) return false;
    const assignmentValue = this.userAssignmentWorkspace?.assignment?.email_enabled;
    if (assignmentValue !== undefined && assignmentValue !== null) {
      return this.isFeatureEnabled(assignmentValue);
    }
    return this.isFeatureEnabled(this.authState.user?.email_enabled);
  }

  getSelectedLeaderUser() {
    const users = this.leaderWorkspace?.users || [];
    return users.find(user => Number(user.id) === Number(this.selectedLeaderUserId)) || null;
  }

  async refreshRoleWorkspace() {
    if (!this.authState.authenticated) return;

    try {
      if (this.authState.user?.auth_type === 'ip' && this.authState.user.role === 'user') {
        this.leaderWorkspace = null;
        this.selectedLeaderUserId = null;
        const response = await chrome.runtime.sendMessage({ type: 'CLIENT_AUTH_GET_USER_ASSIGNMENT' });
        if (response?.success) {
          this.userAssignmentWorkspace = response.workspace;
          this.authState.user.leader_authorization_id = response.workspace?.assignment?.leader_authorization_id || null;
          if (response.workspace?.assignment) {
            this.authState.user.qrcode_enabled = response.workspace.assignment.qrcode_enabled !== 0;
            this.authState.user.email_enabled = response.workspace.assignment.email_enabled !== 0;
          }
        } else {
          this.controlDrawerError = response?.error || '';
        }
      } else if (!this.isInIframe() && this.authState.user?.auth_type === 'ip' && this.authState.user.role === 'leader') {
        this.userAssignmentWorkspace = null;
        const response = await chrome.runtime.sendMessage({ type: 'CLIENT_AUTH_GET_LEADER_WORKSPACE' });
        if (response?.success) {
          this.leaderWorkspace = response.workspace;
          this.leaderWorkspaceError = '';
          if (!this.selectedLeaderUserId || !this.leaderWorkspace.users.some(user => Number(user.id) === Number(this.selectedLeaderUserId))) {
            this.selectedLeaderUserId = null;
          }
        } else {
          this.leaderWorkspaceError = response?.error || '';
        }
      } else {
        this.userAssignmentWorkspace = null;
        this.leaderWorkspace = null;
        this.selectedLeaderUserId = null;
      }
    } catch (error) {
      this.controlDrawerError = error.message || 'Failed to load role workspace';
    }

    this.tryAutoUploadDetectedTargets();
  }

  async checkInClientAuth(forceOpen = false) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLIENT_AUTH_CHECK_IN',
        data: {
          serverUrl: this.authState.serverUrl || this.getDefaultServerUrl(),
          pageUrl: this.getPolicyUrl()
        }
      });
      if (response?.authState) {
        this.authState = response.authState;
      }
      if (forceOpen) {
        this.detectionDrawerCollapsed = false;
      }
      if (response?.success) {
        await this.handleAuthStateChanged(response.authState);
      } else {
        this.renderDetectionPanel();
      }
      return response;
    } catch (error) {
      this.controlDrawerError = error.message || 'IP 授权检测失败';
      this.renderDetectionPanel();
      return { success: false, error: this.controlDrawerError };
    }
  }

  wildcardMatch(value, pattern) {
    if (!pattern) return false;
    const escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(String(value || ''));
  }

  getRulesForUrl(url) {
    const sites = this.collectionPolicy?.sites || [];
    const rules = [];

    for (const site of sites) {
      if (!site.enabled || !this.wildcardMatch(url, site.url_pattern)) continue;

      for (const target of site.targets || []) {
        if (!target.enabled || !this.wildcardMatch(url, target.page_url_pattern)) continue;
        rules.push({ site, target });
      }
    }

    return rules;
  }

  getHiddenRulesForUrl(url) {
    const sites = this.collectionPolicy?.sites || [];
    const rules = [];

    for (const site of sites) {
      if (!site.enabled || !this.wildcardMatch(url, site.url_pattern)) continue;

      for (const hiddenRule of site.hidden_rules || []) {
        if (!hiddenRule.enabled || !this.wildcardMatch(url, hiddenRule.page_url_pattern)) continue;
        rules.push({ site, hiddenRule });
      }
    }

    return rules;
  }

  getEmailVerificationRulesForUrl(url) {
    const sites = this.collectionPolicy?.sites || [];
    const rules = [];

    for (const site of sites) {
      if (!site.enabled || !this.wildcardMatch(url, site.url_pattern)) continue;

      for (const rule of site.email_verification_rules || []) {
        if (!rule.enabled || !this.wildcardMatch(url, rule.page_url_pattern)) continue;
        rules.push({ site, rule });
      }
    }

    return rules;
  }

  getElementType(element) {
    if (!element) return 'any';
    const tagName = element.tagName?.toLowerCase();
    return tagName === 'img' || tagName === 'canvas' ? tagName : 'any';
  }

  isElementVisible(element) {
    if (!element?.isConnected || element.nodeType !== Node.ELEMENT_NODE) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;

    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      const style = window.getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      node = node.parentElement;
    }

    return true;
  }

  isExtensionManagedElement(element) {
    if (!element?.closest) return false;
    return !!element.closest(
      '.qr-admin-collection-panel, .qr-authorized-detection-panel, .qr-selector-preview, .qr-selector-bound, .qr-result-notification, .qr-hidden-rule-cover'
    );
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
  }

  hasCollectableMedia(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.matches('img, canvas')) return true;
    if (element.querySelector('img, canvas')) return true;
    return this.getBackgroundImageSources(element).length > 0 ||
      Array.from(element.querySelectorAll('*')).some(child => this.getBackgroundImageSources(child).length > 0);
  }

  getVisibleRuleMatches(rule) {
    try {
      return Array.from(document.querySelectorAll(rule.target.selector))
        .filter(element => this.isElementVisible(element));
    } catch (error) {
      console.error('Invalid collection target selector:', rule.target.selector, error);
      return [];
    }
  }

  getBestElementForRule(rule) {
    const matches = this.getVisibleRuleMatches(rule);
    if (matches.length === 0) return null;

    return matches
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const area = Math.max(rect.width * rect.height, 1);
        const score =
          (this.isElementInViewport(element) ? 1000 : 0) +
          (this.hasCollectableMedia(element) ? 500 : 0) -
          Math.min(area / 1000, 300) -
          index;
        return { element, score };
      })
      .sort((left, right) => right.score - left.score)[0].element;
  }

  findAuthorizedRuleForElement(element) {
    if (!element) return null;

    for (const rule of this.activeRules) {
      const matches = this.getVisibleRuleMatches(rule);

      for (const match of matches) {
        const elementMatches = match === element || match.contains(element);
        if (!elementMatches) continue;

        const type = this.getElementType(element);
        const expectedType = rule.target.element_type || 'any';
        if (expectedType !== 'any' && type !== expectedType) continue;

        return rule;
      }
    }

    return null;
  }

  buildUploadData(content, imageSrc, element, rule, pageUrl = this.getPolicyUrl(), pageTitle = this.getPageTitle()) {
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      content,
      image: imageSrc,
      source: pageUrl,
      pageTitle,
      siteId: rule.site.id,
      targetId: rule.target.id,
      matchedSelector: rule.target.selector,
      elementType: rule.target.element_type || this.getElementType(element),
      imageSrc: imageSrc || null,
      timestamp: Date.now()
    };
  }

  buildRuleSnapshot(rule) {
    return {
      site: {
        id: rule.site.id,
        name: rule.site.name,
        url_pattern: rule.site.url_pattern
      },
      target: {
        id: rule.target.id,
        name: rule.target.name,
        selector: rule.target.selector,
        element_type: rule.target.element_type || 'any',
        page_url_pattern: rule.target.page_url_pattern
      }
    };
  }

  buildRuleFromSnapshot(snapshot) {
    if (!snapshot?.site || !snapshot?.target) return null;
    return {
      site: snapshot.site,
      target: snapshot.target
    };
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getDetectionKey(rule) {
    return `${rule.site.id}:${rule.target.id}`;
  }

  getHiddenRuleKey(rule) {
    return `${rule.site.id}:${rule.hiddenRule.id}`;
  }

  getHiddenElementStateKey(rule, element) {
    if (!this.hiddenElementIds.has(element)) {
      this.hiddenElementCounter += 1;
      this.hiddenElementIds.set(element, this.hiddenElementCounter);
    }
    return `${this.getHiddenRuleKey(rule)}:${this.hiddenElementIds.get(element)}`;
  }

  getDetectionContentKey(rule, content) {
    return `${this.getDetectionKey(rule)}:${content}`;
  }

  getTargetElementKey(rule, index) {
    return `${this.getDetectionKey(rule)}:${index}`;
  }

  getPathUrlPattern(url = window.location.href) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}*`;
    } catch {
      return `${window.location.origin}${window.location.pathname}*`;
    }
  }

  getDraftPageUrl() {
    return this.getPolicyUrl();
  }

  getDraftUrlPattern() {
    return this.getPathUrlPattern(this.getDraftPageUrl());
  }

  rememberProcessedDetection(key) {
    this.processedElements.add(key);
    if (this.processedElements.size > 200) {
      const oldest = this.processedElements.values().next().value;
      this.processedElements.delete(oldest);
    }
  }

  rememberDismissedDetection(rule, contentOrKey) {
    const key = contentOrKey && String(contentOrKey).includes(':')
      ? String(contentOrKey)
      : this.getDetectionContentKey(rule, contentOrKey || 'target');
    this.dismissedDetections.add(key);
    if (this.dismissedDetections.size > 100) {
      const oldest = this.dismissedDetections.values().next().value;
      this.dismissedDetections.delete(oldest);
    }
  }

  isSameRule(left, right) {
    return !!(
      left &&
      right &&
      Number(left.site.id) === Number(right.site.id) &&
      Number(left.target.id) === Number(right.target.id) &&
      left.target.selector === right.target.selector
    );
  }

  getImageSource(element) {
    if (!element || element.tagName?.toLowerCase() !== 'img') return null;
    return element.currentSrc || element.src || null;
  }

  normalizeImageUrl(url) {
    if (!url) return null;
    try {
      return new URL(String(url), window.location.href).href;
    } catch (error) {
      return String(url);
    }
  }

  imageUrlsMatch(left, right) {
    const normalizedLeft = this.normalizeImageUrl(left);
    const normalizedRight = this.normalizeImageUrl(right);
    return !!normalizedLeft && !!normalizedRight && normalizedLeft === normalizedRight;
  }

  looksLikeQrCandidateSize(width, height) {
    if (!width || !height) return false;
    const min = Math.min(width, height);
    const max = Math.max(width, height);
    return min >= 80 && max / min <= 1.8;
  }

  getBackgroundImageSources(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return [];

    const style = window.getComputedStyle(element);
    const backgroundImage = style?.backgroundImage || '';
    if (!backgroundImage || backgroundImage === 'none') return [];

    return Array.from(backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g))
      .map(match => this.normalizeImageUrl(match[2]))
      .filter(Boolean);
  }

  getElementImageSources(element) {
    const sources = [];
    const imageSource = this.getImageSource(element);
    if (imageSource) sources.push(this.normalizeImageUrl(imageSource));
    sources.push(...this.getBackgroundImageSources(element));
    return Array.from(new Set(sources.filter(Boolean)));
  }

  elementHasImageUrl(element, imageUrl) {
    return this.getElementImageSources(element).some(source => this.imageUrlsMatch(source, imageUrl));
  }

  removedFindElementForImageUrl(imageUrl) {
    if (!imageUrl) return null;

    const candidates = [];
    let node = null;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      candidates.push(node);
      node = node.parentElement;
    }

    for (const element of candidates) {
      if (this.elementHasImageUrl(element, imageUrl)) return element;
    }

    const image = Array.from(document.images)
      .find(img => this.imageUrlsMatch(img.currentSrc, imageUrl) || this.imageUrlsMatch(img.src, imageUrl));
    if (image) return image;

    const roots = [];
    for (const rule of this.activeRules) {
      try {
        roots.push(...document.querySelectorAll(rule.target.selector));
      } catch (error) {
        console.error('Invalid collection target selector:', rule.target.selector, error);
      }
    }

    for (const root of roots) {
      const scopedCandidates = [root, ...root.querySelectorAll('*')];
      for (const element of scopedCandidates) {
        if (this.elementHasImageUrl(element, imageUrl)) return element;
      }
    }

    return null;
  }

  async decodeQRFromElementScreenshot(element) {
    if (!element?.isConnected) return null;

    const rect = await this.getElementViewportRect(element);
    if (rect.width < 40 || rect.height < 40) return null;

    try {
      const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
      if (!capture?.success || !capture.dataUrl) {
        console.warn('Element screenshot capture failed:', capture?.error);
        return null;
      }

      return await this.decodeQRFromScreenshotDataUrl(capture.dataUrl, rect);
    } catch (error) {
      console.error('Element screenshot QR decode error:', error);
      return null;
    }
  }

  async getElementViewportRect(element) {
    if (!element?.isConnected) return null;

    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return null;
    const localViewport = this.getLocalViewportSize();
    const localRect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: localViewport.width,
      viewportHeight: localViewport.height
    };

    if (!this.isInIframe()) return localRect;

    try {
      const offset = await this.getFrameOffset();
      return {
        left: rect.left + offset.left,
        top: rect.top + offset.top,
        right: rect.right + offset.left,
        bottom: rect.bottom + offset.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: Number(offset.viewportWidth) || localViewport.width,
        viewportHeight: Number(offset.viewportHeight) || localViewport.height
      };
    } catch (error) {
      console.warn('Failed to map iframe element rect:', error);
      return localRect;
    }
  }

  async getFrameOffset() {
    const now = Date.now();
    if (this.frameOffsetCache && now - this.frameOffsetCache.createdAt < 1000) {
      return this.frameOffsetCache;
    }

    if (!this.isInIframe()) {
      const viewport = this.getLocalViewportSize();
      this.frameOffsetCache = {
        left: 0,
        top: 0,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        createdAt: now
      };
      return this.frameOffsetCache;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'GET_FRAME_OFFSET',
      frameUrl: window.location.href
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Unable to locate iframe on top page');
    }

    this.frameOffsetCache = {
      left: Number(response.left) || 0,
      top: Number(response.top) || 0,
      viewportWidth: Number(response.viewportWidth) || this.getLocalViewportSize().width,
      viewportHeight: Number(response.viewportHeight) || this.getLocalViewportSize().height,
      createdAt: now
    };
    return this.frameOffsetCache;
  }

  async captureElementImage(element) {
    const rect = await this.getElementViewportRect(element);
    if (!rect) return null;

    const cacheKey = this.getElementCaptureCacheKey(element, rect);
    const cached = this.elementCaptureCache.get(cacheKey);
    if (cached?.dataUrl && Date.now() - cached.createdAt < 1200) {
      return cached.dataUrl;
    }

    try {
      const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
      if (!capture?.success || !capture.dataUrl) {
        console.warn('Element image capture failed:', capture?.error);
        return null;
      }

      const dataUrl = await this.cropScreenshotDataUrl(capture.dataUrl, rect);
      if (dataUrl) {
        this.elementCaptureCache.set(cacheKey, { dataUrl, createdAt: Date.now() });
        this.pruneElementCaptureCache();
      }
      return dataUrl;
    } catch (error) {
      console.error('Element image capture error:', error);
      return null;
    }
  }

  getElementCaptureCacheKey(element, rect) {
    const rule = this.findAuthorizedRuleForElement(element);
    const ruleKey = rule ? this.getDetectionKey(rule) : element.tagName;
    return [
      ruleKey,
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join(':');
  }

  pruneElementCaptureCache() {
    const now = Date.now();
    for (const [key, value] of Array.from(this.elementCaptureCache.entries())) {
      if (now - value.createdAt > 3000) this.elementCaptureCache.delete(key);
    }
    if (this.elementCaptureCache.size > 20) {
      const oldest = this.elementCaptureCache.keys().next().value;
      this.elementCaptureCache.delete(oldest);
    }
  }

  async decodeQRFromScreenshotDataUrl(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const viewport = this.getScreenshotViewportSize(rect);
          const scaleX = img.naturalWidth / viewport.width;
          const scaleY = img.naturalHeight / viewport.height;
          const padding = 12;
          const sourceX = Math.max(0, Math.floor((rect.left - padding) * scaleX));
          const sourceY = Math.max(0, Math.floor((rect.top - padding) * scaleY));
          const sourceWidth = Math.min(
            img.naturalWidth - sourceX,
            Math.ceil((rect.width + padding * 2) * scaleX)
          );
          const sourceHeight = Math.min(
            img.naturalHeight - sourceY,
            Math.ceil((rect.height + padding * 2) * scaleY)
          );

          if (sourceWidth <= 0 || sourceHeight <= 0) {
            resolve(null);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

          const qrData = this.decodeQRFromCanvasElement(canvas);
          resolve(qrData);
        } catch (error) {
          console.error('Screenshot crop QR decode failed:', error);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async cropScreenshotDataUrl(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const viewport = this.getScreenshotViewportSize(rect);
          const scaleX = img.naturalWidth / viewport.width;
          const scaleY = img.naturalHeight / viewport.height;
          const padding = 12;
          const sourceX = Math.max(0, Math.floor((rect.left - padding) * scaleX));
          const sourceY = Math.max(0, Math.floor((rect.top - padding) * scaleY));
          const sourceWidth = Math.min(
            img.naturalWidth - sourceX,
            Math.ceil((rect.width + padding * 2) * scaleX)
          );
          const sourceHeight = Math.min(
            img.naturalHeight - sourceY,
            Math.ceil((rect.height + padding * 2) * scaleY)
          );

          if (sourceWidth <= 0 || sourceHeight <= 0) {
            resolve(null);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          console.error('Screenshot crop failed:', error);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async decodeLatestFromElement(element) {
    if (!element || !element.isConnected) return null;

    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'canvas') {
      const content = await this.decodeQRFromCanvas(element);
      return content ? { content, imageSrc: null, element } : null;
    }

    if (tagName === 'img') {
      let content = await this.decodeQRFromImage(element);
      if (!content) content = await this.decodeQRFromElementScreenshot(element);
      return content ? { content, imageSrc: this.getImageSource(element), element } : null;
    }

    for (const imageSrc of this.getBackgroundImageSources(element)) {
      const content = await this.decodeQRFromUrl(imageSrc);
      if (content) return { content, imageSrc, element };
    }

    const canvases = Array.from(element.querySelectorAll('canvas'));
    for (const canvas of canvases) {
      const content = await this.decodeQRFromCanvas(canvas);
      if (content) return { content, imageSrc: null, element: canvas };
    }

    const images = Array.from(element.querySelectorAll('img'));
    for (const img of images) {
      if (!img.complete || img.naturalWidth <= 0) continue;
      const content = await this.decodeQRFromImage(img);
      if (content) return { content, imageSrc: this.getImageSource(img), element: img };
    }

    const backgroundElements = Array.from(element.querySelectorAll('*'));
    for (const backgroundElement of backgroundElements) {
      for (const imageSrc of this.getBackgroundImageSources(backgroundElement)) {
        const content = await this.decodeQRFromUrl(imageSrc);
        if (content) return { content, imageSrc, element: backgroundElement };
      }
    }

    const screenshotContent = await this.decodeQRFromElementScreenshot(element);
    if (screenshotContent) {
      return { content: screenshotContent, imageSrc: null, element };
    }

    return null;
  }

  getCandidateElementsForRule(rule, preferredElement = null) {
    const candidates = [];
    if (preferredElement?.isConnected && this.isElementVisible(preferredElement)) {
      candidates.push(preferredElement);
    }

    for (const root of this.getVisibleRuleMatches(rule)) {
      candidates.push(root);
      if (!root.matches('canvas')) {
        candidates.push(...root.querySelectorAll('canvas'));
      }
      if (!root.matches('img')) {
        candidates.push(...root.querySelectorAll('img'));
      }
      candidates.push(...root.querySelectorAll('*'));
    }

    return Array.from(new Set(candidates))
      .filter(element => this.isElementVisible(element));
  }

  async findCurrentDetectionForRule(rule, preferredElement = null) {
    const candidates = this.getCandidateElementsForRule(rule, preferredElement);

    for (const candidate of candidates) {
      const currentRule = this.findAuthorizedRuleForElement(candidate);
      if (!this.isSameRule(currentRule, rule)) continue;

      const latest = await this.decodeLatestFromElement(candidate);
      if (latest?.content) {
        return {
          ...latest,
          rule: currentRule
        };
      }
    }

    return null;
  }

  recordAuthorizedDetection(content, imageSrc, element, rule, targetKey = null, options = {}) {
    if (!element || !rule) return;

    const key = targetKey || this.getDetectionKey(rule);
    const dismissedKey = content
      ? this.getDetectionContentKey(rule, content)
      : key;
    if (this.dismissedDetections.has(dismissedKey)) return;

    const existing = this.detectedTargets.get(key);
    const sameContent = existing?.content === content;
    const status = sameContent ? (existing.status || 'detected') : 'detected';

    const detection = {
      key,
      content,
      imageSrc: imageSrc || options.screenshot || null,
      screenshot: options.screenshot || imageSrc || null,
      uploadData: options.uploadData || null,
      anchorRect: options.anchorRect || null,
      proxied: !!options.proxied,
      element,
      rule,
      targetKey: key,
      status: status === 'uploaded' && !sameContent ? 'detected' : status,
      error: sameContent ? existing?.error || null : null,
      foundAt: existing?.foundAt || Date.now(),
      updatedAt: Date.now()
    };

    this.detectedTargets.set(key, detection);

    if (content) this.currentQRData = content;
    if (this.canAutoUpload()) {
      this.autoUploadDetectedTarget(key, detection);
      return;
    }
    this.renderDetectionPanel();
  }

  recordProxiedAuthorizedDetection(detection) {
    const rule = this.buildRuleFromSnapshot(detection?.rule);
    if (!rule) return;

    const key = detection.key || this.getDetectionKey(rule);
    if (this.dismissedDetections.has(key)) return;

    const existing = this.detectedTargets.get(key);
    if (existing) return;

    const content = detection.content || '';

    const targetDetection = {
      key,
      content,
      imageSrc: detection.imageSrc || detection.screenshot || null,
      screenshot: detection.screenshot || detection.imageSrc || null,
      uploadData: detection.uploadData || null,
      anchorRect: detection.anchorRect || null,
      proxied: true,
      element: null,
      rule,
      targetKey: key,
      status: 'detected',
      error: null,
      foundAt: Date.now(),
      updatedAt: Date.now()
    };

    this.detectedTargets.set(key, targetDetection);

    if (this.canAutoUpload()) {
      this.autoUploadDetectedTarget(key, targetDetection);
      return;
    }
    this.renderDetectionPanel();
  }

  getAutoUploadThrottleKey(detection) {
    const rule = detection?.rule;
    const selector = detection?.uploadData?.matchedSelector || rule?.target?.selector || '';
    const clientAuthorizationId = this.getAutoUploadClientAuthorizationId() || 'client';
    return `${clientAuthorizationId}:${rule?.site?.id || 'site'}:${rule?.target?.id || 'target'}:${selector}`;
  }

  getRuleAutoUploadThrottleKey(rule) {
    return this.getAutoUploadThrottleKey({
      rule,
      uploadData: {
        matchedSelector: rule?.target?.selector || ''
      }
    });
  }

  isAutoUploadThrottledForRule(rule) {
    if (!this.canAutoUpload()) return false;
    const throttleKey = this.getRuleAutoUploadThrottleKey(rule);
    const lastAt = Number(this.autoUploadLastAt.get(throttleKey) || 0);
    return Date.now() - lastAt < 60000;
  }

  isAutoUploadInFlightForRule(rule) {
    if (!this.canAutoUpload()) return false;
    return this.autoUploadInFlightKeys.has(this.getRuleAutoUploadThrottleKey(rule));
  }

  hasRecentForwardedDetection(key) {
    const lastAt = Number(this.forwardedDetectionKeys.get?.(key) || 0);
    return lastAt > 0 && Date.now() - lastAt < 55000;
  }

  rememberForwardedDetection(key) {
    if (!(this.forwardedDetectionKeys instanceof Map)) {
      this.forwardedDetectionKeys = new Map();
    }
    this.forwardedDetectionKeys.set(key, Date.now());
    if (this.forwardedDetectionKeys.size > 80) {
      const oldest = this.forwardedDetectionKeys.keys().next().value;
      this.forwardedDetectionKeys.delete(oldest);
    }
  }

  tryAutoUploadDetectedTargets() {
    if (this.isInIframe() || !this.canAutoUpload()) return;

    Array.from(this.detectedTargets.entries()).forEach(([key, detection]) => {
      if (detection?.status !== 'uploading') {
        this.autoUploadDetectedTarget(key, detection);
      }
    });
  }

  setAutoUploadStatus(status) {
    this.autoUploadStatus = {
      status: status.status || 'idle',
      message: status.message || '',
      key: status.key || null,
      updatedAt: Date.now()
    };
    this.renderDetectionPanel();
  }

  async autoUploadDetectedTarget(key, detection) {
    if (this.isInIframe() || !this.canAutoUpload() || !detection) return false;

    const throttleKey = this.getAutoUploadThrottleKey(detection);
    const now = Date.now();
    const lastAt = Number(this.autoUploadLastAt.get(throttleKey) || 0);
    if (this.autoUploadInFlightKeys.has(throttleKey) || now - lastAt < 60000) {
      this.setAutoUploadStatus({
        status: 'success',
        message: '已自动上传',
        key: throttleKey
      });
      this.detectedTargets.delete(key);
      return true;
    }

    this.autoUploadInFlightKeys.add(throttleKey);
    detection.status = 'uploading';
    this.setAutoUploadStatus({
      status: 'uploading',
      message: '自动上传中',
      key: throttleKey
    });

    try {
      await this.refreshCollectionPolicy(true);
      const fallbackImage = detection.screenshot ||
        detection.uploadData?.image ||
        detection.imageSrc ||
        (detection.element ? await this.captureElementImage(detection.element) : null);

      if (!fallbackImage) {
        throw new Error('无法截取授权目标图片');
      }

      const uploadMode = this.getAutoUploadMode();
      const clientAuthorizationId = this.getAutoUploadClientAuthorizationId();
      const data = detection.uploadData
        ? {
          ...detection.uploadData,
          content: detection.uploadData.content || '',
          image: fallbackImage,
          imageSrc: fallbackImage,
          uploadMode,
          clientAuthorizationId
        }
        : {
          ...this.buildUploadData('', fallbackImage, detection.element, detection.rule),
          uploadMode,
          clientAuthorizationId
        };

      const response = await chrome.runtime.sendMessage({
        type: 'UPLOAD_QR',
        data
      });

      if (!response?.success) {
        throw new Error(response?.error || '自动上传失败');
      }

      this.autoUploadLastAt.set(throttleKey, Date.now());
      this.detectedTargets.delete(key);
      this.setAutoUploadStatus({
        status: 'success',
        message: '已自动上传',
        key: throttleKey
      });
      return true;
    } catch (error) {
      detection.status = 'error';
      detection.error = error.message || '自动上传失败';
      this.autoUploadLastAt.set(throttleKey, Date.now());
      this.setAutoUploadStatus({
        status: 'error',
        message: '自动上传失败',
        key: throttleKey
      });
      this.detectedTargets.delete(key);
      return false;
    } finally {
      this.autoUploadInFlightKeys.delete(throttleKey);
    }
  }

  dismissDetection(key) {
    const detection = this.detectedTargets.get(key);
    if (detection) {
      this.rememberDismissedDetection(detection.rule, detection.content || detection.targetKey || key);
      this.detectedTargets.delete(key);
    }
    this.renderDetectionPanel();
  }

  getEmailRuleKey(rule) {
    return `${rule.site.id}:${rule.rule.id}`;
  }

  applyEmailVerificationRules() {
    if (this.authState.user?.auth_type !== 'ip' || this.authState.user?.role !== 'user') {
      this.clearEmailVerificationBindings();
      return;
    }

    const activeKeys = new Set();
    for (const rule of this.activeEmailVerificationRules || []) {
      const key = this.getEmailRuleKey(rule);
      activeKeys.add(key);

      let sendButton = null;
      try {
        sendButton = document.querySelector(rule.rule.send_button_selector);
      } catch (error) {
        console.warn('Invalid email verification send selector:', rule.rule.send_button_selector, error);
      }
      if (!sendButton) continue;

      const existing = this.emailRuleBindings.get(key);
      if (existing?.element === sendButton && sendButton.isConnected) continue;
      if (existing) {
        existing.element?.removeEventListener('click', existing.handler, true);
        this.emailRuleBindings.delete(key);
      }

      const handler = () => {
        this.handleEmailVerificationSendClick(rule);
      };
      sendButton.addEventListener('click', handler, true);
      this.emailRuleBindings.set(key, { element: sendButton, handler });
    }

    for (const [key, binding] of Array.from(this.emailRuleBindings.entries())) {
      if (!activeKeys.has(key) || !binding.element?.isConnected) {
        binding.element?.removeEventListener('click', binding.handler, true);
        this.emailRuleBindings.delete(key);
      }
    }

    if (this.emailRuleBindings.size > 0 && !this.emailVerificationStatus) {
      this.setEmailVerificationStatus('success', '邮箱验证码已就绪');
    } else if (this.emailRuleBindings.size === 0 && this.emailVerificationStatus?.message === '邮箱验证码已就绪') {
      this.emailVerificationStatus = null;
      this.renderDetectionPanel();
    }
  }

  clearEmailVerificationBindings() {
    for (const binding of this.emailRuleBindings.values()) {
      binding.element?.removeEventListener('click', binding.handler, true);
    }
    this.emailRuleBindings.clear();
    if (this.emailRuleApplyTimer) {
      window.clearTimeout(this.emailRuleApplyTimer);
      this.emailRuleApplyTimer = null;
    }
  }

  scheduleApplyEmailVerificationRules() {
    if (this.emailRuleApplyTimer) return;
    this.emailRuleApplyTimer = window.setTimeout(() => {
      this.emailRuleApplyTimer = null;
      this.applyEmailVerificationRules();
    }, 250);
  }

  getEmailAssignmentAddress() {
    return String(this.userAssignmentWorkspace?.emailAssignment?.email_address || '').trim().toLowerCase();
  }

  readValueBySelector(selector) {
    try {
      const element = document.querySelector(selector);
      if (!element) return '';
      return String(element.value || element.getAttribute('value') || element.textContent || '').trim();
    } catch {
      return '';
    }
  }

  setValueBySelector(selector, value) {
    const element = document.querySelector(selector);
    if (!element) return false;
    element.focus?.();
    element.value = value;
    element.setAttribute('value', value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  fillAssignedEmailInCurrentFrame(emailAddress = this.getEmailAssignmentAddress()) {
    const normalizedEmail = String(emailAddress || '').trim();
    if (!normalizedEmail || !this.isUserEmailEnabled()) return false;

    for (const rule of this.activeEmailVerificationRules || []) {
      if (this.setValueBySelector(rule.rule.email_input_selector, normalizedEmail)) {
        this.setEmailVerificationStatus('success', '邮箱已填入');
        return true;
      }
    }

    return false;
  }

  async fillAssignedEmailFromDrawer() {
    const emailAddress = this.getEmailAssignmentAddress();
    if (!emailAddress) {
      this.setEmailVerificationStatus('warning', '暂未分配验证码邮箱');
      return;
    }
    if (!this.isUserEmailEnabled()) {
      this.setEmailVerificationStatus('warning', '邮箱验证码未开启');
      return;
    }

    if (this.fillAssignedEmailInCurrentFrame(emailAddress)) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FILL_ASSIGNED_EMAIL_ALL_FRAMES',
        data: { emailAddress }
      });
      const filled = !!response?.filled;
      this.setEmailVerificationStatus(filled ? 'success' : 'warning', filled ? '邮箱已填入' : '未找到邮箱输入框');
    } catch (error) {
      this.setEmailVerificationStatus('error', error.message || '邮箱填充失败');
    }
  }

  setEmailVerificationStatus(status, message) {
    const nextStatus = {
      status,
      message,
      updatedAt: Date.now()
    };
    this.emailVerificationStatus = nextStatus;
    if (this.isInIframe()) {
      chrome.runtime.sendMessage({
        type: 'REPORT_EMAIL_VERIFICATION_STATUS',
        status: nextStatus
      }).catch(() => {});
    }
    this.renderDetectionPanel();
  }

  async handleEmailVerificationSendClick(rule) {
    const ruleKey = this.getEmailRuleKey(rule);
    if (this.emailVerificationTasks.has(ruleKey)) {
      this.setEmailVerificationStatus('polling', '验证码监听已启动，正在等待邮箱验证码');
      return;
    }

    if (!this.isUserEmailEnabled()) {
      this.setEmailVerificationStatus('warning', '邮箱验证码未开启');
      return;
    }
    const assignedEmail = this.getEmailAssignmentAddress();
    if (!assignedEmail) {
      this.setEmailVerificationStatus('warning', '暂未分配验证码邮箱');
      return;
    }

    const pageEmail = this.readValueBySelector(rule.rule.email_input_selector).toLowerCase();
    if (!pageEmail || pageEmail !== assignedEmail) {
      this.setEmailVerificationStatus('warning', '页面邮箱与授权邮箱不一致，已放行点击但不会监听');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EMAIL_VERIFICATION_TASK_CREATE',
        data: {
          siteId: rule.site.id,
          ruleId: rule.rule.id,
          sourceUrl: this.getPolicyUrl(),
          emailAddress: pageEmail
        }
      });
      if (!response?.success) {
        throw new Error(response?.error || '验证码监听任务创建失败');
      }
      const taskId = response.data?.task?.id;
      if (!taskId) throw new Error('验证码监听任务响应无效');

      this.emailVerificationTasks.set(ruleKey, { taskId, startedAt: Date.now() });
      this.setEmailVerificationStatus('polling', '正在等待邮箱验证码');
      this.pollEmailVerificationTask(taskId, rule);
    } catch (error) {
      this.emailVerificationTasks.delete(ruleKey);
      this.setEmailVerificationStatus('error', error.message || '验证码监听启动失败');
    }
  }

  async pollEmailVerificationTask(taskId, rule, attempt = 0) {
    const ruleKey = this.getEmailRuleKey(rule);
    if (attempt > 40) {
      this.emailVerificationTasks.delete(ruleKey);
      this.setEmailVerificationStatus('error', '验证码监听超时');
      return;
    }

    window.setTimeout(async () => {
      const currentTask = this.emailVerificationTasks.get(ruleKey);
      if (!currentTask || Number(currentTask.taskId) !== Number(taskId)) return;

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'EMAIL_VERIFICATION_TASK_GET',
          data: { taskId }
        });
        if (!response?.success) {
          throw new Error(response?.error || '验证码监听失败');
        }

        const task = response.data?.task || {};
        if (task.status === 'matched' && task.verification_code) {
          const filled = this.setValueBySelector(rule.rule.code_input_selector, task.verification_code);
          this.emailVerificationTasks.delete(ruleKey);
          this.setEmailVerificationStatus(filled ? 'success' : 'warning', filled ? '验证码已自动填入' : '验证码已获取，但输入框未找到');
          return;
        }
        if (task.status === 'expired' || task.status === 'failed') {
          this.emailVerificationTasks.delete(ruleKey);
          this.setEmailVerificationStatus('error', task.error || '验证码监听失败');
          return;
        }

        this.pollEmailVerificationTask(taskId, rule, attempt + 1);
      } catch (error) {
        this.emailVerificationTasks.delete(ruleKey);
        this.setEmailVerificationStatus('error', error.message || '验证码监听失败');
      }
    }, attempt === 0 ? 1500 : 3000);
  }

  startHiddenRuleObserver() {
    if (this.hideMutationObserver) return;

    this.hideMutationObserver = new MutationObserver((mutations) => {
      const onlyExtensionChanges = mutations.every((mutation) => {
        const target = mutation.target;
        return target?.nodeType === Node.ELEMENT_NODE && this.isExtensionManagedElement(target);
      });
      if (!onlyExtensionChanges) this.scheduleApplyHiddenRules();
      if (!onlyExtensionChanges) this.scheduleApplyEmailVerificationRules();
    });
    this.hideMutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });

    this.hideScrollHandler = () => this.scheduleApplyHiddenRules();
    this.hideResizeHandler = () => this.scheduleApplyHiddenRules();
    window.addEventListener('scroll', this.hideScrollHandler, true);
    window.addEventListener('resize', this.hideResizeHandler, true);
  }

  scheduleApplyHiddenRules() {
    if (this.hideApplyTimer) return;
    this.hideApplyTimer = window.setTimeout(() => {
      this.hideApplyTimer = null;
      this.applyHiddenRules();
    }, 120);
  }

  applyHiddenRules() {
    if (this.hidePaused) {
      this.restoreHiddenRules();
      return;
    }

    const activeStateKeys = new Set();
    const activeRemoveRuleVersions = new Map();

    for (const rule of this.activeHiddenRules || []) {
      const selector = rule.hiddenRule?.selector;
      if (!selector) continue;
      if (rule.hiddenRule?.hide_method === 'remove') {
        activeRemoveRuleVersions.set(this.getHiddenRuleKey(rule), this.getHiddenRuleVersion(rule));
      }

      let elements = [];
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        console.error('Invalid hidden rule selector:', selector, error);
        continue;
      }

      for (const element of elements) {
        if (!this.canApplyHiddenRuleToElement(element)) continue;

        const stateKey = this.getHiddenElementStateKey(rule, element);
        activeStateKeys.add(stateKey);
        this.applyHiddenRuleToElement(rule, element, stateKey);
      }
    }

    for (const [stateKey, state] of Array.from(this.hiddenRuleState.entries())) {
      if (
        state.method === 'remove' &&
        activeRemoveRuleVersions.get(this.getHiddenRuleKey(state.rule)) === state.ruleVersion
      ) {
        continue;
      }

      if (!activeStateKeys.has(stateKey)) {
        this.restoreHiddenRuleState(stateKey, state);
      }
    }
  }

  canApplyHiddenRuleToElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element === document.documentElement || element === document.body || element === document.head) return false;
    if (this.isExtensionManagedElement(element)) return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  applyHiddenRuleToElement(rule, element, stateKey) {
    const method = rule.hiddenRule?.hide_method === 'remove' ? 'remove' : 'cover';
    const existing = this.hiddenRuleState.get(stateKey);

    if (existing && existing.method !== method) {
      this.restoreHiddenRuleState(stateKey, existing);
    }

    if (method === 'remove') {
      this.applyRemoveHiddenRule(rule, element, stateKey);
      return;
    }

    this.applyCoverHiddenRule(rule, element, stateKey);
  }

  applyCoverHiddenRule(rule, element, stateKey) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let state = this.hiddenRuleState.get(stateKey);
    let cover = state?.cover;

    if (!cover?.isConnected) {
      cover = document.createElement('div');
      cover.className = 'qr-hidden-rule-cover';
      cover.dataset.hiddenRuleKey = this.getHiddenRuleKey(rule);
      cover.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.74), rgba(226, 232, 240, 0.56)),
          radial-gradient(circle at 24% 20%, rgba(255, 255, 255, 0.72), transparent 34%),
          radial-gradient(circle at 80% 82%, rgba(148, 163, 184, 0.26), transparent 36%);
        border: 1px solid rgba(255, 255, 255, 0.72);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.68),
          inset 0 -24px 60px rgba(15, 23, 42, 0.08),
          0 14px 34px rgba(15, 23, 42, 0.18);
        backdrop-filter: blur(18px) saturate(1.45);
        -webkit-backdrop-filter: blur(18px) saturate(1.45);
        pointer-events: auto;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(51, 65, 85, 0.72);
        font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.02em;
        text-align: center;
        overflow: hidden;
      `;
      cover.textContent = '内容已隐藏';
      document.documentElement.appendChild(cover);
    }

    cover.style.left = `${Math.round(rect.left)}px`;
    cover.style.top = `${Math.round(rect.top)}px`;
    cover.style.width = `${Math.ceil(rect.width)}px`;
    cover.style.height = `${Math.ceil(rect.height)}px`;
    cover.style.borderRadius = this.getComputedBorderRadius(element);

    this.hiddenRuleState.set(stateKey, {
      method: 'cover',
      rule,
      ruleVersion: this.getHiddenRuleVersion(rule),
      element,
      cover
    });
  }

  applyRemoveHiddenRule(rule, element, stateKey) {
    if (this.hiddenRuleState.has(stateKey)) return;
    if (!element.parentNode) return;

    const placeholder = document.createComment(`qr-hidden-rule:${this.getHiddenRuleKey(rule)}`);
    const parent = element.parentNode;
    parent.insertBefore(placeholder, element);
    parent.removeChild(element);

    this.hiddenRuleState.set(stateKey, {
      method: 'remove',
      rule,
      ruleVersion: this.getHiddenRuleVersion(rule),
      element,
      placeholder
    });
  }

  getHiddenRuleVersion(rule) {
    const hiddenRule = rule.hiddenRule || {};
    return [
      this.getHiddenRuleKey(rule),
      hiddenRule.selector || '',
      hiddenRule.page_url_pattern || '',
      hiddenRule.hide_method || 'cover',
      hiddenRule.enabled === false ? '0' : '1'
    ].join('|');
  }

  getComputedBorderRadius(element) {
    try {
      return window.getComputedStyle(element).borderRadius || '0px';
    } catch {
      return '0px';
    }
  }

  restoreHiddenRules() {
    for (const [stateKey, state] of Array.from(this.hiddenRuleState.entries())) {
      this.restoreHiddenRuleState(stateKey, state);
    }
  }

  restoreHiddenRuleState(stateKey, state) {
    if (!state) return;

    if (state.method === 'cover') {
      state.cover?.remove();
    } else if (state.method === 'remove') {
      const placeholder = state.placeholder;
      const element = state.element;
      if (placeholder?.parentNode && element && !element.isConnected) {
        placeholder.parentNode.insertBefore(element, placeholder);
      }
      placeholder?.remove();
    }

    this.hiddenRuleState.delete(stateKey);
  }

  setHideRulesPaused(paused) {
    this.hidePaused = !!paused;
    if (this.hidePaused) {
      this.restoreHiddenRules();
    } else {
      this.applyHiddenRules();
    }
    this.renderDetectionPanel();
    return this.hidePaused;
  }

  getAuthorizationLabel(item) {
    if (!item) return '-';
    const ip = item.ip_address || item.user_ip_address || item.leader_ip_address || `#${item.id}`;
    const note = item.note || item.user_note || '';
    return note ? `${ip} · ${note}` : ip;
  }

  renderUserAssignmentContent() {
    if (this.authState.user?.auth_type !== 'ip' || this.authState.user?.role !== 'user') {
      return '';
    }

    const workspace = this.userAssignmentWorkspace || {};
    const emailAssignment = workspace.emailAssignment || null;
    const qrcodeEnabled = this.isUserQrcodeEnabled();
    const emailEnabled = this.isUserEmailEnabled();
    const isCollectionAuthorized = this.hasAssignedLeader() && qrcodeEnabled;
    const qrcodeStatusClass = qrcodeEnabled && isCollectionAuthorized
      ? 'ready'
      : qrcodeEnabled
        ? 'muted'
        : 'off';
    const qrcodeTitle = !qrcodeEnabled
      ? '二维码采集未开启'
      : isCollectionAuthorized
        ? '二维码采集已开启'
        : '二维码采集待启用';
    const qrcodeDesc = !qrcodeEnabled
      ? '后台暂未开放此能力'
      : isCollectionAuthorized
        ? '命中目标后自动上传'
        : '等待后台完成分配';
    const emailStatusClass = !emailEnabled
      ? 'off'
      : emailAssignment
        ? 'ready'
        : 'muted';
    const emailTitle = !emailEnabled
      ? '邮箱验证码未开启'
      : emailAssignment
        ? emailAssignment.email_address
        : '暂未分配邮箱';
    const emailDesc = !emailEnabled
      ? '后台暂未开放此能力'
      : emailAssignment
        ? '验证码将自动回填'
        : '等待后台分配';
    const verificationMessage = this.emailVerificationStatus?.message || (
      emailEnabled && emailAssignment
        ? '邮箱验证码已就绪'
        : '等待邮箱授权'
    );
    const verificationClass = this.emailVerificationStatus?.status === 'error'
      ? 'off'
      : this.emailVerificationStatus?.status === 'polling'
        ? 'active'
        : (emailEnabled && emailAssignment ? 'ready' : 'muted');
    const verificationDesc = this.emailVerificationStatus?.message
      ? '点击发送后短时监听'
      : '命中规则后自动处理';

    return `
      <section class="role-card user-compact-card">
        <div class="section-title">
          <span>能力状态</span>
          <button class="text-button" data-role-workspace-refresh type="button">刷新</button>
        </div>
        <div class="user-status-list">
          <div class="user-status-item ${qrcodeStatusClass}">
            <span class="status-dot"></span>
            <div>
              <strong>${this.escapeHtml(qrcodeTitle)}</strong>
              <small>${this.escapeHtml(qrcodeDesc)}</small>
            </div>
          </div>
          <button
            class="user-status-item ${emailStatusClass} ${emailEnabled && emailAssignment ? 'clickable' : ''}"
            type="button"
            ${emailEnabled && emailAssignment ? 'data-fill-assigned-email' : 'disabled'}
            title="${emailEnabled && emailAssignment ? '点击填充到页面邮箱输入框' : ''}"
          >
            <span class="status-dot"></span>
            <div>
              <strong>${this.escapeHtml(emailTitle)}</strong>
              <small>${this.escapeHtml(emailDesc)}</small>
            </div>
          </button>
          <div class="user-status-item ${verificationClass}">
            <span class="status-dot"></span>
            <div>
              <strong>${this.escapeHtml(verificationMessage)}</strong>
              <small>${this.escapeHtml(verificationDesc)}</small>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  renderLeaderWorkspaceContent() {
    if (this.authState.user?.auth_type !== 'ip' || this.authState.user?.role !== 'leader') {
      return '';
    }

    const workspace = this.leaderWorkspace || {};
    const users = workspace.users || [];
    const emailAccounts = workspace.emailAccounts || [];
    const selectedUser = this.getSelectedLeaderUser();

    const userList = users.length
      ? users.map(user => `
          <div class="user-workspace-item">
            <button
              class="list-action ${Number(this.selectedLeaderUserId) === Number(user.id) ? 'active' : ''}"
              data-leader-select-user="${this.escapeHtml(user.id)}"
              type="button"
            >
              <span>${this.escapeHtml(this.getAuthorizationLabel(user))}</span>
              <b>${Number(this.selectedLeaderUserId) === Number(user.id) ? '当前用户' : '选择'}</b>
            </button>
            <span class="user-email">
              ${this.escapeHtml(user.email_address || '未分配邮箱')}
              · 二维码${this.isFeatureEnabled(user.qrcode_enabled) ? '已开' : '已关'}
              · 邮箱${this.isFeatureEnabled(user.email_enabled) ? '已开' : '已关'}
            </span>
          </div>
        `).join('')
      : '<div class="mini-empty">暂无后台分配的普通用户</div>';

    const availableAccounts = selectedUser
      ? emailAccounts.filter(account =>
          !account.user_authorization_id ||
          Number(account.user_authorization_id) === Number(selectedUser.id)
        )
      : [];
    const emailOptions = availableAccounts.map(account => `
      <option
        value="${this.escapeHtml(account.id)}"
        ${Number(account.id) === Number(selectedUser?.email_account_id) ? 'selected' : ''}
      >${this.escapeHtml(`${account.name} · ${account.email_address}`)}</option>
    `).join('');
    const emailManager = selectedUser
      ? `
        <div class="email-manager">
          <div class="sub-title">为当前用户分配邮箱</div>
          <select data-leader-email-select ${this.emailAssignmentBusy ? 'disabled' : ''}>
            <option value="">请选择可用邮箱</option>
            ${emailOptions}
          </select>
          <div class="request-actions">
            <button class="mini-button" data-leader-email-save type="button" ${this.emailAssignmentBusy ? 'disabled' : ''}>
              ${this.emailAssignmentBusy ? '处理中...' : '保存邮箱'}
            </button>
            ${selectedUser.email_assignment_id ? `
              <button class="mini-button danger" data-leader-email-release="${this.escapeHtml(selectedUser.email_assignment_id)}" type="button" ${this.emailAssignmentBusy ? 'disabled' : ''}>
                解除绑定
              </button>
            ` : ''}
          </div>
          <span class="privacy-note">插件仅显示邮箱地址，授权码与 IMAP 配置始终保留在服务端。</span>
          ${this.emailAssignmentError ? `<p class="error">${this.escapeHtml(this.emailAssignmentError)}</p>` : ''}
        </div>
      `
      : '';

    return `
      <section class="role-card leader-card">
        <div class="section-title">
          <span>我的普通用户</span>
          <button class="text-button" data-role-workspace-refresh type="button">刷新</button>
        </div>
        ${this.leaderWorkspaceError ? `<p class="error">${this.escapeHtml(this.leaderWorkspaceError)}</p>` : ''}
        <div class="sub-title">后台分配的代扫用户</div>
        <div class="compact-list">${userList}</div>
        ${emailManager}
      </section>
    `;
  }

  getFrameOffsetForChild(frameUrl) {
    if (this.isInIframe()) return { success: false, error: 'Not top frame' };

    const frames = Array.from(document.querySelectorAll('iframe, frame'));
    const target = frames.find((frame) => {
      const src = frame.getAttribute('src') || '';
      try {
        const absoluteSrc = src ? new URL(src, window.location.href).href : '';
        return absoluteSrc === frameUrl || frame.src === frameUrl;
      } catch {
        return frame.src === frameUrl;
      }
    }) || frames.find(frame => this.isElementVisible(frame));

    if (!target) {
      return { success: false, error: 'Frame element not found' };
    }

    const rect = target.getBoundingClientRect();
    const viewport = this.getLocalViewportSize();
    return {
      success: true,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height
    };
  }

  renderDetectionPanel() {
    if (this.isInIframe() || !this.shouldShowControlDrawer()) {
      this.detectionPanel?.remove();
      this.detectionPanel = null;
      this.controlDrawerShadow = null;
      this.detectionPanelRenderSignature = '';
      return;
    }

    const detections = Array.from(this.detectedTargets.values());
    if (detections.length === 0) {
      this.detectionDrawerIndex = 0;
    } else {
      this.detectionDrawerIndex = Math.min(
        Math.max(this.detectionDrawerIndex, 0),
        detections.length - 1
      );
    }

    let panel = this.detectionPanel;
    if (!panel?.isConnected) {
      panel = document.createElement('div');
      panel.className = 'qr-authorized-detection-panel';
      panel.style.cssText = `
        position: fixed;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        z-index: 2147483647;
      `;
      document.documentElement.appendChild(panel);
      this.detectionPanel = panel;
      this.controlDrawerShadow = panel.attachShadow({ mode: 'open' });
    }

    const shadow = this.controlDrawerShadow || panel.shadowRoot;
    this.controlDrawerShadow = shadow;
    const authenticated = !!this.authState.authenticated;
    const isAdmin = this.authState.user?.role === 'admin';
    const isAutoUploadUser = this.canAutoUpload();
    const isOrdinaryIpUser = this.authState.user?.auth_type === 'ip' && this.authState.user?.role === 'user';
    const detection = detections[this.detectionDrawerIndex] || null;
    const image = detection?.screenshot || detection?.imageSrc || detection?.uploadData?.image || '';
    const isLeaderUser = this.authState.user?.auth_type === 'ip' && this.authState.user?.role === 'leader';
    const selectedLeaderUser = this.getSelectedLeaderUser();
    const selectedLeaderUserQrcodeEnabled = selectedLeaderUser ? this.isFeatureEnabled(selectedLeaderUser.qrcode_enabled) : false;
    const leaderUploadBlocked = isLeaderUser && (!selectedLeaderUser || !selectedLeaderUserQrcodeEnabled);
    const disabled = detection?.status === 'uploading' || detection?.status === 'uploaded' || leaderUploadBlocked;
    const uploadLabel = detection?.status === 'uploading'
      ? '上传中...'
      : detection?.status === 'uploaded'
        ? '已上传'
        : isLeaderUser
          ? (leaderUploadBlocked ? '请先选择组员' : '为选中用户上传')
          : '上传';
    const badge = detections.length
      ? `<span class="rail-badge">${detections.length}</span>`
      : '';
    const clientStatus = this.authState.clientAuthStatus || {};
    const connectionUrl = this.authState.serverUrl || this.getDefaultServerUrl();
    const connectionStatusText = clientStatus.status
      ? `${clientStatus.status}${clientStatus.ip_address ? ` · ${clientStatus.ip_address}` : ''}`
      : (authenticated ? 'authenticated' : 'not checked');
    const connectionContent = `
      <section class="connection-card">
        <div class="connection-label">当前连接</div>
        <div class="connection-url" title="${this.escapeHtml(connectionUrl)}">${this.escapeHtml(connectionUrl)}</div>
        <div class="connection-status">${this.escapeHtml(connectionStatusText)}</div>
      </section>
    `;
    const userRoleLabel = isAdmin
      ? '管理员'
      : this.authState.user?.role === 'leader'
        ? '组长'
        : '采集用户';
    const userHeader = authenticated
      ? `
        <header class="drawer-header">
          <div>
            <strong>${this.escapeHtml(this.authState.user?.username || '已登录')}</strong>
            <span>${userRoleLabel}</span>
          </div>
          <button class="text-button" data-control-logout type="button">退出</button>
        </header>
      `
      : `
        <header class="drawer-header">
          <div>
            <strong>二维码采集</strong>
            <span>自动检测 IP 授权</span>
          </div>
        </header>
      `;
    const loginContent = `
      <section class="ip-auth-card">
        <div class="section-title"><span>客户端授权</span></div>
        <div class="auth-status">
          <strong>${this.escapeHtml(clientStatus.ip_address || '待识别 IP')}</strong>
          <span>${this.escapeHtml(clientStatus.message || '未授权 IP 会自动登记，等待管理员批准。')}</span>
        </div>
        ${this.controlDrawerError ? `<p class="error">${this.escapeHtml(this.controlDrawerError)}</p>` : ''}
        <button class="primary-button" data-control-client-check-in type="button">重新检测授权</button>
        <button class="text-button admin-login-toggle" data-control-admin-login-toggle type="button">
          管理员账号登录
        </button>
      </section>
      <form class="login-form" data-control-login-form style="${this.adminLoginVisible ? '' : 'display:none;'}">
        <label>
          <span>管理员账号</span>
          <input name="username" autocomplete="username" required>
        </label>
        <label>
          <span>管理员密码</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <details>
          <summary>高级设置</summary>
          <label>
            <span>服务器地址</span>
            <input name="serverUrl" value="${this.escapeHtml(this.authState.serverUrl || this.getDefaultServerUrl())}">
          </label>
        </details>
        <button class="primary-button" type="submit">管理员登录</button>
      </form>
    `;
    const autoStatus = this.autoUploadStatus || {};
    const autoStatusClass = autoStatus.status === 'error'
      ? 'error'
      : autoStatus.status === 'uploading'
        ? 'uploading'
        : 'success';
    const autoUploadContent = `
      <section class="auto-upload-card ${autoStatusClass}">
        <div class="section-title"><span>自动采集</span></div>
        <strong>${this.escapeHtml(autoStatus.message || '等待授权目标')}</strong>
        <span>${autoStatus.message ? '命中后台授权目标后会自动提交，仅保留最新记录。' : '检测到授权目标后无需点击上传。'}</span>
      </section>
    `;
    const emailStatus = this.emailVerificationStatus || {};
    const emailStatusClass = emailStatus.status === 'error'
      ? 'error'
      : emailStatus.status === 'polling'
        ? 'uploading'
        : 'success';
    const emailStatusContent = emailStatus.message && !isOrdinaryIpUser
      ? `
        <section class="auto-upload-card ${emailStatusClass}">
          <div class="section-title"><span>邮箱验证码</span></div>
          <strong>${this.escapeHtml(emailStatus.message)}</strong>
          <span>点击发送验证码后，插件会按后台授权邮箱短时监听并自动填入验证码。</span>
        </section>
      `
      : '';
    const detectionContent = isOrdinaryIpUser
      ? ''
      : isAutoUploadUser
      ? autoUploadContent
      : isLeaderUser
      ? `
        <section class="empty-state">
          <strong>${selectedLeaderUser ? (selectedLeaderUserQrcodeEnabled ? '等待授权目标' : '该用户二维码采集未开启') : '请先选择代扫用户'}</strong>
          <span>${selectedLeaderUser ? (selectedLeaderUserQrcodeEnabled ? '检测到授权目标后会自动代扫上传。' : '后台开启该用户二维码采集后才能代扫上传。') : '选择已认领普通用户后，命中目标将自动代扫上传。'}</span>
        </section>
      `
      : isAdmin
      ? `
        <section class="empty-state">
          <strong>绠＄悊鍛樼厤缃ā寮?/strong>
          <span>璇蜂娇鐢ㄤ笅鏂归噰闆嗗伐鍏烽厤缃洰鏍囧拰闅愯棌瑙勫垯锛屼笉鍐嶆彁渚涗簩缁寸爜涓婁紶鍏ュ彛銆?</span>
        </section>
      `
      : false && detection
      ? `
        <section class="qr-card">
          <div class="section-title">
            <span>待上传二维码</span>
            ${detections.length > 1 ? `<b>${this.detectionDrawerIndex + 1} / ${detections.length}</b>` : ''}
          </div>
          <div class="image-box">
            ${image ? `<img src="${this.escapeHtml(image)}" alt="二维码截图">` : '<span>已命中授权目标</span>'}
          </div>
          ${detection.error ? `<p class="error">${this.escapeHtml(detection.error)}</p>` : ''}
          ${detections.length > 1 ? `
            <div class="navigation">
              <button class="icon-button" data-qr-drawer-prev type="button" aria-label="上一个">&#8592;</button>
              <button class="icon-button" data-qr-drawer-next type="button" aria-label="下一个">&#8594;</button>
            </div>
          ` : ''}
          <div class="actions">
            <button class="primary-button" data-qr-removed-upload="${this.escapeHtml(detection.key)}" type="button" ${disabled ? 'disabled' : ''}>${uploadLabel}</button>
            <button class="secondary-button" data-qr-removed-dismiss="${this.escapeHtml(detection.key)}" type="button">关闭</button>
          </div>
          ${leaderUploadBlocked ? '<p class="error">组长代扫前必须先选择一个后台分配的普通用户。</p>' : ''}
        </section>
      `
      : `
        <section class="empty-state">
          <strong>等待授权二维码</strong>
          <span>检测到目标后会在这里提示上传。</span>
        </section>
      `;
    const adminContent = isAdmin
      ? `
        <section class="admin-tools">
          <div class="section-title"><span>管理员工具</span></div>
          <button class="tool-button" data-control-collect="qrcode_target" type="button">采集二维码目标</button>
          <button class="tool-button" data-control-collect="email_verification" type="button">采集邮箱验证码场景</button>
          <button class="tool-button" data-control-collect="hidden_element" type="button">采集隐藏元素</button>
          <button class="tool-button" data-control-toggle-hide type="button">${this.hidePaused ? '恢复当前页隐藏' : '暂停当前页隐藏'}</button>
        </section>
      `
      : '';
    const roleContent = authenticated && !isAdmin
      ? `${this.renderUserAssignmentContent()}${this.renderLeaderWorkspaceContent()}`
      : '';

    const nextPanelHtml = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        button, input, select { font: inherit; }
        button { transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease; }
        button:hover { box-shadow: 0 3px 10px rgba(15, 23, 42, .08); }
        button:active { transform: scale(0.98); }
        button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #14b8a6; outline-offset: 2px; }
        .root { color: #172033; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .rail {
          position: absolute; top: 50%; right: ${this.detectionDrawerCollapsed ? '0' : 'min(300px, calc(100vw - 24px))'};
          width: 44px; min-height: 88px; transform: translateY(-50%);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
          border: 1px solid rgba(15, 23, 42, .1); border-right: 0; border-radius: 14px 0 0 14px;
          background: rgba(255, 255, 255, .96); color: #0f766e;
          box-shadow: -8px 8px 24px rgba(15, 23, 42, .14); cursor: pointer;
        }
        .rail:hover { background: #f0fdfa; box-shadow: -10px 10px 28px rgba(15, 118, 110, .18); }
        .rail:active { transform: translateY(-50%) scale(0.98); }
        .rail-icon { font-size: 18px; font-weight: 800; }
        .rail-badge { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 11px; font-weight: 700; line-height: 20px; }
        .drawer {
          width: min(300px, calc(100vw - 24px)); max-height: min(620px, calc(100vh - 24px)); overflow-y: auto;
          border: 1px solid rgba(15, 23, 42, .1); border-right: 0; border-radius: 16px 0 0 16px;
          background: rgba(255, 255, 255, .98); box-shadow: -14px 18px 40px rgba(15, 23, 42, .16);
          transform: translateX(${this.detectionDrawerCollapsed ? '100%' : '0'}); opacity: ${this.detectionDrawerCollapsed ? '0' : '1'};
          pointer-events: ${this.detectionDrawerCollapsed ? 'none' : 'auto'}; transition: transform 180ms ease, opacity 150ms ease;
        }
        .drawer-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border-bottom: 1px solid #eef2f7; }
        .drawer-header strong, .drawer-header span { display: block; }
        .drawer-header span, label span, .empty-state span { color: #64748b; font-size: 11px; margin-top: 2px; }
        .connection-card {
          display: grid;
          gap: 4px;
          padding: 10px 14px;
          border-bottom: 1px solid #eef2f7;
          background: linear-gradient(135deg, #f8fafc 0%, #f0fdfa 100%);
        }
        .connection-label {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .02em;
        }
        .connection-url {
          color: #0f172a;
          font-size: 12px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .connection-status {
          color: #0f766e;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .login-form, .qr-card, .admin-tools, .empty-state, .ip-auth-card, .auto-upload-card, .role-card { padding: 14px; }
        label { display: block; margin-bottom: 10px; }
        input { width: 100%; margin-top: 5px; padding: 9px 10px; border: 1px solid #dbe3ec; border-radius: 8px; color: #172033; background: #fff; }
        select { width: 100%; padding: 8px 9px; border: 1px solid #dbe3ec; border-radius: 8px; color: #172033; background: #fff; }
        details { margin: 4px 0 12px; color: #64748b; font-size: 12px; }
        summary { cursor: pointer; margin-bottom: 8px; }
        .section-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; color: #64748b; font-size: 12px; }
        .section-title b { color: #0f766e; }
        .image-box { min-height: 104px; max-height: 180px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 11px; background: #f8fafc; color: #64748b; font-size: 12px; }
        .image-box img { display: block; max-width: 100%; max-height: 180px; }
        .actions, .navigation { display: flex; gap: 8px; margin-top: 10px; }
        .navigation { justify-content: flex-end; }
        .primary-button, .secondary-button, .tool-button, .icon-button, .text-button { border-radius: 8px; cursor: pointer; }
        .primary-button { flex: 1; padding: 9px 12px; border: 0; background: #0f766e; color: #fff; font-weight: 700; }
        .primary-button:hover:not(:disabled) { background: #0d9488; box-shadow: 0 7px 16px rgba(15, 118, 110, .22); }
        .primary-button:disabled { background: #94a3b8; cursor: not-allowed; }
        .secondary-button, .icon-button, .tool-button { border: 1px solid #e2e8f0; background: #fff; color: #475569; }
        .secondary-button { padding: 9px 12px; }
        .icon-button { width: 30px; height: 28px; }
        .tool-button { width: 100%; margin-top: 7px; padding: 9px 10px; text-align: left; }
        .secondary-button:hover, .icon-button:hover, .tool-button:hover { border-color: #99f6e4; background: #f0fdfa; color: #0f766e; }
        .text-button { border: 0; background: transparent; color: #0f766e; cursor: pointer; }
        .admin-tools { border-top: 1px solid #eef2f7; }
        .empty-state { display: grid; gap: 3px; }
        .auth-status { display: grid; gap: 4px; padding: 10px; margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
        .auth-status span { color: #64748b; font-size: 12px; }
        .auth-status.warning { border-color: #fde68a; background: #fffbeb; }
        .auth-status.pending { border-color: #bfdbfe; background: #eff6ff; }
        .auto-upload-card { display: grid; gap: 6px; border-bottom: 1px solid #eef2f7; }
        .auto-upload-card strong { color: #0f172a; font-size: 14px; }
        .auto-upload-card span { color: #64748b; font-size: 12px; }
        .auto-upload-card.success strong { color: #0f766e; }
        .auto-upload-card.uploading strong { color: #0369a1; }
        .auto-upload-card.error strong { color: #b91c1c; }
        .role-card { border-top: 1px solid #eef2f7; }
        .user-compact-card { border-top: 0; }
        .user-status-list { display: grid; gap: 8px; }
        .user-status-item {
          display: grid;
          grid-template-columns: 8px minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 11px;
          background: #f8fafc;
          color: inherit;
          text-align: left;
          font: inherit;
        }
        button.user-status-item { cursor: pointer; }
        button.user-status-item:disabled { cursor: default; }
        .user-status-item.clickable:hover { border-color: #14b8a6; background: #ecfdf5; box-shadow: 0 5px 14px rgba(15, 118, 110, .1); }
        .user-status-item strong,
        .user-status-item small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .user-status-item strong { color: #0f172a; font-size: 13px; }
        .user-status-item small { margin-top: 2px; color: #64748b; font-size: 11px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; }
        .user-status-item.ready { border-color: #99f6e4; background: #f0fdfa; }
        .user-status-item.ready .status-dot { background: #14b8a6; }
        .user-status-item.active { border-color: #bae6fd; background: #f0f9ff; }
        .user-status-item.active .status-dot { background: #0ea5e9; }
        .user-status-item.off { border-color: #fecaca; background: #fff1f2; }
        .user-status-item.off .status-dot { background: #ef4444; }
        .user-status-item.muted { border-color: #e2e8f0; background: #f8fafc; }
        .sub-title { margin: 12px 0 6px; color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .02em; }
        .compact-list { display: grid; gap: 6px; }
        .user-workspace-item { display: grid; gap: 3px; }
        .user-email { padding: 0 9px; color: #64748b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .list-action {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          width: 100%; padding: 8px 9px; border: 1px solid #e2e8f0; border-radius: 9px;
          background: #fff; color: #334155; text-align: left; cursor: pointer;
        }
        .list-action:hover { border-color: #99f6e4; background: #f0fdfa; color: #0f766e; }
        .list-action.active { border-color: #0f766e; background: #ccfbf1; color: #0f766e; }
        .list-action span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .list-action b { flex: 0 0 auto; color: inherit; font-size: 11px; }
        .mini-empty { padding: 8px 9px; border: 1px dashed #dbe3ec; border-radius: 9px; color: #94a3b8; font-size: 12px; }
        .request-item { display: grid; gap: 7px; padding: 9px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }
        .request-item strong, .request-item span { display: block; }
        .request-item span { color: #64748b; font-size: 11px; }
        .request-actions { display: flex; gap: 6px; }
        .mini-button { flex: 1; padding: 6px 8px; border: 1px solid #99f6e4; border-radius: 7px; background: #f0fdfa; color: #0f766e; cursor: pointer; }
        .mini-button.danger { border-color: #fecaca; background: #fff1f2; color: #b91c1c; }
        .mini-button:disabled { opacity: .58; cursor: not-allowed; }
        .email-status { display: grid; gap: 4px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
        .email-status.assigned { border-color: #99f6e4; background: #f0fdfa; }
        .email-status strong { color: #0f172a; font-size: 13px; }
        .email-status span, .privacy-note { color: #64748b; font-size: 11px; }
        .email-manager { display: grid; gap: 8px; margin-top: 12px; padding-top: 2px; }
        .admin-login-toggle { margin-top: 10px; padding: 0; }
        .error { margin: 8px 0 0; color: #b91c1c; font-size: 12px; }
      </style>
      <div class="root">
        <button class="rail" data-qr-drawer-toggle type="button" aria-label="${this.detectionDrawerCollapsed ? '展开控制面板' : '收起控制面板'}">
          <span class="rail-icon">${this.detectionDrawerCollapsed ? '&#8249;' : '&#8250;'}</span>
          ${badge}
        </button>
        <aside class="drawer">
          ${userHeader}
          ${connectionContent}
          ${authenticated ? roleContent + emailStatusContent + detectionContent + adminContent : loginContent}
        </aside>
      </div>
    `;

    if (this.detectionPanelRenderSignature === nextPanelHtml && shadow.innerHTML) {
      return;
    }

    this.detectionPanelRenderSignature = nextPanelHtml;
    shadow.innerHTML = nextPanelHtml;

    shadow.querySelector('[data-qr-drawer-toggle]')?.addEventListener('click', () => {
      this.detectionDrawerCollapsed = !this.detectionDrawerCollapsed;
      this.renderDetectionPanel();
    });
    shadow.querySelector('[data-qr-drawer-prev]')?.addEventListener('click', () => {
      this.detectionDrawerIndex = (this.detectionDrawerIndex - 1 + detections.length) % detections.length;
      this.renderDetectionPanel();
    });
    shadow.querySelector('[data-qr-drawer-next]')?.addEventListener('click', () => {
      this.detectionDrawerIndex = (this.detectionDrawerIndex + 1) % detections.length;
      this.renderDetectionPanel();
    });
    shadow.querySelector('[data-fill-assigned-email]')?.addEventListener('click', () => {
      this.fillAssignedEmailFromDrawer();
    });
    shadow.querySelector('[data-qr-removed-upload]')?.addEventListener('click', event => {
      this.removedManualQRCodeUpload(event.currentTarget.getAttribute('data-qr-removed-upload'));
    });
    shadow.querySelector('[data-qr-removed-dismiss]')?.addEventListener('click', event => {
      this.dismissDetection(event.currentTarget.getAttribute('data-qr-removed-dismiss'));
    });
    shadow.querySelector('[data-control-login-form]')?.addEventListener('submit', event => {
      event.preventDefault();
      this.loginFromControlDrawer(event.currentTarget);
    });
    shadow.querySelector('[data-control-client-check-in]')?.addEventListener('click', () => {
      this.checkInClientAuth(true);
    });
    shadow.querySelector('[data-control-admin-login-toggle]')?.addEventListener('click', () => {
      this.adminLoginVisible = !this.adminLoginVisible;
      this.renderDetectionPanel();
    });
    shadow.querySelector('[data-control-logout]')?.addEventListener('click', () => this.logoutFromControlDrawer());
    shadow.querySelectorAll('[data-control-collect]').forEach(button => {
      button.addEventListener('click', () => this.startAdminCollectionFromDrawer(button.dataset.controlCollect));
    });
    shadow.querySelector('[data-control-toggle-hide]')?.addEventListener('click', () => this.toggleHideRulesFromDrawer());
    shadow.querySelectorAll('[data-role-workspace-refresh]').forEach(button => {
      button.addEventListener('click', () => this.refreshRoleWorkspaceFromDrawer());
    });
    shadow.querySelectorAll('[data-leader-select-user]').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedLeaderUserId = Number(button.dataset.leaderSelectUser);
        this.emailAssignmentError = '';
        this.tryAutoUploadDetectedTargets();
        this.renderDetectionPanel();
      });
    });
    shadow.querySelector('[data-leader-email-save]')?.addEventListener('click', () => {
      const select = shadow.querySelector('[data-leader-email-select]');
      this.saveLeaderEmailAssignment(Number(select?.value || 0));
    });
    shadow.querySelector('[data-leader-email-release]')?.addEventListener('click', button => {
      this.releaseLeaderEmailAssignment(Number(button.currentTarget.dataset.leaderEmailRelease || 0));
    });
  }

  async refreshRoleWorkspaceFromDrawer() {
    await this.refreshRoleWorkspace();
    this.renderDetectionPanel();
  }

  async saveLeaderEmailAssignment(emailAccountId) {
    if (!this.selectedLeaderUserId) {
      this.emailAssignmentError = '请先选择普通用户';
      this.renderDetectionPanel();
      return;
    }
    if (!emailAccountId) {
      this.emailAssignmentError = '请选择可用邮箱';
      this.renderDetectionPanel();
      return;
    }

    this.emailAssignmentBusy = true;
    this.emailAssignmentError = '';
    this.renderDetectionPanel();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EMAIL_ASSIGNMENT_SAVE',
        data: {
          userAuthorizationId: this.selectedLeaderUserId,
          emailAccountId
        }
      });
      if (!response?.success) {
        throw new Error(response?.error || '邮箱分配失败');
      }
      await this.refreshRoleWorkspace();
    } catch (error) {
      this.emailAssignmentError = error.message || '邮箱分配失败';
    } finally {
      this.emailAssignmentBusy = false;
      this.renderDetectionPanel();
    }
  }

  async releaseLeaderEmailAssignment(assignmentId) {
    if (!assignmentId) return;

    this.emailAssignmentBusy = true;
    this.emailAssignmentError = '';
    this.renderDetectionPanel();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EMAIL_ASSIGNMENT_RELEASE',
        data: { assignmentId }
      });
      if (!response?.success) {
        throw new Error(response?.error || '解除邮箱绑定失败');
      }
      await this.refreshRoleWorkspace();
    } catch (error) {
      this.emailAssignmentError = error.message || '解除邮箱绑定失败';
    } finally {
      this.emailAssignmentBusy = false;
      this.renderDetectionPanel();
    }
  }

  async loginFromControlDrawer(form) {
    const formData = new FormData(form);
    const response = await chrome.runtime.sendMessage({
      type: 'AUTH_LOGIN',
      data: {
        username: formData.get('username'),
        password: formData.get('password'),
        serverUrl: formData.get('serverUrl') || this.getDefaultServerUrl(),
        pageUrl: this.getPolicyUrl()
      }
    });

    if (!response?.success) {
      this.controlDrawerError = response?.error || '登录失败';
      this.renderDetectionPanel();
      return;
    }

    await this.handleAuthStateChanged(response.authState);
  }

  async logoutFromControlDrawer() {
    const response = await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' });
    if (response?.success) {
      await this.handleAuthStateChanged(response.authState);
    }
  }

  async startAdminCollectionFromDrawer(draftType) {
    const response = await chrome.runtime.sendMessage({
      type: 'START_ADMIN_COLLECTION_ALL_FRAMES',
      draftType,
      hideMethod: draftType === 'hidden_element' ? 'cover' : undefined
    });
    if (!response?.success) {
      this.controlDrawerError = response?.error || '无法启动采集模式';
      this.renderDetectionPanel();
      return;
    }
    this.detectionDrawerCollapsed = true;
    this.renderDetectionPanel();
  }

  async toggleHideRulesFromDrawer() {
    const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_HIDE_RULES_ALL_FRAMES' });
    if (!response?.success) {
      this.controlDrawerError = response?.error || '无法切换隐藏规则';
      this.renderDetectionPanel();
      return;
    }
    this.hidePaused = !!response.paused;
    this.renderDetectionPanel();
  }

  renderLegacyDetectionPanel() {
    const detections = Array.from(this.detectedTargets.values());
    if (detections.length === 0) {
      if (this.detectionPanel) {
        this.detectionPanel.remove();
        this.detectionPanel = null;
      }
      this.detectionDrawerCollapsed = true;
      this.detectionDrawerIndex = 0;
      return;
    }

    this.detectionDrawerIndex = Math.min(
      Math.max(this.detectionDrawerIndex, 0),
      detections.length - 1
    );

    let panel = this.detectionPanel || document.querySelector('.qr-authorized-detection-panel');
    if (!panel) {
      this.ensureDetectionDrawerStyles();
      panel = document.createElement('div');
      panel.className = 'qr-authorized-detection-panel';
      panel.style.cssText = `
        position: fixed;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      document.body.appendChild(panel);
      this.detectionPanel = panel;
    }

    const detection = detections[this.detectionDrawerIndex];
    const disabled = detection.status === 'uploading' || detection.status === 'uploaded' ? 'disabled' : '';
    const uploadLabel = detection.status === 'uploading'
      ? '上传中...'
      : detection.status === 'uploaded'
        ? '已上传'
        : '上传';
    const image = detection.screenshot || detection.imageSrc || detection.uploadData?.image || '';
    const hasMultiple = detections.length > 1;

    panel.innerHTML = `
      <button class="qr-drawer-toggle" data-qr-drawer-toggle type="button" aria-label="${this.detectionDrawerCollapsed ? '展开二维码上传面板' : '收起二维码上传面板'}" style="
        position: absolute;
        top: 50%;
        right: ${this.detectionDrawerCollapsed ? '0' : 'min(300px, calc(100vw - 24px))'};
        transform: translateY(-50%);
        width: 44px;
        height: 88px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-right: none;
        border-radius: 14px 0 0 14px;
        background: rgba(255, 255, 255, 0.96);
        color: #0f766e;
        box-shadow: -8px 8px 24px rgba(15, 23, 42, 0.14);
        cursor: pointer;
        transition: right 180ms ease, background 180ms ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
      ">
        <span style="font-size: 17px; line-height: 1;">${this.detectionDrawerCollapsed ? '‹' : '›'}</span>
        <span style="
          min-width: 20px;
          height: 20px;
          padding: 0 5px;
          border-radius: 999px;
          background: #0f766e;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          line-height: 20px;
        ">${detections.length}</span>
      </button>
      <section style="
        width: min(300px, calc(100vw - 24px));
        overflow: hidden;
        background: rgba(255, 255, 255, 0.98);
        color: #172033;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-right: none;
        border-radius: 16px 0 0 16px;
        box-shadow: -14px 18px 40px rgba(15, 23, 42, 0.16);
        transform: translateX(${this.detectionDrawerCollapsed ? '100%' : '0'});
        opacity: ${this.detectionDrawerCollapsed ? '0' : '1'};
        pointer-events: ${this.detectionDrawerCollapsed ? 'none' : 'auto'};
        transition: transform 180ms ease, opacity 150ms ease;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 8px;">
          <span style="font-size: 12px; color: #64748b;">待上传二维码</span>
          ${hasMultiple ? `<span style="font-size: 12px; color: #0f766e; font-weight: 700;">${this.detectionDrawerIndex + 1} / ${detections.length}</span>` : ''}
        </div>
        <div style="padding: 4px 14px 14px;">
          <div style="
            width: 100%;
            min-height: 104px;
            max-height: 180px;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            ${image ? `<img src="${this.escapeHtml(image)}" style="max-width: 100%; max-height: 180px; display: block;" alt="二维码截图">` : '<span style="font-size: 12px; color: #64748b;">已命中授权目标</span>'}
          </div>
          ${detection.error ? `<div style="font-size: 12px; color: #b91c1c; margin-top: 8px;">${this.escapeHtml(detection.error)}</div>` : ''}
          ${hasMultiple ? `
            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px;">
              <button class="qr-drawer-nav" data-qr-drawer-prev type="button" style="width: 30px; height: 28px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #475569; cursor: pointer;">‹</button>
              <button class="qr-drawer-nav" data-qr-drawer-next type="button" style="width: 30px; height: 28px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #475569; cursor: pointer;">›</button>
            </div>
          ` : ''}
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="qr-drawer-upload" data-qr-removed-upload="${this.escapeHtml(detection.key)}" ${disabled} style="
              flex: 1;
              border: none;
              border-radius: 9px;
              padding: 9px 12px;
              color: white;
              background: ${disabled ? '#94a3b8' : '#0f766e'};
              font-size: 13px;
              font-weight: 700;
              cursor: ${disabled ? 'not-allowed' : 'pointer'};
            ">${uploadLabel}</button>
            <button class="qr-drawer-dismiss" data-qr-removed-dismiss="${this.escapeHtml(detection.key)}" style="
              flex: 0 0 auto;
              border: 1px solid #e2e8f0;
              border-radius: 9px;
              padding: 9px 12px;
              color: #64748b;
              background: white;
              font-size: 13px;
              cursor: pointer;
            ">关闭</button>
          </div>
        </div>
      </section>
    `;

    panel.querySelector('[data-qr-drawer-toggle]')?.addEventListener('click', () => {
      this.detectionDrawerCollapsed = !this.detectionDrawerCollapsed;
      this.renderDetectionPanel();
    });

    panel.querySelector('[data-qr-drawer-prev]')?.addEventListener('click', () => {
      this.detectionDrawerIndex = (this.detectionDrawerIndex - 1 + detections.length) % detections.length;
      this.renderDetectionPanel();
    });

    panel.querySelector('[data-qr-drawer-next]')?.addEventListener('click', () => {
      this.detectionDrawerIndex = (this.detectionDrawerIndex + 1) % detections.length;
      this.renderDetectionPanel();
    });

    panel.querySelector('[data-qr-removed-upload]')?.addEventListener('click', (event) => {
      this.removedManualQRCodeUpload(event.currentTarget.getAttribute('data-qr-removed-upload'));
    });

    panel.querySelector('[data-qr-removed-dismiss]')?.addEventListener('click', (event) => {
      this.dismissDetection(event.currentTarget.getAttribute('data-qr-removed-dismiss'));
    });
  }

  ensureDetectionDrawerStyles() {
    if (document.getElementById('qr-detection-drawer-styles')) return;

    const style = document.createElement('style');
    style.id = 'qr-detection-drawer-styles';
    style.textContent = `
      .qr-authorized-detection-panel button {
        transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease !important;
      }

      .qr-authorized-detection-panel .qr-drawer-toggle:hover {
        background: #f0fdfa !important;
        color: #0d9488 !important;
        box-shadow: -10px 10px 28px rgba(15, 118, 110, 0.18) !important;
        transform: translateY(-50%) translateX(-3px) !important;
      }

      .qr-authorized-detection-panel .qr-drawer-nav:hover {
        background: #f0fdfa !important;
        border-color: #99f6e4 !important;
        color: #0f766e !important;
        transform: translateY(-1px);
      }

      .qr-authorized-detection-panel .qr-drawer-upload:not(:disabled):hover {
        background: #0d9488 !important;
        box-shadow: 0 7px 16px rgba(15, 118, 110, 0.22);
        transform: translateY(-1px);
      }

      .qr-authorized-detection-panel .qr-drawer-dismiss:hover {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #334155 !important;
        transform: translateY(-1px);
      }

      .qr-authorized-detection-panel button:active {
        transform: translateY(0) scale(0.98);
      }

      .qr-authorized-detection-panel button:focus-visible {
        outline: 2px solid #14b8a6;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  async removedManualQRCodeUpload(key) {
    const detection = this.detectedTargets.get(key);
    if (!detection || this.uploadingDetectionKeys.has(key)) return;

    this.uploadingDetectionKeys.add(key);
    detection.status = 'uploading';
    detection.error = null;
    this.renderDetectionPanel();

    try {
      await this.refreshCollectionPolicy(true);

      const fallbackImage = detection.screenshot ||
        detection.uploadData?.image ||
        detection.imageSrc ||
        (detection.element ? await this.captureElementImage(detection.element) : null);

      if (!fallbackImage) {
        throw new Error('已命中授权目标，但无法截取当前目标图片，请刷新后重试');
      }

      const data = detection.uploadData
        ? {
          ...detection.uploadData,
          content: detection.uploadData.content || '',
          image: fallbackImage,
          imageSrc: fallbackImage,
          uploadMode: this.authState.user?.role === 'leader' ? 'leader_assisted' : 'manual',
          clientAuthorizationId: this.authState.user?.role === 'leader' ? this.selectedLeaderUserId : undefined
        }
        : this.buildUploadData(
          '',
          fallbackImage,
          detection.element,
          detection.rule
        );

      if (this.authState.user?.role === 'leader') {
        if (!this.selectedLeaderUserId) {
          throw new Error('请先选择一个后台分配的普通用户');
        }
        data.uploadMode = 'leader_assisted';
        data.clientAuthorizationId = this.selectedLeaderUserId;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'UPLOAD_QR',
        data
      });

      if (!response?.success) {
        throw new Error(response?.error || '上传失败');
      }

      detection.content = '';
      detection.imageSrc = fallbackImage;
      detection.status = 'uploaded';
      detection.updatedAt = Date.now();
      this.rememberDismissedDetection(detection.rule, detection.content || detection.targetKey || key);
      this.renderDetectionPanel();

      this.showQRResultNotification({
        success: true,
        message: '授权目标截图上传成功',
        content: '未解析二维码内容'
      });

      setTimeout(() => {
        const current = this.detectedTargets.get(key);
        if (current?.status === 'uploaded') {
          this.detectedTargets.delete(key);
          const remainingCount = this.detectedTargets.size;
          if (remainingCount > 0) {
            this.detectionDrawerIndex %= remainingCount;
          }
          this.renderDetectionPanel();
        }
      }, 2500);
    } catch (error) {
      detection.status = 'error';
      detection.error = error.message || '上传失败';
      this.renderDetectionPanel();
      this.showQRResultNotification({
        success: false,
        message: detection.error,
        isUnauthorized: detection.error.includes('登录') || detection.error.includes('401')
      });
    } finally {
      this.uploadingDetectionKeys.delete(key);
    }
  }

  async checkBoundSelector() {
    if (this.activeRules.length > 0) {
      this.showBoundIndicator();
      return;
    }

    if (this.isBound && this.boundSelector) {
      try {
        this.boundElement = document.querySelector(this.boundSelector);
        if (this.boundElement) {
          this.showBoundIndicator();
        } else {
          await this.clearBoundSelector();
        }
      } catch (error) {
        console.error('Failed to find bound element:', error);
        await this.clearBoundSelector();
      }
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'START_SELECTION_MODE':
          this.startSelectionMode();
          sendResponse({ success: true });
          break;

        case 'START_ADMIN_COLLECTION_MODE':
          this.startAdminCollectionMode(message.draftType, message.hideMethod, message.topUrl, message.topTitle);
          sendResponse({ success: true });
          break;

        case 'TOGGLE_HIDE_RULES_PAUSED': {
          const paused = this.setHideRulesPaused(!this.hidePaused);
          sendResponse({ success: true, paused });
          break;
        }

        case 'GET_HIDE_RULES_STATE':
          sendResponse({
            success: true,
            paused: this.hidePaused,
            activeCount: this.activeHiddenRules.length,
            appliedCount: this.hiddenRuleState.size
          });
          break;

        case 'AUTH_STATE_CHANGED':
          this.handleAuthStateChanged(message.authState);
          sendResponse({ success: true });
          break;

        case 'GET_FRAME_OFFSET':
          sendResponse(this.getFrameOffsetForChild(message.frameUrl));
          break;
          
        case 'STOP_SELECTION_MODE':
          this.stopSelectionMode();
          this.stopAdminCollectionMode();
          sendResponse({ success: true });
          break;
          
        case 'SCAN_PAGE':
          this.scanBoundElement().then(result => sendResponse(result));
          return true;
          
        case 'SCAN_ENTIRE_PAGE':
          this.scanEntirePage().then(result => sendResponse(result));
          return true;
          
        case 'ELEMENT_SELECTED':
          this.handleElementSelected(message.selector);
          sendResponse({ success: true });
          break;
          
        case 'CLEAR_BOUND':
          this.clearBoundSelector();
          sendResponse({ success: true });
          break;
          
        case 'SHOW_QR_RESULT':
          this.showQRResultNotification(message);
          sendResponse({ success: true });
          break;

        case 'SHOW_AUTHORIZED_DETECTION':
          this.recordProxiedAuthorizedDetection(message.detection);
          sendResponse({ success: true });
          break;

        case 'SHOW_EMAIL_VERIFICATION_STATUS':
          this.emailVerificationStatus = message.status || null;
          this.renderDetectionPanel();
          sendResponse({ success: true });
          break;

        case 'FILL_ASSIGNED_EMAIL':
          sendResponse({
            success: true,
            filled: this.fillAssignedEmailInCurrentFrame(message.emailAddress)
          });
          break;
          
      }
    });
  }

  removedContextMenuTracking() {
    document.addEventListener('contextmenu', (event) => {
      void event.target;
    }, true);
  }

  async removedImageQRScan(message) {
    const { imageUrl, pageUrl, pageTitle } = message;
    
    console.log('🔍 [SCAN] Starting QR scan...');
    console.log('📷 [SCAN] Image URL:', imageUrl.substring(0, 100) + '...');

    try {
      await this.refreshCollectionPolicy(true);
      const imageElement = this.removedFindElementForImageUrl(imageUrl);
      const rule = this.findAuthorizedRuleForElement(imageElement);

      if (!rule) {
        this.showQRResultNotification({
          success: false,
          message: '该图片不在允许采集范围内'
        });
        return null;
      }

      // Check library availability
      console.log('📚 [LIBS] jsQR loaded:', typeof jsQR !== 'undefined');
      console.log('📚 [LIBS] ZXing loaded:', typeof ZXing !== 'undefined');
      
      let qrData = await this.decodeQRFromUrl(imageUrl);
      if (!qrData) {
        qrData = await this.decodeQRFromElementScreenshot(imageElement);
      }
      
      if (qrData) {
        const data = this.buildUploadData(qrData, imageUrl, imageElement, rule, pageUrl, pageTitle);
        console.log('✅ [SUCCESS] QR Code found:', qrData);
        
        this.showQRResultNotification({
          success: true,
          message: '✅ 二维码识别成功！正在上传...',
          content: qrData
        });
        return data;
      } else {
        console.log('❌ [FAILED] No QR code found in image');
        this.showQRResultNotification({
          success: false,
          message: '⚠️ 未识别到二维码，已保存图片'
        });
      }
      
      return null;
    } catch (error) {
      console.error('❌ [ERROR] Scan image QR error:', error);
      this.showQRResultNotification({
        success: false,
        message: '⚠️ 识别失败，已保存图片'
      });
      return null;
    }
  }

  async decodeQRFromUrl(imageUrl) {
    console.log('Starting QR decode from URL, trying multiple approaches...');
    
    // Method 1: Try ZXing with canvas approach (most reliable)
    if (typeof ZXing !== 'undefined') {
      try {
        console.log('Trying ZXing with canvas approach...');
        const result = await this.zxingFromCanvas(imageUrl);
        if (result) {
          console.log('✅ ZXing (canvas) found QR:', result);
          return result;
        }
      } catch (error) {
        console.log('ZXing canvas approach failed:', error.message || error);
      }
    }
    
    // Method 2: Try jsQR with enhanced preprocessing
    console.log('Trying jsQR with enhanced preprocessing...');
    const result = await this.jsQREnhanced(imageUrl);
    if (result) {
      console.log('✅ jsQR found QR:', result);
      return result;
    }
    
    // Method 3: Try with larger canvas and different scaling
    console.log('Trying with scaled up image...');
    const scaledResult = await this.jsQREnhanced(imageUrl, true);
    if (scaledResult) {
      console.log('✅ jsQR (scaled) found QR:', scaledResult);
      return scaledResult;
    }
    
    console.log('❌ All methods failed, no QR code found');
    return null;
  }

  async getRemoteImageSize(imageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    });
  }

  async shouldScanImageUrl(imageUrl) {
    const size = await this.getRemoteImageSize(imageUrl);
    if (!size) return true;
    if (!this.looksLikeQrCandidateSize(size.width, size.height)) {
      console.log('Skip non-QR shaped image:', size.width, 'x', size.height, imageUrl);
      return false;
    }
    return true;
  }
  
  async zxingFromCanvas(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          console.log('ZXing: Image loaded, size:', img.naturalWidth, 'x', img.naturalHeight);
          
          const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
          const reader = new ZXing.MultiFormatReader();
          
          // Try to decode
          const result = reader.decode(binaryBitmap);
          if (result) {
            console.log('✅ ZXing decoded successfully');
            resolve(result.text);
          } else {
            console.log('ZXing: No result from decode');
            resolve(null);
          }
        } catch (error) {
          console.log('ZXing decode error:', error.message || error);
          resolve(null);
        }
      };
      
      img.onerror = () => {
        console.error('Image load error');
        resolve(null);
      };
      
      img.src = imageUrl;
    });
  }
  
  async jsQREnhanced(imageUrl, scaleUp = false) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        if (typeof jsQR === 'undefined') {
          console.error('jsQR not loaded');
          resolve(null);
          return;
        }
        
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        
        // Scale up if image is too small
        if (scaleUp && (width < 400 || height < 400)) {
          const scale = Math.max(400 / width, 400 / height);
          width = Math.floor(width * scale);
          height = Math.floor(height * scale);
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, width, height);
        
        // Try multiple preprocessing techniques
        const techniques = [
          { name: 'original', fn: () => ctx.getImageData(0, 0, width, height) },
          { name: 'grayscale', fn: () => this.toGrayscale(ctx, width, height) },
          { name: 'contrast', fn: () => this.enhanceContrast(ctx, width, height) },
          { name: 'threshold', fn: () => this.applyThreshold(ctx, width, height) },
          { name: 'adaptive', fn: () => this.applyAdaptiveThreshold(ctx, width, height) },
          { name: 'invert', fn: () => this.invertColors(ctx, width, height) }
        ];
        
        for (const tech of techniques) {
          try {
            const imageData = tech.fn();
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert'
            });
            
            if (code) {
              console.log(`✅ jsQR (${tech.name}) found QR code`);
              resolve(code.data);
              return;
            }
            
            // Try with inversion
            const codeInverted = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth'
            });
            
            if (codeInverted) {
              console.log(`✅ jsQR (${tech.name}+inverted) found QR code`);
              resolve(codeInverted.data);
              return;
            }
          } catch (error) {
            console.log(`jsQR ${tech.name} failed:`, error);
          }
        }
        
        resolve(null);
      };
      
      img.onerror = () => {
        console.error('Image load error');
        resolve(null);
      };
      
      img.src = imageUrl;
    });
  }

  toGrayscale(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  enhanceContrast(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      min = Math.min(min, gray);
      max = Math.max(max, gray);
    }
    const factor = 255 / (max - min || 1);
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 - min) * factor;
      const val = Math.max(0, Math.min(255, gray));
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  enhanceContrastHigh(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      min = Math.min(min, gray);
      max = Math.max(max, gray);
    }
    // Higher contrast factor
    const factor = 255 / (max - min || 1);
    const contrast = 1.5;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      let val = ((gray - min) * factor - 128) * contrast + 128;
      val = Math.max(0, Math.min(255, val));
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  applyThreshold(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    const threshold = sum / (data.length / 4);
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const val = gray < threshold ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  applyAdaptiveThreshold(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const blockSize = 11;
    const C = 2;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let dy = -blockSize/2; dy <= blockSize/2; dy++) {
          for (let dx = -blockSize/2; dx <= blockSize/2; dx++) {
            const nx = Math.min(Math.max(x + dx, 0), width - 1);
            const ny = Math.min(Math.max(y + dy, 0), height - 1);
            const idx = (ny * width + nx) * 4;
            sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            count++;
          }
        }
        const threshold = sum / count - C;
        const idx = (y * width + x) * 4;
        const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        const val = gray < threshold ? 0 : 255;
        data[idx] = data[idx + 1] = data[idx + 2] = val;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  invertColors(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  sharpen(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    const tempData = new Uint8ClampedArray(data);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * width + (x + kx)) * 4 + c;
              sum += tempData[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          const idx = (y * width + x) * 4 + c;
          data[idx] = Math.max(0, Math.min(255, sum));
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  removeNoise(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const threshold = 30;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        
        // Check if pixel is isolated
        let neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            neighbors.push(data[nIdx] * 0.299 + data[nIdx + 1] * 0.587 + data[nIdx + 2] * 0.114);
          }
        }
        
        const avg = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
        if (Math.abs(gray - avg) > threshold) {
          data[idx] = data[idx + 1] = data[idx + 2] = avg;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  showQRResultNotification(message) {
    const existing = document.querySelector('.qr-result-notification');
    if (existing) existing.remove();

    const isUnauthorized = message.isUnauthorized;
    const bgColor = message.success ? 
      'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)' : 
      isUnauthorized ? 
        'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)' :
        'linear-gradient(135deg, #F44336 0%, #d32f2f 100%)';
    const icon = message.success ? '✅' : isUnauthorized ? '🔐' : '❌';

    const notification = document.createElement('div');
    notification.className = 'qr-result-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: ${bgColor};
      color: white;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      z-index: 2147483647;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      animation: slideInRight 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 360px;
      line-height: 1.5;
    `;

    const loginTip = isUnauthorized ? `
      <div style="font-size: 12px; opacity: 0.9; margin-top: 8px;">
        请从页面右侧控制抽屉重新登录
      </div>
    ` : '';

    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 18px;">${icon}</span>
        <div style="flex: 1;">
          <div style="font-weight: 600;">${message.message}</div>
          ${message.content ? `<div style="font-size: 12px; opacity: 0.9; margin-top: 4px; word-break: break-all;">${message.content.substring(0, 60)}${message.content.length > 60 ? '...' : ''}</div>` : ''}
          ${loginTip}
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      notification.style.transition = 'all 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, isUnauthorized ? 8000 : 3000); // 未登录提示显示更长时间
  }

  startSelectionMode() {
    console.log('开始选择模式');
    this.isSelectionMode = true;
    this.addSelectionStyles();
    document.addEventListener('mouseover', this.handleMouseOver.bind(this), true);
    document.addEventListener('mouseout', this.handleMouseOut.bind(this), true);
    document.addEventListener('click', this.handleSelectionClick.bind(this), true);
    document.body.style.cursor = 'crosshair';
  }

  stopSelectionMode() {
    console.log('停止选择模式');
    this.isSelectionMode = false;
    this.removeSelectionStyles();
    this.removeHoverEffect();
    
    try {
      document.removeEventListener('mouseover', this.handleMouseOver.bind(this), true);
      document.removeEventListener('mouseout', this.handleMouseOut.bind(this), true);
      document.removeEventListener('click', this.handleSelectionClick.bind(this), true);
    } catch (error) {
      console.error('移除事件监听器时出错:', error);
    }
    
    document.body.style.cursor = '';
  }

  startAdminCollectionMode(draftType = 'qrcode_target', hideMethod = 'cover', topUrl = null, topTitle = null) {
    this.stopSelectionMode();
    this.removeAdminInfoPanel();
    this.adminCollectionTopUrl = topUrl || this.adminCollectionTopUrl || null;
    this.adminCollectionTopTitle = topTitle || this.adminCollectionTopTitle || null;
    this.adminCollectionDraftType = draftType === 'email_verification'
      ? 'email_verification'
      : draftType === 'hidden_element'
        ? 'hidden_element'
        : 'qrcode_target';
    this.adminCollectionHideMethod = hideMethod === 'remove' ? 'remove' : 'cover';
    this.adminCollectionLastPickAt = 0;
    this.adminEmailCollection = this.adminCollectionDraftType === 'email_verification'
      ? {
        step: 0,
        labels: ['邮箱号输入框', '发送验证码按钮', '验证码输入框'],
        keys: ['email_input_selector', 'send_button_selector', 'code_input_selector'],
        selectors: {},
        elements: {},
        screenshot: null,
        picked: []
      }
      : null;
    this.adminCollectionPreviousHidePaused = this.hidePaused;
    if (this.adminCollectionDraftType === 'hidden_element') {
      this.setHideRulesPaused(true);
    }
    this.isAdminCollectionMode = true;
    this.addSelectionStyles();
    const text = this.adminCollectionDraftType === 'email_verification'
      ? '第 1/3 步：请先切换到邮箱登录/验证码登录页，再选择可见的邮箱号输入框。'
      : this.adminCollectionDraftType === 'hidden_element'
        ? '移动鼠标选择需要隐藏的元素，左键点击后提交隐藏规则草稿。'
        : '移动鼠标选择二维码目标元素，左键点击后提交到后台草稿。';
    this.showAdminCollectionPanel(text);
    this.handleAdminMouseOverBound = this.handleAdminMouseOver.bind(this);
    this.handleAdminMouseOutBound = this.handleAdminMouseOut.bind(this);
    this.handleAdminSelectionClickBound = this.handleAdminSelectionClick.bind(this);
    this.adminCollectionPointerDownBound = this.handleAdminSelectionPointerDown.bind(this);
    this.adminCollectionMouseDownBound = this.handleAdminSelectionPointerDown.bind(this);
    this.handleAdminKeydownBound = this.handleAdminKeydown.bind(this);
    window.addEventListener('mouseover', this.handleAdminMouseOverBound, true);
    window.addEventListener('mouseout', this.handleAdminMouseOutBound, true);
    window.addEventListener('pointerdown', this.adminCollectionPointerDownBound, true);
    window.addEventListener('mousedown', this.adminCollectionMouseDownBound, true);
    window.addEventListener('click', this.handleAdminSelectionClickBound, true);
    window.addEventListener('keydown', this.handleAdminKeydownBound, true);
    document.body.style.cursor = 'crosshair';
  }

  stopAdminCollectionMode() {
    if (!this.isAdminCollectionMode) return;
    this.isAdminCollectionMode = false;
    this.removeHoverEffect();
    this.removeAdminInfoPanel();
    window.removeEventListener('mouseover', this.handleAdminMouseOverBound, true);
    window.removeEventListener('mouseout', this.handleAdminMouseOutBound, true);
    window.removeEventListener('pointerdown', this.adminCollectionPointerDownBound, true);
    window.removeEventListener('mousedown', this.adminCollectionMouseDownBound, true);
    window.removeEventListener('click', this.handleAdminSelectionClickBound, true);
    window.removeEventListener('keydown', this.handleAdminKeydownBound, true);
    this.handleAdminMouseOverBound = null;
    this.handleAdminMouseOutBound = null;
    this.handleAdminSelectionClickBound = null;
    this.adminCollectionPointerDownBound = null;
    this.adminCollectionMouseDownBound = null;
    this.handleAdminKeydownBound = null;
    this.adminEmailCollection = null;
    this.adminCollectionCandidateElement = null;
    document.body.style.cursor = '';
    if (this.adminCollectionPreviousHidePaused !== null) {
      this.setHideRulesPaused(this.adminCollectionPreviousHidePaused);
      this.adminCollectionPreviousHidePaused = null;
    }
  }

  showAdminCollectionPanel(text, element = null) {
    let panel = this.adminInfoPanel;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'qr-admin-collection-panel';
      panel.style.cssText = `
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.94);
        color: #fff;
        border-radius: 14px;
        padding: 12px 16px;
        max-width: 560px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        pointer-events: auto;
      `;
      panel.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      }, true);
      panel.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      }, true);
      panel.addEventListener('click', async (event) => {
        event.stopPropagation();
        const action = event.target?.dataset?.qrAdminAction;
        if (action === 'confirm') {
          event.preventDefault();
          await this.confirmAdminCollectionCandidate();
        } else if (action === 'cancel') {
          event.preventDefault();
          this.stopAdminCollectionMode();
          this.showNotification('已取消采集目标');
        }
      }, true);
      document.body.appendChild(panel);
      this.adminInfoPanel = panel;
    }

    const selector = element ? this.generateSelector(element) : '';
    const rect = element ? element.getBoundingClientRect() : null;
    const title = this.adminCollectionDraftType === 'email_verification'
      ? '管理员采集邮箱验证码场景'
      : this.adminCollectionDraftType === 'hidden_element'
        ? '管理员采集隐藏元素'
        : '管理员采集二维码目标';
    panel.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${title}</div>
      <div style="font-size: 12px; opacity: 0.9;">${this.escapeHtml(text)}</div>
      ${selector ? `<div style="font-size: 11px; opacity: 0.82; margin-top: 6px; font-family: ui-monospace, Menlo, Consolas, monospace;">${this.escapeHtml(selector)}</div>` : ''}
      ${rect ? `<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">${Math.round(rect.width)} x ${Math.round(rect.height)} · ESC 取消</div>` : '<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">ESC 取消</div>'}
      ${element ? `
        <div style="display:flex; gap:8px; margin-top:10px; pointer-events:auto;">
          <button type="button" data-qr-admin-action="confirm" style="border:none; border-radius:999px; padding:6px 12px; background:#22c55e; color:#052e16; font-size:12px; font-weight:800; cursor:pointer;">确认当前目标</button>
          <button type="button" data-qr-admin-action="cancel" style="border:1px solid rgba(255,255,255,0.28); border-radius:999px; padding:6px 12px; background:transparent; color:#e2e8f0; font-size:12px; cursor:pointer;">取消</button>
        </div>
      ` : ''}
    `;
  }

  removeAdminInfoPanel() {
    if (this.adminInfoPanel) {
      this.adminInfoPanel.remove();
      this.adminInfoPanel = null;
    }
  }

  addSelectionStyles() {
    if (document.getElementById('qr-selector-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'qr-selector-styles';
    style.textContent = `
      .qr-selector-hover {
        outline: 3px solid #4CAF50 !important;
        outline-offset: 2px !important;
        background-color: rgba(76, 175, 80, 0.1) !important;
      }
      
      .qr-selector-preview {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        padding: 20px;
        max-width: 320px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .qr-selector-preview h4 {
        margin: 0 0 16px 0;
        color: #333;
        font-size: 16px;
        font-weight: 600;
      }
      
      .qr-selector-preview .preview-info {
        background: #f5f5f5;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
        font-size: 13px;
        color: #666;
      }
      
      .qr-selector-preview .preview-info .selector {
        font-family: monospace;
        background: #e8e8e8;
        padding: 4px 8px;
        border-radius: 4px;
        display: inline-block;
        margin-bottom: 8px;
      }
      
      .qr-selector-preview .preview-actions {
        display: flex;
        gap: 8px;
      }
      
      .qr-selector-preview button {
        flex: 1;
        padding: 12px 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .qr-selector-preview .btn-bind {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      
      .qr-selector-preview .btn-bind:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .qr-selector-preview .btn-cancel {
        background: #f0f0f0;
        color: #666;
      }
      
      .qr-selector-preview .btn-cancel:hover {
        background: #e0e0e0;
      }
      
      .qr-selector-preview .qr-detected {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 16px;
      }
      
      .qr-selector-preview .qr-detected .content {
        word-break: break-all;
        font-size: 12px;
        opacity: 0.9;
      }
      
      .qr-selector-bound {
        position: fixed;
        top: 10px;
        right: 10px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 10px 20px;
        border-radius: 24px;
        font-size: 13px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
        cursor: pointer;
      }
      
      .qr-selector-bound::before {
        content: '✓ ';
      }
      
      .qr-selector-bound:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  removeSelectionStyles() {
    const style = document.getElementById('qr-selector-styles');
    if (style) style.remove();
  }

  handleMouseOver(event) {
    if (!this.isSelectionMode) return;
    if (event.target === document.documentElement || event.target === document.body) return;
    
    this.removeHoverEffect();
    this.hoveredElement = event.target;
    this.hoveredElement.classList.add('qr-selector-hover');
  }

  handleMouseOut(event) {
    if (!this.isSelectionMode) return;
    this.removeHoverEffect();
  }

  removeHoverEffect() {
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('qr-selector-hover');
      this.hoveredElement = null;
    }
  }

  async confirmAdminCollectionCandidate() {
    if (!this.isAdminCollectionMode) return;
    const element = this.adminCollectionCandidateElement || this.hoveredElement;
    if (!element) {
      this.showAdminCollectionPanel('请先将鼠标移动到要采集的目标元素上。');
      return;
    }
    await this.pickAdminCollectionElement(element);
  }

  isVisibleCollectableElement(element) {
    if (!element || element === document.documentElement || element === document.body) return false;
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }

  getAdminCollectionElementFromEvent(event) {
    const fromPoint = typeof event.clientX === 'number' && typeof event.clientY === 'number'
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
    return fromPoint || event.target;
  }

  normalizeEmailCollectionElement(element, event = null) {
    const state = this.adminEmailCollection;
    if (!state) return element;

    const stepKey = state.keys[state.step];
    const isInputStep = stepKey === 'email_input_selector' || stepKey === 'code_input_selector';
    const selector = isInputStep
      ? 'input, textarea, [contenteditable="true"], [role="textbox"]'
      : 'button, a, [role="button"], input[type="button"], input[type="submit"]';

    if (element?.matches?.(selector)) return element;
    const closest = element?.closest?.(selector);
    if (closest) return closest;

    const descendants = element?.querySelectorAll
      ? [...element.querySelectorAll(selector)].filter((item) => this.isVisibleCollectableElement(item))
      : [];
    if (descendants.length && typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
      const containing = descendants.find((item) => {
        const rect = item.getBoundingClientRect();
        return event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
      });
      if (containing) return containing;
    }
    return descendants[0] || element;
  }

  validateEmailCollectionElement(element) {
    const state = this.adminEmailCollection;
    if (!state) return { valid: true };

    if (!this.isVisibleCollectableElement(element)) {
      return {
        valid: false,
        message: '当前元素不可见或尺寸过小，请先切换到邮箱登录/验证码登录页，再选择页面上可见的目标。'
      };
    }

    const stepKey = state.keys[state.step];
    const tagName = element.tagName?.toLowerCase();
    const role = element.getAttribute?.('role');
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    const isTextInput = tagName === 'textarea' ||
      element.isContentEditable ||
      role === 'textbox' ||
      (tagName === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden', 'file'].includes(type));
    const isActionElement = tagName === 'button' ||
      tagName === 'a' ||
      role === 'button' ||
      (tagName === 'input' && ['button', 'submit'].includes(type));

    if ((stepKey === 'email_input_selector' || stepKey === 'code_input_selector') && !isTextInput) {
      return {
        valid: false,
        message: `第 ${state.step + 1}/3 步需要选择输入框，请点击可输入的邮箱/验证码输入框。`
      };
    }

    if (stepKey === 'send_button_selector' && !isActionElement) {
      return {
        valid: false,
        message: '第 2/3 步需要选择发送验证码按钮，请点击“发送验证码”按钮或链接。'
      };
    }

    return { valid: true };
  }

  getEmailCollectionProgressText() {
    const state = this.adminEmailCollection;
    if (!state) return '';
    const picked = (state.picked || [])
      .map((item, index) => `${index + 1}. ${item.label}: ${item.selector}`)
      .join(' | ');
    return picked ? `已选 ${state.step}/3：${picked}` : '';
  }

  handleSelectionClick(event) {
    if (!this.isSelectionMode) return;
    
    if (event.target.closest('.qr-selector-preview')) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();

    const element = event.target;
    if (element === document.documentElement || element === document.body) return;

    const selector = this.generateSelector(element);
    
    console.log('选择模式：点击了元素', element.tagName, '选择器:', selector);
    
    // 立即退出选取模式
    this.stopSelectionMode();
    
    this.showPreviewPanel(element, selector);
  }

  handleAdminMouseOver(event) {
    if (!this.isAdminCollectionMode) return;
    if (event.target === document.documentElement || event.target === document.body) return;
    if (event.target.closest('.qr-admin-collection-panel')) return;
    if (this.isExtensionManagedElement(event.target)) return;
    if (!this.isInIframe() && this.isFrameElement(event.target)) {
      this.removeHoverEffect();
      return;
    }

    const targetElement = this.adminCollectionDraftType === 'email_verification'
      ? this.normalizeEmailCollectionElement(this.getAdminCollectionElementFromEvent(event), event)
      : this.getAdminCollectionElementFromEvent(event);
    if (!targetElement || targetElement === document.documentElement || targetElement === document.body) return;

    this.removeHoverEffect();
    this.hoveredElement = targetElement;
    this.adminCollectionCandidateElement = targetElement;
    this.hoveredElement.classList.add('qr-selector-hover');
    const validation = this.adminCollectionDraftType === 'email_verification'
      ? this.validateEmailCollectionElement(this.hoveredElement)
      : { valid: true };
    this.showAdminCollectionPanel(
      this.adminCollectionDraftType === 'email_verification'
        ? validation.valid
          ? `当前预选${this.adminEmailCollection?.labels?.[this.adminEmailCollection.step] || '邮箱验证码元素'}，点击确认。${this.getEmailCollectionProgressText()}`
          : validation.message
        : this.adminCollectionDraftType === 'hidden_element'
          ? '当前预选隐藏元素，点击提交到后台草稿。'
          : '当前预选二维码目标，点击提交到后台草稿。',
      this.hoveredElement
    );
  }

  handleAdminMouseOut() {
    if (!this.isAdminCollectionMode) return;
    this.removeHoverEffect();
  }

  handleAdminKeydown(event) {
    if (!this.isAdminCollectionMode) return;
    if (event.key === 'Escape') {
      this.stopAdminCollectionMode();
      this.showNotification('已取消采集目标');
    }
  }

  async handleAdminSelectionPointerDown(event) {
    if (!this.isAdminCollectionMode) return;
    if (event.button !== undefined && event.button !== 0) return;
    await this.handleAdminSelectionEvent(event);
  }

  async handleAdminSelectionClick(event) {
    await this.handleAdminSelectionEvent(event);
  }

  async handleAdminSelectionEvent(event) {
    if (!this.isAdminCollectionMode) return;
    if (event.target.closest('.qr-admin-collection-panel')) {
      const action = event.target?.dataset?.qrAdminAction;
      if (action === 'confirm') {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        await this.confirmAdminCollectionCandidate();
      } else if (action === 'cancel') {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        this.stopAdminCollectionMode();
        this.showNotification('已取消采集目标');
      }
      return;
    }
    if (this.isExtensionManagedElement(event.target)) return;
    if (!this.isInIframe() && this.isFrameElement(event.target)) {
      this.removeHoverEffect();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const rawElement = this.getAdminCollectionElementFromEvent(event);
    const element = this.adminCollectionDraftType === 'email_verification'
      ? this.normalizeEmailCollectionElement(rawElement, event)
      : (rawElement || this.hoveredElement || event.target);
    if (element === document.documentElement || element === document.body) return;

    await this.pickAdminCollectionElement(element);
  }

  async pickAdminCollectionElement(element) {
    const now = Date.now();
    if (now - this.adminCollectionLastPickAt < 220) return;

    if (this.adminCollectionDraftType === 'email_verification') {
      const validation = this.validateEmailCollectionElement(element);
      if (!validation.valid) {
        this.showAdminCollectionPanel(validation.message, element);
        return;
      }
      this.adminCollectionLastPickAt = now;
      await this.collectEmailVerificationElement(element);
      return;
    }

    this.adminCollectionLastPickAt = now;
    await this.submitCollectionDraft(element);
  }

  async collectEmailVerificationElement(element) {
    const state = this.adminEmailCollection;
    if (!state) return;

    const step = state.step;
    const key = state.keys[step];
    const selector = this.generateSelector(element);
    state.selectors[key] = selector;
    state.elements[key] = element;
    state.picked = state.picked || [];
    state.picked[step] = {
      label: state.labels[step],
      selector
    };

    state.step += 1;
    if (state.step < state.keys.length) {
      const extra = state.step === 1
        ? '这一步会被插件监听点击，但不会在采集时真正发送验证码。'
        : '选择后会提交到后台草稿，后台确认后普通用户可自动填入验证码。';
      this.showAdminCollectionPanel(
        `已确认${state.labels[step]}。第 ${state.step + 1}/3 步：选择${state.labels[state.step]}。${extra} ${this.getEmailCollectionProgressText()}`,
        element
      );
      return;
    }

    await this.submitEmailVerificationCollectionDraft(element);
  }

  async captureElementImageWithTimeout(element, timeoutMs = 1600) {
    try {
      return await Promise.race([
        this.captureElementImage(element),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ]);
    } catch {
      return null;
    }
  }

  getElementText(element) {
    const text = String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  }

  getElementTypeForDraft(element) {
    const tagName = element?.tagName?.toLowerCase();
    return tagName === 'img' || tagName === 'canvas' ? tagName : 'any';
  }

  getSuggestedSiteName() {
    try {
      return new URL(this.getDraftPageUrl()).hostname;
    } catch {
      return document.title || '采集站点';
    }
  }

  getSuggestedTargetName(element) {
    const tagName = element?.tagName?.toLowerCase() || 'target';
    const text = this.getElementText(element);
    if (this.adminCollectionDraftType === 'hidden_element') {
      return text ? `${tagName} - ${text.slice(0, 24)}` : `${tagName} 隐藏元素`;
    }
    return text ? `${tagName} - ${text.slice(0, 24)}` : `${tagName} 采集目标`;
  }

  async submitCollectionDraft(element) {
    this.showAdminCollectionPanel('正在提交草稿...', element);

    try {
      const selector = this.generateSelector(element);
      const rect = element.getBoundingClientRect();
      const topRect = await this.getElementViewportRect(element);
      const screenshot = await this.captureElementImage(element);
      const payload = {
        source_url: this.getDraftPageUrl(),
        url_pattern: this.getDraftUrlPattern(),
        selector,
        element_type: this.getElementTypeForDraft(element),
        draft_type: this.adminCollectionDraftType,
        hide_method: this.adminCollectionDraftType === 'hidden_element' ? this.adminCollectionHideMethod : undefined,
        suggested_site_name: this.getSuggestedSiteName(),
        suggested_target_name: this.getSuggestedTargetName(element),
        element_tag: element.tagName?.toLowerCase() || null,
        element_text: this.getElementText(element),
        element_rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top_x: Math.round(topRect?.left ?? rect.left),
          top_y: Math.round(topRect?.top ?? rect.top),
          frame_url: this.isInIframe() ? this.getFrameUrl() : null,
          frame_title: this.isInIframe() ? document.title : null
        },
        screenshot
      };

      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_COLLECTION_DRAFT',
        data: payload
      });

      if (!response?.success) {
        throw new Error(response?.error || '提交草稿失败');
      }

      await this.stopAdminCollectionEverywhere();
      this.showQRResultNotification({
        success: true,
        message: this.adminCollectionDraftType === 'hidden_element'
          ? '隐藏元素草稿已提交，前往后台确认'
          : '采集目标草稿已提交，前往后台确认'
      });
    } catch (error) {
      console.error('Submit collection draft error:', error);
      this.showAdminCollectionPanel(`提交失败：${error.message || '未知错误'}`, element);
      this.showQRResultNotification({
        success: false,
        message: error.message || '提交草稿失败'
      });
    }
  }

  async submitEmailVerificationCollectionDraft(element) {
    const state = this.adminEmailCollection;
    this.showAdminCollectionPanel('正在提交邮箱验证码场景草稿...', element);

    try {
      const emailElement = state?.elements?.email_input_selector || element;
      const rect = emailElement.getBoundingClientRect();
      const topRect = await this.getElementViewportRect(emailElement);
      const payload = {
        source_url: this.getDraftPageUrl(),
        url_pattern: this.getDraftUrlPattern(),
        selector: state.selectors.email_input_selector,
        element_type: 'any',
        draft_type: 'email_verification',
        email_input_selector: state.selectors.email_input_selector,
        send_button_selector: state.selectors.send_button_selector,
        code_input_selector: state.selectors.code_input_selector,
        suggested_site_name: this.getSuggestedSiteName(),
        suggested_target_name: '邮箱验证码场景',
        element_tag: emailElement.tagName?.toLowerCase() || null,
        element_text: this.getElementText(emailElement),
        element_rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top_x: Math.round(topRect?.left ?? rect.left),
          top_y: Math.round(topRect?.top ?? rect.top),
          frame_url: this.isInIframe() ? this.getFrameUrl() : null,
          frame_title: this.isInIframe() ? document.title : null
        },
        screenshot: state.screenshot || await this.captureElementImageWithTimeout(emailElement)
      };

      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_COLLECTION_DRAFT',
        data: payload
      });

      if (!response?.success) {
        throw new Error(response?.error || '提交草稿失败');
      }

      await this.stopAdminCollectionEverywhere();
      this.showQRResultNotification({
        success: true,
        message: '邮箱验证码场景草稿已提交，前往后台确认'
      });
    } catch (error) {
      console.error('Submit email verification collection draft error:', error);
      this.showAdminCollectionPanel(`提交失败：${error.message || '未知错误'}`, element);
      this.showQRResultNotification({
        success: false,
        message: error.message || '提交邮箱验证码场景草稿失败'
      });
    }
  }

  async stopAdminCollectionEverywhere() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_ADMIN_COLLECTION_ALL_FRAMES' });
      if (response?.success) return;
    } catch (error) {
      console.warn('Stop admin collection in all frames failed:', error);
    }
    this.stopAdminCollectionMode();
  }

  generateSelector(element) {
    const escapeSelector = (value) => {
      if (window.CSS?.escape) return CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    };
    const selectorCount = (selector) => {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    };
    const usefulClasses = (node) => {
      if (!node.className || typeof node.className !== 'string') return [];
      return node.className
        .trim()
        .split(/\s+/)
        .filter(className =>
          className &&
          className.length < 50 &&
          !className.startsWith('qr-selector-') &&
          !className.startsWith('qr-authorized-') &&
          !className.startsWith('qr-hidden-')
        )
        .slice(0, 2);
    };
    const getPart = (node) => {
      const tagName = node.tagName.toLowerCase();
      const classes = usefulClasses(node);
      let part = tagName;

      if (classes.length > 0) {
        part += classes.map(className => `.${escapeSelector(className)}`).join('');
      }

      if (node.parentElement) {
        const sameTagSiblings = Array.from(node.parentElement.children)
          .filter(child => child.tagName === node.tagName);
        if (sameTagSiblings.length > 1) {
          part += `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`;
        }
      }

      return part;
    };

    if (element.id) {
      const idSelector = `#${escapeSelector(element.id)}`;
      if (selectorCount(idSelector) === 1) return idSelector;
    }

    const classCandidate = `${element.tagName.toLowerCase()}${usefulClasses(element).map(className => `.${escapeSelector(className)}`).join('')}`;
    if (classCandidate !== element.tagName.toLowerCase() && selectorCount(classCandidate) === 1) {
      return classCandidate;
    }

    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      parts.unshift(getPart(node));
      const selector = parts.join(' > ');
      if (selectorCount(selector) === 1) return selector;
      node = node.parentElement;
    }

    return parts.join(' > ') || element.tagName.toLowerCase();
  }

  async scanElementForQR(element) {
    const images = element.querySelectorAll('img');
    const canvases = element.querySelectorAll('canvas');
    
    for (const canvas of canvases) {
      if (canvas.width > 0 && canvas.height > 0) {
        try {
          const qrData = await this.decodeQRFromCanvas(canvas);
          if (qrData) {
            return {
              found: true,
              content: qrData,
              source: 'canvas'
            };
          }
        } catch (error) {
          console.error('Failed to scan canvas:', error);
        }
      }
    }
    
    for (const img of images) {
      if (img.complete && img.naturalWidth > 0) {
        try {
          const qrData = await this.decodeQRFromImage(img);
          if (qrData) {
            return {
              found: true,
              content: qrData,
              source: 'image',
              imageSrc: img.src
            };
          }
        } catch (error) {
          console.error('Failed to scan image:', error);
        }
      }
    }
    
    return { found: false };
  }

  async decodeQRFromCanvas(canvas) {
    return new Promise((resolve) => {
      try {
        resolve(this.decodeQRFromCanvasElement(canvas));
      } catch (error) {
        console.error('Error decoding from canvas:', error);
        resolve(null);
      }
    });
  }

  decodeQRFromCanvasElement(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (typeof jsQR !== 'undefined') {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (code) return code.data;
    } else {
      console.warn('jsQR library not loaded');
    }

    return null;
  }

  async decodeQRFromImage(img) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        if (typeof jsQR !== 'undefined') {
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          resolve(code ? code.data : null);
        } else {
          console.warn('jsQR library not loaded');
          resolve(null);
        }
      } catch (error) {
        console.error('Error decoding from image:', error);
        resolve(null);
      }
    });
  }

  showPreviewPanel(element, selector) {
    console.log('显示预览面板，选择器:', selector);
    
    let preview = document.querySelector('.qr-selector-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'qr-selector-preview';
      document.body.appendChild(preview);
    }
    
    preview.innerHTML = `
      <h4>🎯 绑定目标元素</h4>
      <div class="preview-info">
        <div class="selector">${selector}</div>
        <div>选择器将用于自动检测二维码</div>
      </div>
      <div class="preview-actions">
        <button class="btn-bind" id="qr-bind-btn">
          绑定元素
        </button>
        <button class="btn-cancel" id="qr-cancel-btn">取消</button>
      </div>
    `;
    
    document.getElementById('qr-bind-btn').addEventListener('click', () => {
      console.log('点击了绑定按钮');
      this.bindElement(selector);
    });
    
    document.getElementById('qr-cancel-btn').addEventListener('click', () => {
      console.log('点击了取消按钮');
      preview.remove();
      this.stopSelectionMode();
    });
  }

  async bindElement(selector) {
    console.log('开始绑定元素，选择器:', selector);
    
    const preview = document.querySelector('.qr-selector-preview');
    if (preview) {
      preview.remove();
    }
    
    this.stopSelectionMode();
    
    const domain = this.getPolicyOrigin();
    
    const boundSelectors = await chrome.storage.sync.get({ boundSelectors: {} })
      .then(r => r.boundSelectors || {});
    
    boundSelectors[domain] = selector;
    await chrome.storage.sync.set({ boundSelectors });
    
    this.boundSelector = selector;
    this.isBound = true;
    
    this.showBoundIndicator();
    this.startAutoScan();
    
    try {
      await chrome.runtime.sendMessage({
        type: 'SELECTION_COMPLETE',
        selector: selector,
        domain: domain
      });
    } catch (error) {
      console.error('Failed to send selection complete message:', error);
    }
    
    this.showNotification('✅ 已成功绑定元素！选择器: ' + selector);
    
    console.log('绑定完成，停止选择模式');
  }

  async clearBoundSelector() {
    const domain = this.getPolicyOrigin();
    
    const boundSelectors = await chrome.storage.sync.get({ boundSelectors: {} })
      .then(r => r.boundSelectors || {});
    
    delete boundSelectors[domain];
    await chrome.storage.sync.set({ boundSelectors });
    
    this.boundSelector = null;
    this.isBound = false;
    this.boundElement = null;
    this.stopAutoScan();
    this.removeBoundIndicator();
  }

  showBoundIndicator() {
    let indicator = document.querySelector('.qr-selector-bound');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'qr-selector-bound';
      indicator.textContent = '二维码监控已启用';
      indicator.title = '点击解除绑定';
      indicator.onclick = () => {
        if (confirm('确定要解除绑定吗？')) {
          this.clearBoundSelector();
        }
      };
      document.body.appendChild(indicator);
    }
  }

  removeBoundIndicator() {
    const indicator = document.querySelector('.qr-selector-bound');
    if (indicator) indicator.remove();
  }

  startAutoScan() {
    if (this.scanInterval) return;
    
    this.scanBoundElement(true);
    this.scanInterval = setInterval(() => {
      this.scanBoundElement();
    }, this.interval);
  }

  stopAutoScan() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  async scanBoundElement(forceRefreshPolicy = false) {
    await this.refreshCollectionPolicy(forceRefreshPolicy);
    if (this.activeRules.length === 0) return { success: false, count: 0 };
    if (!this.canAutoUpload()) return { success: false, count: 0 };

    const foundKeys = new Set();

    try {
      for (const rule of this.activeRules) {
        const baseKey = this.getDetectionKey(rule);
        if (this.isAutoUploadInFlightForRule(rule)) continue;
        if (this.isAutoUploadThrottledForRule(rule)) continue;
        if (this.isInIframe() && this.hasRecentForwardedDetection(baseKey)) continue;

        for (const key of Array.from(this.detectedTargets.keys())) {
          if (key.startsWith(`${baseKey}:`)) this.detectedTargets.delete(key);
        }

        const element = this.getBestElementForRule(rule);
        if (!element) continue;

        if (
          !this.detectedTargets.has(baseKey) &&
          !this.dismissedDetections.has(baseKey)
        ) {
          foundKeys.add(baseKey);
          await this.recordAuthorizedTargetElement(element, rule, baseKey);
        }
      }
    } catch (error) {
      console.error('Scan bound element error:', error);
    }
    
    return {
      success: foundKeys.size > 0,
      count: foundKeys.size,
      data: null
    };
  }

  async recordAuthorizedTargetElement(element, rule, baseKey = this.getDetectionKey(rule)) {
    if (this.isInIframe() && this.hasRecentForwardedDetection(baseKey)) return;

    const targetElement = element;
    const screenshot = await this.captureElementImage(targetElement);
    const imageSrc = screenshot || null;
    const uploadData = this.buildUploadData(
      '',
      imageSrc,
      targetElement,
      rule
    );
    const anchorRect = await this.getElementViewportRect(targetElement);

    if (this.isInIframe()) {
      const response = await chrome.runtime.sendMessage({
        type: 'REPORT_AUTHORIZED_DETECTION',
        detection: {
          key: baseKey,
          content: '',
          imageSrc,
          screenshot,
          uploadData,
          anchorRect,
          rule: this.buildRuleSnapshot(rule)
        }
      });

      if (response?.success) {
        this.rememberForwardedDetection(baseKey);
        return;
      }

      console.warn('Authorized iframe detection could not reach top frame, retrying on next scan');
      return;
    }

    this.recordAuthorizedDetection(
      '',
      imageSrc,
      targetElement,
      rule,
      baseKey,
      {
        screenshot,
        uploadData,
        anchorRect
      }
    );
  }

  async scanEntirePage() {
    console.log('开始全页面扫描...');
    
    const results = {
      success: false,
      count: 0,
      data: [],
      stats: {
        canvasesScanned: 0,
        imagesScanned: 0,
        containersScanned: 0,
        timeElapsed: 0
      }
    };
    
    const startTime = performance.now();
    
    try {
      // 第一层：扫描所有 canvas
      const canvases = document.querySelectorAll('canvas');
      console.log(`发现 ${canvases.length} 个 canvas 元素`);
      results.stats.canvasesScanned = canvases.length;
      
      for (const canvas of canvases) {
        if (canvas.width >= 50 && canvas.height >= 50) {
          try {
            const qrData = await this.decodeQRFromCanvas(canvas);
            if (qrData) {
              results.count++;
              results.data.push({
                content: qrData,
                type: 'canvas',
                source: canvas.outerHTML.substring(0, 100)
              });
              await this.saveToHistory(qrData, null);
            }
          } catch (error) {
            console.error('扫描 canvas 失败:', error);
          }
        }
      }
      
      // 第二层：扫描所有图片
      const images = document.querySelectorAll('img');
      console.log(`发现 ${images.length} 个图片元素`);
      results.stats.imagesScanned = images.length;
      
      for (const img of images) {
        if (img.complete && img.naturalWidth >= 50 && img.naturalHeight >= 50) {
          // 跳过太小的图片
          if (img.src.startsWith('data:image') || 
              img.src.includes('qr') || 
              img.className.includes('qr') ||
              img.id.includes('qr')) {
            try {
              const qrData = await this.decodeQRFromImage(img);
              if (qrData) {
                results.count++;
                results.data.push({
                  content: qrData,
                  type: 'image',
                  source: img.src.substring(0, 100)
                });
                await this.saveToHistory(qrData, img.src);
              }
            } catch (error) {
              console.error('扫描图片失败:', error);
            }
          }
        }
      }
      
      // 第三层：扫描可疑的二维码容器
      const qrSelectors = [
        '[class*="qrcode"]',
        '[class*="qr-code"]',
        '[class*="qr_code"]',
        '[id*="qrcode"]',
        '[id*="qr-code"]',
        '[class*="qr"]',
        '[data-qr]'
      ];
      
      const containers = document.querySelectorAll(qrSelectors.join(','));
      console.log(`发现 ${containers.length} 个可疑二维码容器`);
      results.stats.containersScanned = containers.length;
      
      for (const container of containers) {
        const containerCanvases = container.querySelectorAll('canvas');
        for (const canvas of containerCanvases) {
          if (canvas.width >= 50 && canvas.height >= 50) {
            try {
              const qrData = await this.decodeQRFromCanvas(canvas);
              if (qrData && !results.data.some(r => r.content === qrData)) {
                results.count++;
                results.data.push({
                  content: qrData,
                  type: 'container-canvas',
                  container: container.className || container.id
                });
                await this.saveToHistory(qrData, null);
              }
            } catch (error) {
              console.error('扫描容器 canvas 失败:', error);
            }
          }
        }
        
        const containerImages = container.querySelectorAll('img');
        for (const img of containerImages) {
          if (img.complete && img.naturalWidth >= 50 && img.naturalHeight >= 50) {
            try {
              const qrData = await this.decodeQRFromImage(img);
              if (qrData && !results.data.some(r => r.content === qrData)) {
                results.count++;
                results.data.push({
                  content: qrData,
                  type: 'container-image',
                  container: container.className || container.id
                });
                await this.saveToHistory(qrData, img.src);
              }
            } catch (error) {
              console.error('扫描容器图片失败:', error);
            }
          }
        }
      }
      
      // 第四层：深度扫描所有可见区域
      const allElements = document.querySelectorAll('*');
      let scannedCount = 0;
      const maxScan = 1000;
      
      for (const element of allElements) {
        if (scannedCount >= maxScan) break;
        
        const rect = element.getBoundingClientRect();
        if (rect.width >= 100 && rect.height >= 100 && rect.width <= 600 && rect.height <= 600) {
          // 可能是二维码的尺寸范围
          scannedCount++;
          
          const elementCanvases = element.querySelectorAll('canvas');
          for (const canvas of elementCanvases) {
            if (canvas.width >= 100 && canvas.height >= 100) {
              try {
                const qrData = await this.decodeQRFromCanvas(canvas);
                if (qrData && !results.data.some(r => r.content === qrData)) {
                  results.count++;
                  results.data.push({
                    content: qrData,
                    type: 'element-canvas',
                    element: element.tagName + (element.className ? '.' + element.className.split(' ')[0] : '')
                  });
                  await this.saveToHistory(qrData, null);
                }
              } catch (error) {
                console.error('扫描元素 canvas 失败:', error);
              }
            }
          }
        }
      }
      
      const endTime = performance.now();
      results.stats.timeElapsed = (endTime - startTime).toFixed(2);
      
      results.success = results.count > 0;
      
      console.log(`扫描完成！找到 ${results.count} 个二维码，耗时 ${results.stats.timeElapsed}ms`, results.stats);
      
      this.showScanResults(results);
      
    } catch (error) {
      console.error('全页面扫描失败:', error);
    }
    
    return results;
  }

  showScanResults(results) {
    const container = document.createElement('div');
    container.id = 'qr-scan-results';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 360px;
      max-height: 500px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      animation: slideInRight 0.3s ease;
    `;
    
    const headerStyle = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
    `;
    
    const statsStyle = `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      padding: 16px;
      background: #f8fafc;
    `;
    
    container.innerHTML = `
      <div style="${headerStyle}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 600;">
            ${results.success ? '🎉' : '🔍'} 扫描结果
          </h3>
          <button id="close-scan-results" style="
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
          ">×</button>
        </div>
        <p style="margin: 0; font-size: 13px; opacity: 0.9;">
          ${results.success ? `成功找到 ${results.count} 个二维码！` : '未在页面中发现二维码'}
        </p>
      </div>
      
      <div style="${statsStyle}">
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #667eea;">${results.stats.canvasesScanned}</div>
          <div style="font-size: 11px; color: #666;">Canvas</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #667eea;">${results.stats.imagesScanned}</div>
          <div style="font-size: 11px; color: #666;">图片</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #667eea;">${results.stats.timeElapsed}</div>
          <div style="font-size: 11px; color: #666;">耗时(ms)</div>
        </div>
      </div>
      
      ${results.success ? `
        <div style="max-height: 300px; overflow-y: auto; padding: 12px;">
          ${results.data.map((item, idx) => `
            <div style="
              padding: 12px;
              margin-bottom: 8px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 3px solid #667eea;
            ">
              <div style="font-size: 11px; color: #667eea; margin-bottom: 4px; font-weight: 600;">
                ${item.type.toUpperCase()} #${idx + 1}
              </div>
              <div style="font-size: 13px; color: #333; word-break: break-all; line-height: 1.5;">
                ${item.content.length > 100 ? item.content.substring(0, 100) + '...' : item.content}
              </div>
              ${item.container ? `<div style="font-size: 10px; color: #999; margin-top: 4px;">容器: ${item.container}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="padding: 40px 20px; text-align: center; color: #999;">
          <div style="font-size: 48px; margin-bottom: 12px;">📭</div>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666;">页面中未发现二维码</p>
          <p style="margin: 0; font-size: 12px;">可能的原因：</p>
          <ul style="text-align: left; font-size: 11px; margin: 8px 0 0 20px; color: #999;">
            <li>页面尚未加载完成</li>
            <li>二维码被懒加载</li>
            <li>二维码在 iframe 中</li>
          </ul>
        </div>
      `}
      
      <div style="padding: 12px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
        <button id="rescan-btn" style="
          width: 100%;
          padding: 10px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.2s;
        ">
          再次扫描
        </button>
      </div>
    `;
    
    document.body.appendChild(container);
    
    // 关闭按钮
    document.getElementById('close-scan-results').addEventListener('click', () => {
      container.remove();
    });
    
    // 重新扫描按钮
    document.getElementById('rescan-btn').addEventListener('click', () => {
      container.remove();
      this.scanEntirePage();
    });
    
    // 自动关闭（10秒后）
    setTimeout(() => {
      if (container.parentElement) {
        container.style.opacity = '0';
        container.style.transform = 'translateX(100%)';
        setTimeout(() => container.remove(), 300);
      }
    }, 10000);
  }

  showBubbleNotification(element, qrData) {
    if (this.bubbleElement) {
      this.bubbleElement.remove();
    }

    const bubble = document.createElement('div');
    bubble.style.cssText = `
      position: absolute;
      top: -70px;
      right: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 14px 18px;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      max-width: 280px;
      cursor: pointer;
      transition: opacity 0.3s;
      animation: slideUp 0.3s ease;
    `;
    
    const content = qrData.length > 60 ? qrData.substring(0, 60) + '...' : qrData;
    
    bubble.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 6px;">📷 发现二维码</div>
      <div style="font-size: 12px; opacity: 0.95; word-break: break-all; margin-bottom: 8px;">
        ${content}
      </div>
      <div style="font-size: 11px; opacity: 0.8;">
        命中授权规则后会自动上传
      </div>
    `;
    
    bubble.onclick = async (e) => {
      e.stopPropagation();
      bubble.innerHTML = `
        <div style="font-weight: bold;">已记录</div>
        <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">未命中授权规则不会上传</div>
      `;
      setTimeout(() => bubble.remove(), 2000);
    };
    
    const rect = element.getBoundingClientRect();
    const container = element.parentElement || element;
    
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    
    container.appendChild(bubble);
    this.bubbleElement = bubble;
    
    setTimeout(() => {
      if (bubble.parentElement) {
        bubble.style.opacity = '0';
        setTimeout(() => bubble.remove(), 300);
      }
    }, 15000);
  }

  async saveToHistory(qrData, imageSrc) {
    const result = await chrome.storage.local.get({ history: [] });
    const history = result.history || [];
    
    const entry = {
      id: Date.now().toString(),
      content: qrData,
      image: imageSrc,
      source: this.getPolicyUrl(),
      timestamp: Date.now()
    };
    
    history.unshift(entry);
    if (history.length > 100) {
      history.pop();
    }
    
    await chrome.storage.local.set({ history });
  }

  async removedLegacyLocalUpload(qrData, imageSrc, element, rule) {
    if (!rule) {
      console.warn('Blocked pending upload without authorized collection rule');
      return;
    }

    const result = await chrome.storage.local.get({ removedLegacyUploads: [] });
    const removedLegacyUploads = result.removedLegacyUploads || [];
    
    const entry = this.buildUploadData(qrData, imageSrc, element, rule);
    
    removedLegacyUploads.push(entry);
    await chrome.storage.local.set({ removedLegacyUploads });

    try {
      await chrome.runtime.sendMessage({
        type: 'UPLOAD_QR',
        data: entry
      });
    } catch (error) {
      console.error('Failed to upload authorized QR:', error);
    }
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 14px 28px;
      border-radius: 28px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
      animation: slideDown 0.3s ease;
    `;
    notification.textContent = message;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    if (!document.getElementById('qr-animation-styles')) {
      style.id = 'qr-animation-styles';
      document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
}

const qrSelector = new QRCodeSelector();
globalThis.__qrSelectorInstance = qrSelector;
