<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="5" fill="#007AFF"/>
          <path d="M9.4 8H15M9.1 9.7L11.2 14M14.9 9.7L12.8 14" stroke="white" stroke-width="1.45" stroke-linecap="round" opacity="0.82"/>
          <circle cx="8" cy="8" r="2" fill="white"/>
          <circle cx="16" cy="8" r="2" fill="white"/>
          <circle cx="12" cy="16" r="2.2" fill="white"/>
        </svg>
        <h2>采集中枢</h2>
        <p>管理后台登录</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="input-group">
          <label>用户名</label>
          <input
            v-model="loginForm.username"
            type="text"
            placeholder="输入用户名"
            autocomplete="username"
          />
        </div>

        <div class="input-group">
          <label>密码</label>
          <input
            v-model="loginForm.password"
            type="password"
            placeholder="输入密码"
            autocomplete="current-password"
          />
        </div>

        <button type="submit" class="login-btn" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          <span v-else>登录</span>
        </button>
        <button type="button" class="download-btn" :disabled="downloadingExtension" @click="downloadExtension">
          <span v-if="downloadingExtension" class="loading-spinner dark"></span>
          <span v-else>下载插件 ZIP</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { extensionApi } from '@/api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const downloadingExtension = ref(false)

const loginForm = reactive({
  username: '',
  password: ''
})

const handleLogin = async () => {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }

  loading.value = true
  try {
    await authStore.login(loginForm.username, loginForm.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (error) {
    ElMessage.error('登录失败，请检查用户名和密码')
  } finally {
    loading.value = false
  }
}

const downloadExtension = async () => {
  downloadingExtension.value = true
  try {
    const blob = await extensionApi.downloadZip()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'qrcode-extension.zip'
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('插件 ZIP 已开始下载')
  } catch (error) {
    console.error('Download extension failed:', error)
    ElMessage.error('插件下载失败，请检查服务器是否可用')
  } finally {
    downloadingExtension.value = false
  }
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 18% 12%, rgba(0, 122, 255, 0.1), transparent 30%),
    radial-gradient(circle at 82% 20%, rgba(20, 184, 166, 0.1), transparent 28%),
    linear-gradient(180deg, #f7f9fc 0%, var(--admin-bg) 58%, #eef2f7 100%);
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 360px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  padding: 40px 32px;
  box-shadow: var(--admin-shadow-lg);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-header svg {
  margin-bottom: 16px;
}

.login-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--admin-text);
  margin: 0 0 8px 0;
  letter-spacing: -0.5px;
}

.login-header p {
  font-size: 13px;
  color: var(--admin-muted);
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-group label {
  font-size: 13px;
  font-weight: 650;
  color: var(--admin-text);
}

.input-group input {
  padding: 14px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  font-size: 15px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

.input-group input:focus {
  outline: none;
  border-color: var(--admin-primary);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
}

.input-group input::placeholder {
  color: var(--admin-muted-light);
}

.login-btn {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: var(--admin-radius-sm);
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: var(--admin-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 8px;
}

.login-btn:hover:not(:disabled) {
  background: var(--admin-primary-dark);
  box-shadow: 0 12px 24px rgba(0, 122, 255, 0.18);
}

.login-btn:active:not(:disabled) {
  background: var(--admin-primary-dark);
  transform: scale(0.98);
}

.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.download-btn {
  width: 100%;
  padding: 13px;
  border: 1px solid rgba(0, 122, 255, 0.22);
  border-radius: var(--admin-radius-sm);
  font-size: 14px;
  font-weight: 650;
  color: var(--admin-primary);
  background: rgba(0, 122, 255, 0.06);
  cursor: pointer;
  transition: all 0.2s ease;
}

.download-btn:hover:not(:disabled) {
  background: rgba(0, 122, 255, 0.1);
  box-shadow: 0 10px 22px rgba(0, 122, 255, 0.1);
}

.download-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.loading-spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-spinner.dark {
  border-color: rgba(0, 122, 255, 0.2);
  border-top-color: var(--admin-primary);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
