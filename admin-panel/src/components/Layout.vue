<template>
  <div class="layout">
    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <div class="logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="5" fill="#007AFF"/>
            <path d="M9.4 8H15M9.1 9.7L11.2 14M14.9 9.7L12.8 14" stroke="white" stroke-width="1.45" stroke-linecap="round" opacity="0.82"/>
            <circle cx="8" cy="8" r="2" fill="white"/>
            <circle cx="16" cy="8" r="2" fill="white"/>
            <circle cx="12" cy="16" r="2.2" fill="white"/>
          </svg>
          <span v-if="!isCollapsed" class="logo-text">采集中枢</span>
        </div>
        <button class="collapse-btn" type="button" @click="toggleSidebar" :aria-label="isCollapsed ? '展开侧边栏' : '收起侧边栏'">
          <svg v-if="isCollapsed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      <nav class="sidebar-nav" aria-label="后台主导航">
        <div class="nav-section">
          <div v-if="!isCollapsed" class="nav-section-label">总览</div>
          <router-link to="/" class="nav-item" :class="{ active: route.path === '/' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">仪表盘</span>
              <span class="nav-desc">运行概况</span>
            </span>
          </router-link>
        </div>

        <div class="nav-section">
          <div v-if="!isCollapsed" class="nav-section-label">采集结果</div>
          <router-link to="/qrcodes" class="nav-item" :class="{ active: route.path === '/qrcodes' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="3" height="3" rx="0.5"/>
              <rect x="18" y="14" width="3" height="3" rx="0.5"/>
              <rect x="14" y="18" width="3" height="3" rx="0.5"/>
              <rect x="18" y="18" width="3" height="3" rx="0.5"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">二维码记录</span>
              <span class="nav-desc">自动上传结果</span>
            </span>
          </router-link>

          <router-link to="/email-monitor" class="nav-item" :class="{ active: route.path === '/email-monitor' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19V5"/>
              <path d="M4 12h4l2-5 4 10 2-5h4"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">邮箱验证码</span>
              <span class="nav-desc">监听与提取记录</span>
            </span>
          </router-link>
        </div>

        <div class="nav-section">
          <div v-if="!isCollapsed" class="nav-section-label">采集配置</div>
          <router-link to="/collection-rules/qrcode" class="nav-item" :class="{ active: route.path === '/collection-rules/qrcode' || route.path === '/collection-rules' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2z"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">二维码规则</span>
              <span class="nav-desc">页面二维码目标</span>
            </span>
          </router-link>

          <router-link to="/collection-rules/email" class="nav-item" :class="{ active: route.path === '/collection-rules/email' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="M3 7l9 6 9-6"/>
              <path d="M8 17h8"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">验证码规则</span>
              <span class="nav-desc">邮箱三点场景</span>
            </span>
          </router-link>

          <router-link to="/collection-rules/hidden" class="nav-item" :class="{ active: route.path === '/collection-rules/hidden' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/>
              <path d="M4 4l16 16"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">隐藏元素</span>
              <span class="nav-desc">遮挡或移除目标</span>
            </span>
          </router-link>

          <router-link to="/email-pool" class="nav-item" :class="{ active: route.path === '/email-pool' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="M3 7l9 6 9-6"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">邮箱池</span>
              <span class="nav-desc">可用邮箱与绑定</span>
            </span>
          </router-link>
        </div>

        <div class="nav-section">
          <div v-if="!isCollapsed" class="nav-section-label">身份权限</div>
          <router-link to="/client-authorizations" class="nav-item" :class="{ active: route.path === '/client-authorizations' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">客户端身份</span>
              <span class="nav-desc">IP、组长与能力开关</span>
            </span>
          </router-link>

          <router-link to="/users" class="nav-item" :class="{ active: route.path === '/users' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">管理员账号</span>
              <span class="nav-desc">后台登录权限</span>
            </span>
          </router-link>
        </div>

        <div class="nav-section">
          <div v-if="!isCollapsed" class="nav-section-label">系统维护</div>
          <router-link to="/storage" class="nav-item" :class="{ active: route.path === '/storage' }">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="8" ry="3"/>
              <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/>
              <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>
            </svg>
            <span v-if="!isCollapsed" class="nav-copy">
              <span class="nav-title">存储治理</span>
              <span class="nav-desc">容量统计与清理</span>
            </span>
          </router-link>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="server-info">
          <div class="server-label" v-if="!isCollapsed">插件安装</div>
          <div class="server-url-row">
            <span v-if="!isCollapsed" class="server-url">{{ serverUrl }}</span>
            <button class="copy-btn" type="button" @click="copyServerUrl" :title="isCollapsed ? '复制地址' : ''">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
          <div v-if="!isCollapsed" class="server-hint">按当前后台地址生成客户端包</div>
          <button class="download-plugin-btn" type="button" @click="downloadPluginZip" :disabled="downloadingPlugin">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span v-if="!isCollapsed">{{ downloadingPlugin ? '下载中...' : '下载插件 ZIP' }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main">
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="page-title">{{ pageTitle }}</h1>
        </div>
        <div class="topbar-right">
          <div class="user-menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>{{ authStore.user?.username || '管理员' }}</span>
            <button class="logout-btn" type="button" @click="handleLogout" aria-label="退出登录">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div class="content">
        <router-view />
      </div>
    </main>

  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { extensionApi } from '@/api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const isCollapsed = ref(false)
const downloadingPlugin = ref(false)
const serverUrl = computed(() => {
  const { protocol, hostname, port } = window.location
  const apiPort = port === '3011' ? '3010' : port === '3001' ? '3000' : port
  return `${protocol}//${hostname}${apiPort ? `:${apiPort}` : ''}`
})

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
}

const copyServerUrl = async () => {
  try {
    await navigator.clipboard.writeText(serverUrl.value)
    ElMessage.success('已复制服务器地址')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const saveBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

const downloadPluginZip = async () => {
  downloadingPlugin.value = true
  try {
    const blob = await extensionApi.downloadZip()
    saveBlob(blob, 'qrcode-extension.zip')
    ElMessage.success('插件 ZIP 已开始下载')
  } catch (error) {
    ElMessage.error('下载插件失败')
  } finally {
    downloadingPlugin.value = false
  }
}

const pageTitle = computed(() => {
  if (route.path === '/collection-rules/email') return '验证码规则'
  if (route.path === '/collection-rules/hidden') return '隐藏元素规则'
  if (route.path.startsWith('/collection-rules')) return '二维码规则'
  const titles = {
    '/': '仪表盘',
    '/qrcodes': '二维码记录',
    '/users': '管理员账号',
    '/client-authorizations': '客户端身份授权',
    '/email-pool': '邮箱池',
    '/email-monitor': '邮箱验证码',
    '/storage': '存储治理'
  }
  return titles[route.path] || '详情'
})

const handleLogout = () => {
  authStore.logout()
  ElMessage.success('已退出登录')
  router.push('/login')
}
</script>

<style>
/* 全局 macOS 风格 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  color: var(--admin-text, #0f172a);
  background: var(--admin-bg, #f4f6f9);
  -webkit-font-smoothing: antialiased;
}

.layout {
  display: flex;
  min-height: 100vh;
}

/* 侧边栏 */
.sidebar {
  width: 264px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(247, 249, 252, 0.92)),
    radial-gradient(circle at 18% 8%, rgba(0, 122, 255, 0.1), transparent 32%);
  backdrop-filter: blur(24px);
  border-right: 1px solid var(--admin-border, rgba(15, 23, 42, 0.08));
  display: flex;
  flex-direction: column;
  transition: width 0.24s ease;
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar.collapsed {
  width: 72px;
}

.sidebar-header {
  padding: 18px 16px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-text {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--admin-text, #0f172a);
}

.collapse-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #86868b;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.collapse-btn:hover {
  background: #ffffff;
  color: #111827;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.sidebar-nav {
  flex: 1;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-section-label {
  padding: 0 12px 5px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: #9aa4b2;
  letter-spacing: 0.08em;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 52px;
  padding: 9px 11px;
  border-radius: 14px;
  color: #6b7280;
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.nav-item svg {
  flex: 0 0 auto;
  color: inherit;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.74);
  color: #111827;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  transform: translateX(1px);
}

.nav-item.active {
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.13), rgba(255, 255, 255, 0.9));
  color: var(--admin-text, #0f172a);
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.12), 0 12px 28px rgba(15, 23, 42, 0.08);
}

.nav-item.active::before {
  background: var(--admin-primary, #007aff);
}

.nav-item.active svg {
  color: var(--admin-primary, #007aff);
}

.nav-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-title {
  font-size: 14px;
  font-weight: 650;
  color: inherit;
  letter-spacing: -0.01em;
}

.nav-desc {
  max-width: 176px;
  overflow: hidden;
  color: #98a2b3;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-item.active .nav-desc {
  color: #64748b;
}

.sidebar.collapsed .sidebar-header {
  justify-content: center;
  padding-inline: 12px;
}

.sidebar.collapsed .logo {
  display: none;
}

.sidebar.collapsed .sidebar-nav {
  align-items: center;
  gap: 8px;
  padding: 14px 8px;
}

.sidebar.collapsed .nav-section {
  width: 100%;
  align-items: center;
}

.sidebar.collapsed .nav-item {
  width: 44px;
  min-height: 44px;
  justify-content: center;
  padding: 0;
  border-radius: 13px;
}

.sidebar.collapsed .nav-item::before {
  display: none;
}

.sidebar-footer {
  padding: 14px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.server-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--admin-border, rgba(15, 23, 42, 0.08));
  border-radius: var(--admin-radius-lg, 16px);
  box-shadow: var(--admin-shadow-md, 0 12px 28px rgba(15, 23, 42, 0.06));
}

.server-label {
  font-size: 11px;
  color: #667085;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.server-url-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.server-url {
  font-size: 12px;
  color: #111827;
  font-weight: 600;
  word-break: break-all;
}

.server-hint {
  color: #98a2b3;
  font-size: 11px;
  line-height: 1.45;
}

.copy-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: #f2f4f7;
  border-radius: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #86868b;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: rgba(0, 122, 255, 0.1);
  color: #007AFF;
  box-shadow: 0 8px 18px rgba(0, 122, 255, 0.12);
}

.download-plugin-btn {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(0, 122, 255, 0.18);
  background: rgba(0, 122, 255, 0.08);
  border-radius: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #007AFF;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.download-plugin-btn:hover:not(:disabled) {
  background: rgba(0, 122, 255, 0.14);
  border-color: rgba(0, 122, 255, 0.28);
  box-shadow: 0 10px 22px rgba(0, 122, 255, 0.12);
}

.download-plugin-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.sidebar.collapsed .sidebar-footer {
  padding: 12px 8px;
}

.sidebar.collapsed .server-info {
  align-items: center;
  padding: 8px;
  border-radius: 14px;
}

.sidebar.collapsed .server-url-row {
  justify-content: center;
}

.sidebar.collapsed .download-plugin-btn {
  width: 34px;
  min-height: 34px;
  padding: 0;
}

/* 主内容区 */
.main {
  flex: 1;
  margin-left: 264px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  transition: margin-left 0.24s ease;
}

.sidebar.collapsed + .main,
.sidebar.collapsed ~ .main {
  margin-left: 72px;
}

.topbar {
  height: 64px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--admin-border-soft, rgba(15, 23, 42, 0.06));
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 50;
}

.topbar-left {
  display: flex;
  align-items: center;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--admin-text, #0f172a);
}

.topbar-right {
  display: flex;
  align-items: center;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--admin-border-soft, rgba(15, 23, 42, 0.06));
  border-radius: 999px;
  color: var(--admin-muted, #64748b);
}

.user-menu span {
  font-size: 13px;
  color: #1d1d1f;
}

.logout-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #86868b;
  transition: all 0.2s ease;
}

.logout-btn:hover {
  background: rgba(255, 59, 48, 0.1);
  color: #FF3B30;
}

.content {
  flex: 1;
  padding: 32px;
  background:
    radial-gradient(circle at 18% 0%, rgba(0, 122, 255, 0.04), transparent 28%),
    var(--admin-bg, #f4f6f9);
}
</style>
