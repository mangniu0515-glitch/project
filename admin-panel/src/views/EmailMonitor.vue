<template>
  <div class="email-monitor">
    <section class="monitor-toolbar">
      <div class="monitor-summary">
        <span class="state-dot" :class="monitorState.className"></span>
        <div>
          <strong>{{ monitorState.title }}</strong>
          <small>{{ monitorState.description }}</small>
        </div>
      </div>
      <div class="monitor-metrics">
        <span>今日 {{ statValue(stats.todayMessages) }}</span>
        <span>已提取 {{ statValue(stats.matchedMessages) }}</span>
        <span>累计 {{ statValue(stats.totalMessages) }}</span>
      </div>
      <div class="monitor-links">
        <el-button text @click="goToEmailPool">邮箱池</el-button>
        <el-button text @click="openRuleDialog()">新增规则</el-button>
      </div>
    </section>
    <el-alert
      v-if="pollError"
      class="poll-alert"
      type="error"
      :closable="false"
      show-icon
      :title="pollError"
    >
      <template #default>
        <button type="button" class="inline-retry" @click="pollNow(false)">重新检查</button>
      </template>
    </el-alert>

    <section class="rule-panel">
      <div class="section-heading">
        <div>
          <span>监听规则</span>
          <h3>多来源验证码识别</h3>
          <p>每条规则独立限制发件人、主题和验证码提取表达式；邮箱同步时会按启用规则逐条匹配。</p>
        </div>
        <div class="rule-summary">
          <strong>{{ enabledRuleCount }}</strong>
          <span>/ {{ monitorRules.length }} 启用</span>
          <el-button type="primary" size="small" @click="openRuleDialog()">新增规则</el-button>
        </div>
      </div>

      <div v-if="monitorRules.length" class="rule-grid">
        <article
          v-for="rule in monitorRules"
          :key="rule.id"
          class="rule-card"
          :class="{ disabled: !rule.enabled }"
        >
          <div class="rule-card-header">
            <div>
              <strong>{{ rule.name }}</strong>
              <small>{{ rule.sender_pattern }}</small>
            </div>
            <el-switch
              :model-value="rule.enabled"
              size="small"
              @change="value => toggleRule(rule, value)"
            />
          </div>
          <div class="rule-meta">
            <span>主题：{{ rule.subject_pattern || '不限' }}</span>
            <span>命中：{{ rule.captured_count || 0 }} 封</span>
          </div>
          <code>{{ rule.extraction_pattern }}</code>
          <div class="rule-actions">
            <el-button type="primary" link @click="openRuleDialog(rule)">编辑</el-button>
            <el-button type="danger" link @click="deleteRule(rule)">删除</el-button>
          </div>
        </article>
      </div>
      <div v-else class="rule-empty">
        <strong>还没有监听规则</strong>
        <span>新增至少一条规则后，系统才会读取符合来源的邮件正文。</span>
        <el-button type="primary" size="small" @click="openRuleDialog()">新增监听规则</el-button>
      </div>
    </section>

    <section class="control-panel">
      <div class="filters">
        <el-select v-model="filters.accountId" class="account-filter" @change="handleFilterChange">
          <el-option label="全部启用邮箱" :value="0" />
          <el-option
            v-for="account in accounts"
            :key="account.id"
            :label="`${account.name} · ${account.email_address}`"
            :value="account.id"
          />
        </el-select>
        <el-select
          v-model="filters.status"
          class="status-filter"
          placeholder="全部解析状态"
          @change="handleFilterChange"
        >
          <el-option label="全部解析状态" value="" />
          <el-option label="已提取验证码" value="matched" />
          <el-option label="待人工确认" value="unmatched" />
        </el-select>
        <el-input
          v-model="filters.search"
          class="search-input"
          clearable
          placeholder="搜索发件人、主题或验证码"
          @keyup.enter="handleFilterChange"
          @clear="handleFilterChange"
        />
        <el-button text :disabled="!hasActiveFilters" @click="resetFilters">重置</el-button>
      </div>
      <div class="actions">
        <el-button :loading="polling" :disabled="accounts.length === 0 || enabledRuleCount === 0" @click="pollNow(false)">{{ polling ? '正在检查' : '立即检查' }}</el-button>
        <el-button
          :type="autoRefresh ? 'success' : 'default'"
          :disabled="accounts.length === 0 || enabledRuleCount === 0"
          @click="toggleAutoRefresh"
        >
          {{ autoRefresh ? '自动监听中' : '开启自动监听' }}
        </el-button>
        <el-button type="danger" plain :disabled="selectedIds.length === 0" @click="batchDelete">
          删除选中（{{ selectedIds.length }}）
        </el-button>
      </div>
    </section>

    <section class="message-table">
      <el-table
        v-loading="loading"
        :data="messages"
        row-key="id"
        highlight-current-row
        :row-class-name="messageRowClass"
        @selection-change="handleSelectionChange"
        @row-click="toggleFocusedRow"
      >
        <template #empty>
          <div class="empty-state">
            <span class="empty-icon">✉</span>
            <strong>{{ emptyState.title }}</strong>
            <p>{{ emptyState.description }}</p>
            <div class="empty-actions">
              <el-button v-if="accounts.length" :loading="polling" @click="pollNow(false)">立即检查收件箱</el-button>
              <el-button v-else type="primary" @click="goToEmailPool">配置邮箱池</el-button>
            </div>
          </div>
        </template>

        <el-table-column type="selection" width="46" />
        <el-table-column label="状态" width="118">
          <template #default="{ row }">
            <span class="status-pill" :class="row.parse_status">
              {{ row.parse_status === 'matched' ? '已提取' : '待确认' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="验证码" width="160">
          <template #default="{ row }">
            <button
              v-if="row.verification_code"
              class="code-button"
              title="点击复制验证码"
              @click.stop="copyCode(row.verification_code)"
            >
              {{ row.verification_code }}
            </button>
            <span v-else class="no-code">未识别</span>
          </template>
        </el-table-column>
        <el-table-column label="邮箱" min-width="190">
          <template #default="{ row }">
            <div class="mailbox-cell">
              <strong>{{ row.account_name }}</strong>
              <span>{{ row.email_address }}</span>
              <em>{{ row.monitor_rule_name || '历史记录' }}</em>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="sender" label="发件人" min-width="190" show-overflow-tooltip />
        <el-table-column prop="subject" label="邮件主题" min-width="260" show-overflow-tooltip />
        <el-table-column label="接收时间" width="182">
          <template #default="{ row }">
            <div class="time-cell">
              <strong>{{ formatDate(row.received_at || row.captured_at) }}</strong>
              <small>{{ formatRelative(row.received_at || row.captured_at) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" link @click.stop="deleteMessage(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="focusedMessage" class="message-detail">
        <button class="detail-close" type="button" @click="focusedId = null">收起</button>
        <div class="code-stage" :class="{ empty: !focusedMessage.verification_code }">
          <span>VERIFICATION CODE</span>
          <strong>{{ focusedMessage.verification_code || '未识别' }}</strong>
          <button
            v-if="focusedMessage.verification_code"
            type="button"
            @click="copyCode(focusedMessage.verification_code)"
          >
            复制验证码
          </button>
        </div>
        <div class="detail-content">
          <div class="detail-title">
            <span>#{{ focusedMessage.id }}</span>
            <strong>{{ focusedMessage.subject || '无主题邮件' }}</strong>
          </div>
          <dl>
            <div><dt>监听邮箱</dt><dd>{{ focusedMessage.email_address }}</dd></div>
            <div><dt>命中规则</dt><dd>{{ focusedMessage.monitor_rule_name || '历史记录' }}</dd></div>
            <div><dt>发件人</dt><dd>{{ focusedMessage.sender || '-' }}</dd></div>
            <div><dt>收件人</dt><dd>{{ focusedMessage.recipient || '-' }}</dd></div>
            <div><dt>接收时间</dt><dd>{{ formatDate(focusedMessage.received_at || focusedMessage.captured_at) }}</dd></div>
          </dl>
          <div class="preview">
            <span>邮件文本预览</span>
            <p>{{ focusedMessage.text_preview || '没有可显示的文本内容。' }}</p>
          </div>
        </div>
      </div>
    </section>

    <div class="pagination">
      <span>共 {{ pagination.total }} 条记录</span>
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="sizes, prev, pager, next"
        :total="pagination.total"
        @size-change="fetchMessages"
        @current-change="fetchMessages"
      />
    </div>

    <el-dialog
      v-model="ruleDialogVisible"
      :title="editingRuleId ? '编辑监听规则' : '新增监听规则'"
      width="620px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="规则名称">
          <el-input v-model="ruleForm.name" maxlength="80" placeholder="例如：TLabel 邮箱验证码" />
        </el-form-item>
        <div class="rule-form-grid">
          <el-form-item label="允许的发件人">
            <el-input v-model="ruleForm.sender_pattern" placeholder="tlabel@tencent.com" />
            <small class="field-help">支持精确邮箱或通配符，例如 *@tencent.com</small>
          </el-form-item>
          <el-form-item label="主题模式">
            <el-input v-model="ruleForm.subject_pattern" placeholder="*验证码*" />
            <small class="field-help">支持 * 通配；留空表示不限制主题</small>
          </el-form-item>
        </div>
        <el-form-item label="验证码提取表达式">
          <el-input
            v-model="ruleForm.extraction_pattern"
            type="textarea"
            :rows="3"
            placeholder="验证码(?:为|是)?[：:\s]*((?:\d[\s-]?){4,8})"
          />
          <small class="field-help">使用 JavaScript 正则语法，必须用第一个捕获组圈出验证码。</small>
        </el-form-item>
        <el-form-item label="测试文本">
          <el-input
            v-model="ruleTestText"
            type="textarea"
            :rows="3"
            placeholder="粘贴一段示例邮件文本，保存前确认是否能正确提取。"
          />
        </el-form-item>
        <div class="rule-test-row">
          <el-button :loading="testingRule" @click="testRulePattern">测试提取</el-button>
          <span v-if="ruleTestResult" class="rule-test-result" :class="{ success: ruleTestResult.matched }">
            {{ ruleTestResult.matched ? `提取结果：${ruleTestResult.verification_code}` : '未提取到验证码' }}
          </span>
          <el-switch v-model="ruleForm.enabled" active-text="启用规则" />
        </div>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingRule" @click="saveRule">保存规则</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import dayjs from 'dayjs'
import { emailPoolApi } from '@/api'

const router = useRouter()
const loading = ref(false)
const initializing = ref(true)
const polling = ref(false)
const autoRefresh = ref(true)
const accounts = ref([])
const monitorRules = ref([])
const messages = ref([])
const selectedIds = ref([])
const focusedId = ref(null)
const lastPollAt = ref(null)
const pollError = ref('')
const lastPollSummary = ref('')
const newMessageIds = ref(new Set())
const ruleDialogVisible = ref(false)
const editingRuleId = ref(null)
const savingRule = ref(false)
const testingRule = ref(false)
const ruleTestText = ref('您好，您正在登录 TLabel 标注平台，验证码为： 3 8 8 3 5 3')
const ruleTestResult = ref(null)
let knownMessageIds = new Set()
let autoRefreshTimer = null
let highlightTimer = null

const filters = reactive({
  accountId: 0,
  status: '',
  search: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const stats = reactive({
  enabledAccounts: 0,
  enabledRules: 0,
  totalMessages: 0,
  matchedMessages: 0,
  todayMessages: 0
})

const createDefaultRuleForm = () => ({
  name: 'TLabel 邮箱验证码',
  sender_pattern: 'tlabel@tencent.com',
  subject_pattern: '*验证码*',
  extraction_pattern: String.raw`验证码(?:为|是)?[：:\s]*((?:\d[\s-]?){4,8})`,
  enabled: true
})

const ruleForm = reactive(createDefaultRuleForm())

const focusedMessage = computed(() => {
  return messages.value.find(item => item.id === focusedId.value) || null
})

const healthyAccounts = computed(() => {
  return accounts.value.filter(account => account.last_sync_status === 'success').length
})

const failedAccounts = computed(() => {
  return accounts.value.filter(account => account.last_sync_status === 'failed')
})

const enabledRuleCount = computed(() => {
  return monitorRules.value.filter(rule => rule.enabled).length
})

const hasActiveFilters = computed(() => {
  return Boolean(filters.accountId || filters.status || filters.search)
})

const lastPollText = computed(() => {
  if (polling.value) return '正在连接收件箱'
  if (pollError.value) return '最近一次检查失败'
  if (!lastPollAt.value) return '等待首次检查'
  return `${dayjs(lastPollAt.value).format('HH:mm:ss')} · ${lastPollSummary.value || '检查完成'}`
})

const monitorState = computed(() => {
  if (initializing.value) {
    return { className: 'connecting', title: '正在初始化', description: '读取邮箱池与监听状态' }
  }
  if (accounts.value.length === 0) {
    return { className: 'warning', title: '尚未配置邮箱', description: '请先在邮箱池启用一个邮箱' }
  }
  if (enabledRuleCount.value === 0) {
    return { className: 'warning', title: '尚未启用规则', description: '请至少启用一条验证码监听规则' }
  }
  if (pollError.value || failedAccounts.value.length > 0) {
    return { className: 'error', title: '监听异常', description: lastPollText.value }
  }
  if (polling.value) {
    return { className: 'connecting', title: '正在检查', description: '正在读取邮箱中的新邮件' }
  }
  if (!autoRefresh.value) {
    return { className: 'paused', title: '监听已暂停', description: lastPollText.value }
  }
  return { className: 'active', title: '正在监听', description: lastPollText.value }
})

const emptyState = computed(() => {
  if (!accounts.value.length) {
    return {
      title: '还没有可监听的邮箱',
      description: '先在邮箱池添加并启用邮箱，监听页会自动开始检查新邮件。'
    }
  }
  if (hasActiveFilters.value) {
    return {
      title: '没有符合条件的记录',
      description: '调整筛选条件，或重置后查看全部验证码邮件。'
    }
  }
  return {
    title: '等待第一封验证码邮件',
    description: '当前邮箱连接正常。触发验证码邮件后，通常会在 15 秒内出现在这里。'
  }
})

const statValue = value => initializing.value ? '—' : value

const fetchAccounts = async () => {
  const response = await emailPoolApi.getAccounts()
  accounts.value = (response.accounts || []).filter(account => account.enabled)
}

const fetchStats = async () => {
  const response = await emailPoolApi.getMonitorStats()
  Object.assign(stats, response)
}

const fetchMonitorRules = async () => {
  const response = await emailPoolApi.getMonitorRules()
  monitorRules.value = response.rules || []
}

const setNewMessageHighlights = ids => {
  if (highlightTimer) clearTimeout(highlightTimer)
  newMessageIds.value = new Set(ids)
  if (ids.length) {
    highlightTimer = setTimeout(() => {
      newMessageIds.value = new Set()
    }, 10000)
  }
}

const fetchMessages = async (detectNew = false) => {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      limit: pagination.pageSize
    }
    if (filters.accountId) params.account_id = filters.accountId
    if (filters.status) params.status = filters.status
    if (filters.search) params.search = filters.search.trim()

    const response = await emailPoolApi.getMessages(params)
    const nextMessages = response.messages || []
    const freshIds = detectNew
      ? nextMessages.filter(item => !knownMessageIds.has(item.id)).map(item => item.id)
      : []

    messages.value = nextMessages
    pagination.total = response.pagination?.total || 0
    nextMessages.forEach(item => knownMessageIds.add(item.id))
    setNewMessageHighlights(freshIds)

    if (focusedId.value && !nextMessages.some(item => item.id === focusedId.value)) {
      focusedId.value = null
    }
    return freshIds
  } finally {
    loading.value = false
  }
}

const refreshView = async () => {
  await Promise.all([fetchMessages(false), fetchStats(), fetchAccounts(), fetchMonitorRules()])
}

const buildPollError = results => {
  const failures = (results || []).filter(item => !item.success)
  if (!failures.length) return ''
  const first = failures[0]
  const name = first.email_address || `邮箱 #${first.account_id}`
  return `${name} 检查失败：${first.error || '无法连接邮箱服务器'}`
}

const pollNow = async (silent = false) => {
  if (polling.value || accounts.value.length === 0) return
  if (enabledRuleCount.value === 0) {
    if (!silent) ElMessage.warning('请先启用至少一条监听规则')
    return
  }
  polling.value = true
  pollError.value = ''

  try {
    const payload = filters.accountId ? { account_id: filters.accountId } : {}
    const response = await emailPoolApi.pollMessages(payload)
    const inserted = Number(response.totals?.inserted || 0)
    const matched = Number(response.totals?.matched || 0)
    const scanned = (response.results || []).reduce((sum, item) => sum + Number(item.scanned || 0), 0)
    const bodyFetched = (response.results || []).reduce((sum, item) => sum + Number(item.body_fetched || 0), 0)
    const resultError = buildPollError(response.results)

    lastPollAt.value = new Date()
    lastPollSummary.value = inserted > 0
      ? `新增 ${inserted} 封，提取 ${matched} 个验证码`
      : `检查邮件头 ${scanned} 封，仅读取白名单正文 ${bodyFetched} 封`
    pollError.value = resultError

    const [, freshIds] = await Promise.all([
      Promise.all([fetchStats(), fetchAccounts()]),
      fetchMessages(true)
    ])

    if (inserted > 0) {
      const firstNew = messages.value.find(item => freshIds.includes(item.id))
      ElNotification({
        title: matched > 0 ? '收到新验证码' : '收到验证码相关邮件',
        message: firstNew?.verification_code
          ? `${firstNew.email_address} · ${firstNew.verification_code}`
          : `新增 ${inserted} 封邮件，其中 ${matched} 封已提取验证码`,
        type: matched > 0 ? 'success' : 'warning',
        duration: 6000
      })
    } else if (!silent && !resultError) {
      ElMessage.success('检查完成，暂无新验证码')
    }

    if (resultError && !silent) ElMessage.error(resultError)
  } catch (error) {
    pollError.value = error.response?.data?.error || '邮箱监听失败，请检查服务器和邮箱连接'
    lastPollAt.value = new Date()
    if (!silent) ElMessage.error(pollError.value)
    console.error('Email monitor poll failed:', error)
    await fetchAccounts().catch(() => {})
  } finally {
    polling.value = false
  }
}

const scheduleAutoRefresh = () => {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer)
  if (!autoRefresh.value || accounts.value.length === 0) return

  autoRefreshTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible') await pollNow(true)
    scheduleAutoRefresh()
  }, 15000)
}

const toggleAutoRefresh = async () => {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    await pollNow(true)
    scheduleAutoRefresh()
    ElMessage.success('已开启自动监听，每 15 秒检查一次')
  } else {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer)
    autoRefreshTimer = null
    ElMessage.info('自动监听已暂停')
  }
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible' && autoRefresh.value) {
    pollNow(true)
    scheduleAutoRefresh()
  }
}

const handleFilterChange = () => {
  pagination.page = 1
  fetchMessages(false)
}

const selectAccount = accountId => {
  filters.accountId = filters.accountId === accountId ? 0 : accountId
  handleFilterChange()
}

const resetFilters = () => {
  filters.accountId = 0
  filters.status = ''
  filters.search = ''
  handleFilterChange()
}

const handleSelectionChange = rows => {
  selectedIds.value = rows.map(row => row.id)
}

const toggleFocusedRow = row => {
  focusedId.value = focusedId.value === row.id ? null : row.id
}

const messageRowClass = ({ row }) => {
  return newMessageIds.value.has(row.id) ? 'new-message-row' : ''
}

const copyCode = async code => {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success(`验证码 ${code} 已复制`)
  } catch {
    ElMessage.error('复制失败，请手动选择验证码')
  }
}

const deleteMessage = async row => {
  try {
    await ElMessageBox.confirm('确定删除这条验证码监听记录吗？', '删除记录', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await emailPoolApi.deleteMessage(row.id)
    knownMessageIds.delete(row.id)
    if (focusedId.value === row.id) focusedId.value = null
    await Promise.all([fetchMessages(false), fetchStats()])
    ElMessage.success('记录已删除')
  } catch (error) {
    if (error !== 'cancel') console.error('Delete email message failed:', error)
  }
}

const batchDelete = async () => {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 条记录吗？`, '批量删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await emailPoolApi.batchDeleteMessages(selectedIds.value)
    selectedIds.value.forEach(id => knownMessageIds.delete(id))
    selectedIds.value = []
    focusedId.value = null
    await Promise.all([fetchMessages(false), fetchStats()])
    ElMessage.success('选中记录已删除')
  } catch (error) {
    if (error !== 'cancel') console.error('Batch delete email messages failed:', error)
  }
}

const openRuleDialog = rule => {
  editingRuleId.value = rule?.id || null
  Object.assign(ruleForm, rule ? {
    name: rule.name,
    sender_pattern: rule.sender_pattern,
    subject_pattern: rule.subject_pattern || '',
    extraction_pattern: rule.extraction_pattern,
    enabled: !!rule.enabled
  } : createDefaultRuleForm())
  ruleTestResult.value = null
  ruleDialogVisible.value = true
}

const testRulePattern = async () => {
  if (!ruleForm.extraction_pattern || !ruleTestText.value.trim()) {
    ElMessage.warning('请填写提取表达式和测试文本')
    return
  }
  testingRule.value = true
  try {
    ruleTestResult.value = await emailPoolApi.testMonitorRule({
      extraction_pattern: ruleForm.extraction_pattern,
      sample_text: ruleTestText.value
    })
  } finally {
    testingRule.value = false
  }
}

const saveRule = async () => {
  if (!ruleForm.name.trim() || !ruleForm.sender_pattern.trim() || !ruleForm.extraction_pattern.trim()) {
    ElMessage.warning('请完整填写规则名称、发件人和提取表达式')
    return
  }
  savingRule.value = true
  try {
    const payload = {
      name: ruleForm.name.trim(),
      sender_pattern: ruleForm.sender_pattern.trim(),
      subject_pattern: ruleForm.subject_pattern.trim(),
      extraction_pattern: ruleForm.extraction_pattern.trim(),
      enabled: ruleForm.enabled
    }
    if (editingRuleId.value) {
      await emailPoolApi.updateMonitorRule(editingRuleId.value, payload)
    } else {
      await emailPoolApi.createMonitorRule(payload)
    }
    ruleDialogVisible.value = false
    await Promise.all([fetchMonitorRules(), fetchStats(), fetchAccounts()])
    ElMessage.success('监听规则已保存')
    await pollNow(true)
  } finally {
    savingRule.value = false
  }
}

const toggleRule = async (rule, enabled) => {
  try {
    await emailPoolApi.updateMonitorRule(rule.id, {
      name: rule.name,
      sender_pattern: rule.sender_pattern,
      subject_pattern: rule.subject_pattern || '',
      extraction_pattern: rule.extraction_pattern,
      enabled
    })
    await Promise.all([fetchMonitorRules(), fetchStats()])
    ElMessage.success(enabled ? '规则已启用' : '规则已停用')
  } catch {
    await fetchMonitorRules()
  }
}

const deleteRule = async rule => {
  try {
    await ElMessageBox.confirm(
      `删除规则“${rule.name}”后，将不再读取该来源的新邮件正文。`,
      '删除监听规则',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await emailPoolApi.deleteMonitorRule(rule.id)
    await Promise.all([fetchMonitorRules(), fetchStats()])
    ElMessage.success('监听规则已删除')
  } catch (error) {
    if (error !== 'cancel') console.error('Delete email monitor rule failed:', error)
  }
}

const accountStatusClass = account => {
  if (account.last_sync_status === 'failed') return 'failed'
  if (account.last_sync_status === 'success') return 'healthy'
  return 'waiting'
}

const accountStatusText = account => {
  if (account.last_sync_status === 'failed') return '连接异常'
  if (account.last_sync_status === 'success') return '连接正常'
  return '等待检查'
}

const parseServerDate = date => {
  if (!date) return null
  const value = String(date)
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  return dayjs(hasTimezone ? value : `${value.replace(' ', 'T')}Z`)
}

const accountSyncTime = account => {
  if (!account.last_sync_at) return '尚未同步'
  return parseServerDate(account.last_sync_at).format('MM-DD HH:mm:ss')
}

const formatDate = date => {
  return date ? parseServerDate(date).format('YYYY-MM-DD HH:mm:ss') : '-'
}

const formatRelative = date => {
  if (!date) return ''
  const seconds = Math.max(0, dayjs().diff(parseServerDate(date), 'second'))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

const goToEmailPool = () => router.push('/email-pool')

onMounted(async () => {
  try {
    await refreshView()
    initializing.value = false
    if (accounts.value.length) await pollNow(true)
    scheduleAutoRefresh()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  } catch (error) {
    initializing.value = false
    pollError.value = '监听页面初始化失败，请刷新页面重试'
    console.error('Email monitor initialization failed:', error)
  }
})

onUnmounted(() => {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer)
  if (highlightTimer) clearTimeout(highlightTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<style scoped>
.email-monitor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1540px;
  margin: 0 auto;
}

.monitor-toolbar,
.control-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.monitor-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.monitor-summary strong,
.monitor-summary small {
  display: block;
}

.monitor-summary strong {
  color: var(--admin-text);
  font-size: 14px;
}

.monitor-summary small {
  max-width: 420px;
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #94a3b8;
}

.state-dot.active {
  background: #14b8a6;
  box-shadow: 0 0 0 6px rgba(20, 184, 166, 0.12);
  animation: pulse 1.8s ease-in-out infinite;
}

.state-dot.connecting {
  background: #0ea5e9;
  box-shadow: 0 0 0 6px rgba(14, 165, 233, 0.1);
  animation: pulse 1s ease-in-out infinite;
}

.state-dot.error,
.state-dot.warning {
  background: #f97316;
}

.state-dot.paused {
  background: #94a3b8;
}

.monitor-metrics,
.monitor-links,
.filters,
.actions {
  display: flex;
  align-items: center;
  gap: 9px;
}

.monitor-metrics {
  margin-left: auto;
  color: var(--admin-muted);
  font-size: 12px;
}

.monitor-metrics span {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--admin-bg-soft);
}

.poll-alert {
  border-radius: 12px;
}

.rule-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.section-heading span {
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.section-heading h3 {
  margin: 4px 0 0;
  color: var(--admin-text);
  font-size: 17px;
}

.section-heading p {
  margin: 5px 0 0;
  color: var(--admin-muted);
  line-height: 1.55;
}

.rule-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.rule-summary strong {
  color: var(--admin-text);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.rule-summary span {
  color: var(--admin-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}

.rule-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(20, 184, 166, 0.22);
  border-radius: var(--admin-radius-lg);
  background:
    linear-gradient(135deg, rgba(240, 253, 250, 0.74), rgba(255, 255, 255, 0.96));
}

.rule-card.disabled {
  border-color: var(--admin-border-soft);
  background: var(--admin-bg-soft);
  opacity: 0.72;
}

.rule-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.rule-card-header div {
  min-width: 0;
}

.rule-card-header strong,
.rule-card-header small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-card-header strong {
  color: var(--admin-text);
  font-size: 14px;
}

.rule-card-header small,
.rule-meta span {
  color: var(--admin-muted);
  font-size: 12px;
}

.rule-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rule-meta span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
}

.rule-card code {
  display: block;
  overflow: hidden;
  padding: 8px 9px;
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.rule-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 72px;
  padding: 14px;
  border: 1px dashed var(--admin-border);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
  color: var(--admin-muted);
}

.rule-empty strong {
  color: var(--admin-text);
}

.inline-retry {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #b91c1c;
  font-weight: 700;
  cursor: pointer;
}

.account-filter { width: 250px; }
.status-filter { width: 154px; }
.search-input { width: 250px; }

.message-table {
  overflow: hidden;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-md);
}

:deep(.new-message-row td.el-table__cell) {
  background: #ecfdf5 !important;
  animation: newRow 1.1s ease-out;
}

.empty-state {
  display: grid;
  justify-items: center;
  padding: 44px 20px 50px;
  text-align: center;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 13px;
  border: 1px solid #ccfbf1;
  border-radius: 14px;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 22px;
}

.empty-state strong {
  color: var(--admin-text);
  font-size: 15px;
}

.empty-state p {
  max-width: 460px;
  margin: 7px 0 15px;
  color: var(--admin-muted-light);
  line-height: 1.65;
}

.mailbox-cell,
.time-cell {
  display: grid;
  gap: 2px;
}

.mailbox-cell span,
.time-cell small {
  color: var(--admin-muted);
  font-size: 12px;
}

.mailbox-cell em {
  color: #0f766e;
  font-size: 10px;
  font-style: normal;
}

.time-cell strong {
  color: var(--admin-text-soft);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.status-pill {
  display: inline-flex;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-pill.matched {
  background: #ccfbf1;
  color: #0f766e;
}

.status-pill.unmatched {
  background: #fef3c7;
  color: #92400e;
}

.code-button {
  padding: 5px 10px;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  background: #f0fdfa;
  color: #0f766e;
  font: 800 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}

.code-button:hover {
  border-color: #14b8a6;
  background: #ccfbf1;
}

.code-button:focus-visible,
.detail-close:focus-visible {
  outline: 3px solid rgba(14, 165, 233, 0.24);
  outline-offset: 2px;
}

.no-code {
  color: #94a3b8;
  font-size: 12px;
}

.message-detail {
  position: relative;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 24px;
  padding: 24px;
  border-top: 1px solid rgba(0, 122, 255, 0.14);
  background:
    radial-gradient(circle at 8% 10%, rgba(14, 165, 164, 0.12), transparent 28%),
    linear-gradient(135deg, #f8fbff, #fff);
}

.detail-close {
  position: absolute;
  top: 14px;
  right: 16px;
  padding: 5px 10px;
  border: 1px solid var(--admin-border-soft);
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
}

.code-stage {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 170px;
  padding: 22px;
  border-radius: var(--admin-radius-xl);
  background: #0f766e;
  color: #fff;
  box-shadow: 0 16px 38px rgba(15, 118, 110, 0.2);
}

.code-stage.empty {
  background: #475569;
}

.code-stage span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  opacity: 0.7;
}

.code-stage strong {
  margin: 12px 0 18px;
  font: 800 30px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.12em;
}

.code-stage button {
  align-self: flex-start;
  padding: 7px 11px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.detail-content {
  min-width: 0;
  padding-right: 34px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.detail-title span {
  padding: 4px 9px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 700;
}

.detail-content dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 14px;
}

.detail-content dl div,
.preview {
  padding: 11px 12px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-md);
  background: rgba(255, 255, 255, 0.82);
}

.detail-content dt,
.preview span {
  margin-bottom: 4px;
  color: var(--admin-muted-light);
  font-size: 11px;
  font-weight: 700;
}

.detail-content dd {
  margin: 0;
  color: var(--admin-text-soft);
  word-break: break-all;
}

.preview p {
  margin: 6px 0 0;
  color: var(--admin-muted);
  line-height: 1.65;
}

.rule-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-help {
  display: block;
  margin-top: 5px;
  color: #94a3b8;
  font-size: 11px;
}

.rule-test-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rule-test-row .el-switch {
  margin-left: auto;
}

.rule-test-result {
  color: #b45309;
  font-size: 13px;
  font-weight: 700;
}

.rule-test-result.success {
  color: #0f766e;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #64748b;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.48; }
}

@keyframes newRow {
  from { opacity: 0.35; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 1180px) {
  .monitor-toolbar,
  .control-panel,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .monitor-metrics {
    margin-left: 0;
  }

  .filters,
  .actions,
  .rule-empty {
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .filters,
  .actions,
  .monitor-links {
    width: 100%;
    flex-wrap: wrap;
  }

  .account-filter,
  .status-filter,
  .search-input {
    width: 100%;
  }

  .message-detail {
    grid-template-columns: 1fr;
  }

  .detail-content dl,
  .rule-form-grid {
    grid-template-columns: 1fr;
  }

  .pagination {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
}
</style>

