<template>
  <div class="storage-governance">
    <section class="hero-panel">
      <div>
        <span class="eyebrow">STORAGE GOVERNANCE</span>
        <h2>存储治理</h2>
        <p>观察数据库、截图上传目录和历史日志增长，按保守策略清理过期数据。</p>
      </div>
      <div class="hero-actions">
        <el-button :icon="Refresh" :loading="loading" @click="fetchOverview">刷新</el-button>
      </div>
    </section>

    <section class="metric-grid">
      <article class="metric-card">
        <span>数据库文件</span>
        <strong>{{ formatBytes(overview?.database?.bytes) }}</strong>
        <small>{{ shortPath(overview?.database?.path) }}</small>
      </article>
      <article class="metric-card">
        <span>上传截图</span>
        <strong>{{ formatBytes(overview?.uploads?.bytes) }}</strong>
        <small>{{ overview?.uploads?.file_count || 0 }} 个文件</small>
      </article>
      <article class="metric-card" :class="{ warning: orphanCount > 0 }">
        <span>孤儿文件</span>
        <strong>{{ orphanCount }}</strong>
        <small>{{ formatBytes(overview?.uploads?.orphan_bytes) }} 可确认后清理</small>
      </article>
      <article class="metric-card">
        <span>业务记录</span>
        <strong>{{ overview?.records?.qrcodes || 0 }}</strong>
        <small>二维码最新记录</small>
      </article>
    </section>

    <section v-if="overview?.warnings?.length" class="warning-panel">
      <div v-for="warning in overview.warnings" :key="warning" class="warning-item">
        {{ warning }}
      </div>
    </section>

    <section class="content-grid">
      <el-card class="governance-card">
        <template #header>
          <div class="card-header">
            <div>
              <span>记录增长点</span>
              <p>这里展示最容易持续增长的表，方便判断是否需要清理。</p>
            </div>
          </div>
        </template>

        <div class="record-list">
          <div v-for="item in recordItems" :key="item.key" class="record-item">
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.desc }}</span>
            </div>
            <em>{{ item.value }}</em>
          </div>
        </div>
      </el-card>

      <el-card class="governance-card">
        <template #header>
          <div class="card-header">
            <div>
              <span>清理候选</span>
              <p>按当前保留周期估算，不会包含待确认草稿和仍被引用的截图。</p>
            </div>
          </div>
        </template>

        <div class="candidate-grid">
          <div v-for="item in candidateItems" :key="item.key" class="candidate-item">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </el-card>
    </section>

    <section class="content-grid cleanup-grid">
      <el-card class="governance-card cleanup-card">
        <template #header>
          <div class="card-header">
            <div>
              <span>手动清理</span>
              <p>默认只清理历史日志、验证码消息、已结束任务和已处理草稿。</p>
            </div>
          </div>
        </template>

        <el-form label-position="top" class="cleanup-form">
          <div class="retention-grid">
            <el-form-item label="上传审计保留天数">
              <el-input-number v-model="form.auditLogRetentionDays" :min="1" :max="3650" />
            </el-form-item>
            <el-form-item label="验证码消息保留天数">
              <el-input-number v-model="form.emailMessageRetentionDays" :min="1" :max="3650" />
            </el-form-item>
            <el-form-item label="验证码任务保留天数">
              <el-input-number v-model="form.emailTaskRetentionDays" :min="1" :max="3650" />
            </el-form-item>
            <el-form-item label="已处理草稿保留天数">
              <el-input-number v-model="form.draftRetentionDays" :min="1" :max="3650" />
            </el-form-item>
          </div>

          <div class="switch-list">
            <el-checkbox v-model="form.cleanupAuditLogs">清理过期上传审计日志</el-checkbox>
            <el-checkbox v-model="form.cleanupEmailMessages">清理过期验证码邮件记录</el-checkbox>
            <el-checkbox v-model="form.cleanupEmailTasks">清理过期已结束验证码任务</el-checkbox>
            <el-checkbox v-model="form.cleanupDrafts">清理过期已处理采集草稿</el-checkbox>
            <el-checkbox v-model="form.compactDatabase">清理后压缩数据库文件</el-checkbox>
            <el-checkbox v-model="form.deleteOrphanUploads" class="danger-check">同时删除孤儿上传文件</el-checkbox>
          </div>

          <div class="cleanup-actions">
            <el-button type="primary" :loading="cleaning" @click="confirmCleanup">执行清理</el-button>
            <span>孤儿文件默认不删除，确认来源后再勾选。</span>
          </div>
        </el-form>
      </el-card>

      <el-card class="governance-card">
        <template #header>
          <div class="card-header">
            <div>
              <span>孤儿文件样本</span>
              <p>这些文件存在于 uploads，但当前数据库没有引用。</p>
            </div>
          </div>
        </template>

        <div v-if="orphanSamples.length" class="orphan-list">
          <div v-for="file in orphanSamples" :key="file.path" class="orphan-item">
            <div>
              <strong>{{ file.path }}</strong>
              <span>{{ formatDate(file.modified_at) }}</span>
            </div>
            <em>{{ formatBytes(file.bytes) }}</em>
          </div>
        </div>
        <div v-else class="empty-state">未发现孤儿上传文件。</div>
      </el-card>
    </section>

    <el-card v-if="cleanupResult" class="governance-card result-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>最近一次清理结果</span>
            <p>{{ cleanupResult.compacted ? '已执行数据库压缩。' : '未执行数据库压缩或无需要压缩的数据。' }}</p>
          </div>
        </div>
      </template>
      <div class="result-grid">
        <div v-for="item in resultItems" :key="item.key" class="result-item">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { storageApi } from '@/api'

const loading = ref(false)
const cleaning = ref(false)
const overview = ref(null)
const cleanupResult = ref(null)

const form = reactive({
  auditLogRetentionDays: 90,
  emailMessageRetentionDays: 30,
  emailTaskRetentionDays: 7,
  draftRetentionDays: 30,
  cleanupAuditLogs: true,
  cleanupEmailMessages: true,
  cleanupEmailTasks: true,
  cleanupDrafts: true,
  compactDatabase: true,
  deleteOrphanUploads: false
})

const orphanCount = computed(() => overview.value?.uploads?.orphan_count || 0)
const orphanSamples = computed(() => overview.value?.uploads?.orphan_samples || [])

const recordItems = computed(() => [
  { key: 'qrcodes', label: '二维码记录', value: overview.value?.records?.qrcodes || 0, desc: '普通用户自动上传与组长代扫保留的最新记录' },
  { key: 'audit', label: '上传审计日志', value: overview.value?.records?.upload_audit_logs || 0, desc: '允许、拒绝、失败等上传决策追踪' },
  { key: 'messages', label: '验证码邮件记录', value: overview.value?.records?.email_messages || 0, desc: '已捕获并解析的邮件验证码记录' },
  { key: 'tasks', label: '验证码任务', value: overview.value?.records?.email_tasks || 0, desc: '插件点击发送验证码后创建的短生命周期任务' },
  { key: 'drafts', label: '采集草稿', value: overview.value?.records?.collection_drafts || 0, desc: '管理员采集后等待确认或已处理的规则草稿' }
])

const candidateItems = computed(() => [
  { key: 'audit', label: '过期审计日志', value: overview.value?.cleanup_candidates?.auditLogs || 0 },
  { key: 'messages', label: '过期邮件记录', value: overview.value?.cleanup_candidates?.emailMessages || 0 },
  { key: 'tasks', label: '过期验证码任务', value: overview.value?.cleanup_candidates?.emailTasks || 0 },
  { key: 'drafts', label: '过期已处理草稿', value: overview.value?.cleanup_candidates?.drafts || 0 },
  { key: 'orphan', label: '孤儿上传文件', value: overview.value?.uploads?.orphan_count || 0 }
])

const resultItems = computed(() => {
  const deleted = cleanupResult.value?.deleted || {}
  return [
    { key: 'audit', label: '审计日志', value: deleted.audit_logs || 0 },
    { key: 'messages', label: '邮件记录', value: deleted.email_messages || 0 },
    { key: 'tasks', label: '验证码任务', value: deleted.email_tasks || 0 },
    { key: 'drafts', label: '采集草稿', value: deleted.drafts || 0 },
    { key: 'draftFiles', label: '草稿截图', value: deleted.draft_screenshot_files || 0 },
    { key: 'orphanFiles', label: '孤儿文件', value: deleted.orphan_upload_files || 0 },
    { key: 'bytes', label: '释放上传空间', value: formatBytes(deleted.upload_bytes || 0) }
  ]
})

const applyRetentionDefaults = (retention) => {
  if (!retention) return
  form.auditLogRetentionDays = retention.auditLogRetentionDays || form.auditLogRetentionDays
  form.emailMessageRetentionDays = retention.emailMessageRetentionDays || form.emailMessageRetentionDays
  form.emailTaskRetentionDays = retention.emailTaskRetentionDays || form.emailTaskRetentionDays
  form.draftRetentionDays = retention.draftRetentionDays || form.draftRetentionDays
}

const fetchOverview = async () => {
  loading.value = true
  try {
    overview.value = await storageApi.getOverview()
    applyRetentionDefaults(overview.value.retention)
  } catch (error) {
    console.error('Fetch storage overview failed:', error)
  } finally {
    loading.value = false
  }
}

const confirmCleanup = async () => {
  const warning = form.deleteOrphanUploads
    ? '本次会删除孤儿上传文件。请确认这些文件不再被业务记录引用。'
    : '本次不会删除孤儿上传文件，只清理过期历史记录。'

  try {
    await ElMessageBox.confirm(warning, '确认执行存储清理', {
      confirmButtonText: '执行清理',
      cancelButtonText: '取消',
      type: form.deleteOrphanUploads ? 'warning' : 'info'
    })
    await runCleanup()
  } catch (error) {
    if (error !== 'cancel') console.error('Confirm cleanup failed:', error)
  }
}

const runCleanup = async () => {
  cleaning.value = true
  try {
    cleanupResult.value = await storageApi.cleanup({ ...form })
    overview.value = cleanupResult.value.after
    ElMessage.success('存储清理已完成')
  } catch (error) {
    console.error('Storage cleanup failed:', error)
  } finally {
    cleaning.value = false
  }
}

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`
}

const shortPath = (value) => {
  if (!value) return '-'
  const text = String(value).replace(/\\/g, '/')
  const index = text.lastIndexOf('/server/')
  return index >= 0 ? text.slice(index + 1) : text
}

const formatDate = (value) => {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'
}

onMounted(fetchOverview)
</script>

<style scoped>
.storage-governance {
  display: grid;
  gap: 18px;
}

.hero-panel {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 22px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.92)),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 36%);
  box-shadow: var(--admin-shadow-md);
}

.eyebrow {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.hero-panel h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: 28px;
  letter-spacing: -0.03em;
}

.hero-panel p,
.card-header p {
  margin: 7px 0 0;
  color: var(--admin-muted);
  line-height: 1.6;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.metric-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--admin-border-soft);
  border-top: 3px solid var(--admin-primary);
  border-radius: var(--admin-radius-xl);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.metric-card.warning {
  border-top-color: var(--admin-warning);
}

.metric-card span,
.candidate-item span,
.result-item span {
  color: var(--admin-muted);
  font-size: 12px;
  font-weight: 700;
}

.metric-card strong {
  color: var(--admin-text);
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

.metric-card small {
  overflow: hidden;
  color: var(--admin-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warning-panel {
  display: grid;
  gap: 8px;
}

.warning-item {
  padding: 12px 14px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: var(--admin-radius-lg);
  background: rgba(255, 251, 235, 0.86);
  color: #92400e;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.7fr);
  gap: 18px;
}

.governance-card {
  border-radius: var(--admin-radius-xl);
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.card-header span {
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 800;
}

.record-list,
.orphan-list {
  display: grid;
  gap: 10px;
}

.record-item,
.orphan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
}

.record-item div,
.orphan-item div {
  min-width: 0;
}

.record-item strong,
.orphan-item strong {
  display: block;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-item span,
.orphan-item span {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-item em,
.orphan-item em {
  color: var(--admin-text);
  font-style: normal;
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.candidate-grid,
.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.candidate-item,
.result-item {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
}

.candidate-item strong,
.result-item strong {
  color: var(--admin-text);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.cleanup-form {
  display: grid;
  gap: 12px;
}

.retention-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

.switch-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  padding: 12px;
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
}

.danger-check :deep(.el-checkbox__label) {
  color: #b45309;
  font-weight: 700;
}

.cleanup-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cleanup-actions span {
  color: var(--admin-muted);
  font-size: 12px;
}

.empty-state {
  padding: 34px 16px;
  border: 1px dashed var(--admin-border);
  border-radius: var(--admin-radius-lg);
  color: var(--admin-muted);
  text-align: center;
}

@media (max-width: 1180px) {
  .metric-grid,
  .content-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cleanup-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .metric-grid,
  .content-grid,
  .candidate-grid,
  .result-grid,
  .retention-grid,
  .switch-list {
    grid-template-columns: 1fr;
  }
}
</style>
