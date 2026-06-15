<template>
  <div class="download-container">
    <section class="download-card">
      <div class="eyebrow">客户端安装包</div>
      <h1>下载插件 ZIP</h1>
      <p class="intro">
        安装包会按当前后台访问地址生成连接配置，无需登录后台账号即可下载。
      </p>

      <div class="info-card">
        <span>当前连接地址</span>
        <strong>{{ serverUrl || '正在识别...' }}</strong>
      </div>

      <button type="button" class="download-btn" :disabled="downloading" @click="downloadExtension">
        <span v-if="downloading" class="loading-spinner"></span>
        <span v-else>下载 ZIP 安装包</span>
      </button>

      <router-link class="login-link" to="/login">返回管理员登录</router-link>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { extensionApi } from '@/api'

const downloading = ref(false)
const serverUrl = ref('')

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

const loadInfo = async () => {
  try {
    const info = await extensionApi.getInfo()
    serverUrl.value = info.serverUrl || ''
  } catch (error) {
    serverUrl.value = ''
  }
}

const downloadExtension = async () => {
  downloading.value = true
  try {
    const blob = await extensionApi.downloadZip()
    saveBlob(blob, 'qrcode-extension.zip')
    ElMessage.success('插件 ZIP 已开始下载')
  } catch (error) {
    ElMessage.error('插件下载失败，请检查服务器是否可用')
  } finally {
    downloading.value = false
  }
}

onMounted(loadInfo)
</script>

<style scoped>
.download-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 20% 14%, rgba(0, 122, 255, 0.12), transparent 30%),
    radial-gradient(circle at 82% 18%, rgba(20, 184, 166, 0.1), transparent 28%),
    linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%);
}

.download-card {
  width: min(420px, 100%);
  padding: 36px 32px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--admin-shadow-lg);
  backdrop-filter: blur(18px);
}

.eyebrow {
  font-size: 12px;
  font-weight: 750;
  color: var(--admin-primary);
  letter-spacing: 0.08em;
}

h1 {
  margin: 10px 0 10px;
  color: var(--admin-text);
  font-size: 28px;
  letter-spacing: -0.6px;
}

.intro {
  margin: 0;
  color: var(--admin-muted);
  line-height: 1.7;
}

.info-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 24px 0;
  padding: 14px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  background: rgba(248, 250, 252, 0.9);
}

.info-card span {
  font-size: 12px;
  color: var(--admin-muted);
}

.info-card strong {
  color: var(--admin-text);
  font-size: 14px;
  word-break: break-all;
}

.download-btn {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-primary);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.download-btn:hover:not(:disabled) {
  background: var(--admin-primary-dark);
  box-shadow: 0 12px 24px rgba(0, 122, 255, 0.18);
}

.download-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.login-link {
  display: block;
  margin-top: 18px;
  color: var(--admin-muted);
  font-size: 13px;
  text-align: center;
  text-decoration: none;
}

.login-link:hover {
  color: var(--admin-primary);
}

.loading-spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
