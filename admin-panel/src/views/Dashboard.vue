<template>
  <div class="dashboard">
    <section class="hero-panel">
      <div>
        <span class="eyebrow">COLLECTION COMMAND CENTER</span>
        <h2>采集运行总览</h2>
        <p>集中观察二维码采集、邮箱验证码监听、客户端身份和规则配置状态。</p>
      </div>
      <div class="hero-status">
        <span class="status-dot" :class="{ warning: todoCount > 0 }"></span>
        <div>
          <strong>{{ todoCount > 0 ? `${todoCount} 项需要处理` : '系统暂无待办' }}</strong>
          <small>{{ nowText }}</small>
        </div>
      </div>
    </section>

    <section class="metric-grid">
      <router-link
        v-for="metric in metrics"
        :key="metric.key"
        class="metric-card"
        :class="metric.tone"
        :to="metric.to"
      >
        <span class="metric-label">{{ metric.label }}</span>
        <strong>{{ metric.value }}</strong>
        <small>{{ metric.hint }}</small>
      </router-link>
    </section>

    <section class="dashboard-grid">
      <article class="panel trend-panel">
        <div class="panel-header">
          <div>
            <span>趋势</span>
            <h3>二维码采集趋势</h3>
          </div>
          <div class="range-switch">
            <button
              v-for="item in rangeOptions"
              :key="item.value"
              type="button"
              :class="{ active: timeRange === item.value }"
              @click="setTimeRange(item.value)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <div ref="chartRef" class="chart-container"></div>
      </article>

      <aside class="panel todo-panel">
        <div class="panel-header">
          <div>
            <span>待办</span>
            <h3>需要管理员确认</h3>
          </div>
        </div>
        <div class="todo-list">
          <router-link v-for="item in todoItems" :key="item.key" class="todo-item" :to="item.to">
            <span class="todo-count">{{ item.count }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <small>{{ item.desc }}</small>
            </div>
          </router-link>
        </div>
      </aside>
    </section>

    <section class="lower-grid">
      <article class="panel health-panel">
        <div class="panel-header">
          <div>
            <span>配置健康</span>
            <h3>采集链路状态</h3>
          </div>
        </div>
        <div class="health-list">
          <router-link v-for="item in healthItems" :key="item.key" class="health-item" :to="item.to">
            <span class="health-dot" :class="item.status"></span>
            <div>
              <strong>{{ item.title }}</strong>
              <small>{{ item.desc }}</small>
            </div>
            <em>{{ item.value }}</em>
          </router-link>
        </div>
      </article>

      <article class="panel recent-panel">
        <div class="panel-header">
          <div>
            <span>最近产出</span>
            <h3>最新二维码记录</h3>
          </div>
          <router-link class="panel-link" to="/qrcodes">查看全部</router-link>
        </div>
        <div v-if="recentQrcodes.length" class="recent-list">
          <router-link v-for="item in recentQrcodes" :key="item.id" class="recent-item" to="/qrcodes">
            <span>#{{ item.id }}</span>
            <div>
              <strong>{{ item.client_ip_address || item.username || '未知来源' }}</strong>
              <small>{{ item.source_page_title || item.source_url || '未记录页面' }}</small>
            </div>
            <time>{{ formatRelative(item.created_at) }}</time>
          </router-link>
        </div>
        <div v-else class="empty-state">
          暂无二维码记录。普通用户命中授权目标后会自动出现在这里。
        </div>
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as echarts from 'echarts'
import dayjs from 'dayjs'
import { clientAuthApi, collectionApi, emailPoolApi, qrcodeApi } from '@/api'

const qrcodeStats = reactive({
  todayCount: 0,
  weekCount: 0,
  totalCount: 0
})

const emailStats = reactive({
  enabledAccounts: 0,
  enabledRules: 0,
  totalMessages: 0,
  matchedMessages: 0,
  todayMessages: 0
})

const sites = ref([])
const drafts = ref([])
const authorizations = ref([])
const recentQrcodes = ref([])
const chartRef = ref(null)
const timeRange = ref('week')
const nowText = ref(dayjs().format('YYYY-MM-DD HH:mm'))
let chart = null
let resizeHandler = null

const rangeOptions = [
  { value: 'week', label: '7 天' },
  { value: 'month', label: '30 天' },
  { value: 'year', label: '12 月' }
]

const pendingAuthorizations = computed(() => {
  return authorizations.value.filter(item => item.status === 'pending').length
})

const approvedUsers = computed(() => {
  return authorizations.value.filter(item => item.status === 'approved' && item.role === 'user').length
})

const approvedLeaders = computed(() => {
  return authorizations.value.filter(item => item.status === 'approved' && item.role === 'leader').length
})

const enabledSites = computed(() => {
  return sites.value.filter(item => item.enabled).length
})

const qrcodeTargetCount = computed(() => {
  return sites.value.reduce((sum, site) => sum + Number(site.target_count || 0), 0)
})

const hiddenRuleCount = computed(() => {
  return sites.value.reduce((sum, site) => sum + Number(site.hidden_rule_count || 0), 0)
})

const emailRuleCount = computed(() => {
  return sites.value.reduce((sum, site) => sum + Number(site.email_rule_count || 0), 0)
})

const emailSuccessRate = computed(() => {
  if (!emailStats.totalMessages) return '0%'
  return `${Math.round((emailStats.matchedMessages / emailStats.totalMessages) * 100)}%`
})

const todoCount = computed(() => drafts.value.length + pendingAuthorizations.value)

const metrics = computed(() => [
  {
    key: 'qrcode-today',
    label: '今日二维码',
    value: qrcodeStats.todayCount,
    hint: `本周 ${qrcodeStats.weekCount} 条 · 总计 ${qrcodeStats.totalCount} 条`,
    tone: 'blue',
    to: '/qrcodes'
  },
  {
    key: 'email-today',
    label: '今日验证码',
    value: emailStats.todayMessages,
    hint: `成功解析 ${emailStats.matchedMessages} 条 · 解析率 ${emailSuccessRate.value}`,
    tone: 'teal',
    to: '/email-monitor'
  },
  {
    key: 'clients',
    label: '授权客户端',
    value: approvedUsers.value + approvedLeaders.value,
    hint: `${approvedLeaders.value} 个组长 · ${approvedUsers.value} 个普通用户`,
    tone: 'amber',
    to: '/client-authorizations'
  },
  {
    key: 'rules',
    label: '启用站点',
    value: enabledSites.value,
    hint: `${qrcodeTargetCount.value} 个二维码目标 · ${emailRuleCount.value} 个验证码规则`,
    tone: 'slate',
    to: '/collection-rules/qrcode'
  }
])

const todoItems = computed(() => [
  {
    key: 'drafts',
    count: drafts.value.length,
    title: '待确认采集草稿',
    desc: '插件采集后的二维码、验证码或隐藏元素规则',
    to: '/collection-rules/qrcode'
  },
  {
    key: 'pending-clients',
    count: pendingAuthorizations.value,
    title: '待审核客户端身份',
    desc: '新 IP 需要批准为组长或普通用户',
    to: '/client-authorizations'
  }
])

const healthItems = computed(() => [
  {
    key: 'email-accounts',
    title: '邮箱池',
    desc: '可用于监听验证码的启用邮箱账号',
    value: `${emailStats.enabledAccounts} 个`,
    status: emailStats.enabledAccounts > 0 ? 'ok' : 'warning',
    to: '/email-pool'
  },
  {
    key: 'monitor-rules',
    title: '邮件白名单',
    desc: '限制只读取授权发件人与主题',
    value: `${emailStats.enabledRules} 条`,
    status: emailStats.enabledRules > 0 ? 'ok' : 'warning',
    to: '/email-monitor'
  },
  {
    key: 'qrcode-rules',
    title: '二维码目标',
    desc: '普通用户自动上传依赖的页面目标',
    value: `${qrcodeTargetCount.value} 个`,
    status: qrcodeTargetCount.value > 0 ? 'ok' : 'warning',
    to: '/collection-rules/qrcode'
  },
  {
    key: 'hidden-rules',
    title: '隐藏元素',
    desc: '客户端页面遮挡或移除规则',
    value: `${hiddenRuleCount.value} 条`,
    status: hiddenRuleCount.value > 0 ? 'ok' : 'idle',
    to: '/collection-rules/hidden'
  }
])

const fetchOverview = async () => {
  const [
    qrcodeStatsResponse,
    emailStatsResponse,
    sitesResponse,
    draftsResponse,
    authorizationsResponse,
    recentResponse
  ] = await Promise.all([
    qrcodeApi.getStats(),
    emailPoolApi.getMonitorStats(),
    collectionApi.getSites(),
    collectionApi.getDrafts({ status: 'pending' }),
    clientAuthApi.getAuthorizations({}),
    qrcodeApi.getList({ page: 1, limit: 5 })
  ])

  Object.assign(qrcodeStats, qrcodeStatsResponse)
  Object.assign(emailStats, emailStatsResponse)
  sites.value = sitesResponse.sites || []
  drafts.value = draftsResponse.drafts || []
  authorizations.value = authorizationsResponse.authorizations || []
  recentQrcodes.value = recentResponse.qrcodes || []
}

const setTimeRange = async value => {
  timeRange.value = value
  await fetchChartData()
}

const buildChartBuckets = () => {
  const endDate = dayjs()
  const startDate = timeRange.value === 'week'
    ? endDate.subtract(6, 'day')
    : timeRange.value === 'month'
      ? endDate.subtract(29, 'day')
      : endDate.subtract(11, 'month')

  const unit = timeRange.value === 'year' ? 'month' : 'day'
  const keyFormat = timeRange.value === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD'
  const labelFormat = timeRange.value === 'year' ? 'YYYY-MM' : 'MM-DD'
  const keys = []
  const labels = []
  let current = startDate

  while (current.isBefore(endDate) || current.isSame(endDate, unit)) {
    keys.push(current.format(keyFormat))
    labels.push(current.format(labelFormat))
    current = current.add(1, unit)
  }

  return { startDate, endDate, unit, keyFormat, keys, labels }
}

const fetchChartData = async () => {
  if (!chart) return
  const { startDate, endDate, keyFormat, keys, labels } = buildChartBuckets()
  const response = await qrcodeApi.getList({
    start_date: startDate.format('YYYY-MM-DD'),
    end_date: endDate.format('YYYY-MM-DD'),
    limit: 100
  })
  const grouped = {}
  ;(response.qrcodes || []).forEach(item => {
    const key = parseServerDate(item.created_at).format(keyFormat)
    grouped[key] = (grouped[key] || 0) + 1
  })
  const values = keys.map(key => grouped[key] || 0)

  chart.setOption({
    grid: { top: 24, right: 20, bottom: 30, left: 34 },
    tooltip: {
      trigger: 'axis',
      formatter: params => {
        const item = params[0]
        return `${item.axisValue}<br/>二维码：${item.value} 条`
      }
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
      axisLabel: { color: '#94a3b8' }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#eef2f7' } },
      axisLabel: { color: '#94a3b8' }
    },
    series: [
      {
        name: '二维码',
        type: 'line',
        data: values,
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3, color: '#007aff' },
        itemStyle: { color: '#007aff' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(0, 122, 255, 0.18)' },
            { offset: 1, color: 'rgba(0, 122, 255, 0.01)' }
          ])
        }
      }
    ]
  })
}

const parseServerDate = date => {
  if (!date) return dayjs()
  const value = String(date)
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  return dayjs(hasTimezone ? value : `${value.replace(' ', 'T')}Z`)
}

const formatRelative = date => {
  if (!date) return '-'
  const seconds = Math.max(0, dayjs().diff(parseServerDate(date), 'second'))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

onMounted(async () => {
  await fetchOverview()
  await nextTick()
  chart = echarts.init(chartRef.value)
  resizeHandler = () => chart?.resize()
  window.addEventListener('resize', resizeHandler)
  await fetchChartData()
})

onBeforeUnmount(() => {
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  chart?.dispose()
})
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1540px;
  margin: 0 auto;
}

.hero-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  min-height: 156px;
  padding: 28px;
  overflow: hidden;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background:
    radial-gradient(circle at 12% 20%, rgba(0, 122, 255, 0.14), transparent 32%),
    radial-gradient(circle at 78% 10%, rgba(20, 184, 166, 0.12), transparent 30%),
    linear-gradient(135deg, #ffffff 0%, #f8fbff 100%);
  box-shadow: var(--admin-shadow-md);
}

.eyebrow {
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.hero-panel h2 {
  margin: 8px 0 8px;
  color: var(--admin-text);
  font-size: 32px;
  letter-spacing: -0.04em;
}

.hero-panel p {
  max-width: 640px;
  margin: 0;
  color: var(--admin-muted);
  line-height: 1.7;
}

.hero-status {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 230px;
  padding: 14px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: rgba(255, 255, 255, 0.82);
}

.status-dot,
.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 0 6px rgba(20, 184, 166, 0.12);
}

.status-dot.warning,
.health-dot.warning {
  background: #f59e0b;
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.13);
}

.health-dot.idle {
  background: #94a3b8;
  box-shadow: none;
}

.hero-status strong,
.hero-status small {
  display: block;
}

.hero-status small {
  margin-top: 3px;
  color: var(--admin-muted-light);
  font-size: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.metric-card {
  display: grid;
  gap: 8px;
  min-height: 142px;
  padding: 18px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background: var(--admin-surface);
  color: inherit;
  text-decoration: none;
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.08);
}

.metric-label,
.panel-header span {
  color: var(--admin-muted-light);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.metric-card strong {
  color: var(--admin-text);
  font-size: 34px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.metric-card small {
  color: var(--admin-muted);
  line-height: 1.5;
}

.metric-card.blue { border-top: 3px solid var(--admin-primary); }
.metric-card.teal { border-top: 3px solid var(--admin-success); }
.metric-card.amber { border-top: 3px solid var(--admin-warning); }
.metric-card.slate { border-top: 3px solid var(--admin-muted); }

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
}

.lower-grid {
  display: grid;
  grid-template-columns: 0.88fr 1.12fr;
  gap: 18px;
}

.panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-md);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.panel-header h3 {
  margin: 4px 0 0;
  color: var(--admin-text);
  font-size: 17px;
}

.panel-link {
  color: var(--admin-primary);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.range-switch {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: #f1f5f9;
}

.range-switch button {
  padding: 6px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--admin-muted);
  cursor: pointer;
  font-weight: 700;
}

.range-switch button.active {
  background: #fff;
  color: var(--admin-primary);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
}

.chart-container {
  width: 100%;
  height: 330px;
}

.todo-list,
.health-list,
.recent-list {
  display: grid;
  gap: 10px;
}

.todo-item,
.health-item,
.recent-item {
  display: grid;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
  color: inherit;
  text-decoration: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.todo-item:hover,
.health-item:hover,
.recent-item:hover {
  border-color: #bfdbfe;
  background: #fff;
}

.todo-item {
  grid-template-columns: 48px minmax(0, 1fr);
}

.todo-count {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: #eff6ff;
  color: var(--admin-primary);
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.todo-item strong,
.health-item strong,
.recent-item strong {
  display: block;
  color: var(--admin-text);
}

.todo-item small,
.health-item small,
.recent-item small {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-item {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.health-item em {
  color: var(--admin-muted);
  font-style: normal;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.recent-item {
  grid-template-columns: 52px minmax(0, 1fr) auto;
}

.recent-item > span {
  color: var(--admin-primary);
  font-weight: 800;
}

.recent-item time {
  color: var(--admin-muted-light);
  font-size: 12px;
}

.empty-state {
  padding: 32px 18px;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  color: var(--admin-muted);
  text-align: center;
}

@media (max-width: 1280px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-grid,
  .lower-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .panel-header {
    align-items: stretch;
    flex-direction: column;
  }

  .recent-item {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .recent-item time {
    grid-column: 2;
  }
}
</style>
