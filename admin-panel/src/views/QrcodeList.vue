<template>
  <div class="qrcode-list">
    <!-- 筛选区域 -->
    <div class="filter-section">
      <div class="filter-row">
        <div class="filter-item">
          <label>日期范围</label>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            @change="handleFilterChange"
          />
        </div>
        <div class="filter-item">
          <label>来源URL</label>
          <input
            v-model="filterForm.sourceUrl"
            placeholder="输入来源URL"
            class="filter-input"
            @change="handleFilterChange"
          />
        </div>
        <div class="filter-item">
          <label>关键词</label>
          <input
            v-model="filterForm.keyword"
            placeholder="搜索内容"
            class="filter-input"
            @change="handleFilterChange"
          />
        </div>
        <button class="btn btn-secondary" @click="handleReset">重置</button>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="btn btn-primary" @click="fetchData" :disabled="loading">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6"/>
            <path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
            <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
          </svg>
          刷新
        </button>
        <div class="toggle-group">
          <button 
            class="toggle-btn" 
            :class="{ active: autoRefresh }"
            @click="toggleAutoRefresh"
          >
            <span class="toggle-indicator"></span>
            自动刷新
          </button>
        </div>
        <button 
          class="btn btn-danger" 
          @click="handleBatchDelete" 
          :disabled="selectedIds.length === 0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          批量删除 ({{ selectedIds.length }})
        </button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-success" @click="handleExport('csv')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          CSV
        </button>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-checkbox">
              <input 
                type="checkbox" 
                :checked="isAllSelected"
                @change="toggleSelectAll"
              />
            </th>
            <th class="col-id">ID</th>
            <th class="col-user">用户名</th>
            <th class="col-leader">归属组长</th>
            <th class="col-qr">二维码</th>
            <th class="col-content">内容</th>
            <th class="col-source">来源URL</th>
            <th class="col-policy">采集规则</th>
            <th class="col-mode">方式</th>
            <th class="col-time">收集时间</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && tableData.length === 0">
            <td colspan="11" class="loading-cell">
              <div class="loading-spinner"></div>
              加载中...
            </td>
          </tr>
          <tr v-else-if="tableData.length === 0">
            <td colspan="11" class="empty-cell">
              暂无数据
            </td>
          </tr>
          <template v-for="row in tableData" :key="row.id">
            <tr
              class="data-row"
              :class="{ selected: selectedIds.includes(row.id), focused: focusedRowId === row.id }"
              tabindex="0"
              :aria-expanded="focusedRowId === row.id"
              @click="setFocusedRow(row.id)"
              @focus="setFocusedRow(row.id)"
              @keydown.enter.prevent="setFocusedRow(row.id)"
            >
              <td class="col-checkbox">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(row.id)"
                  @click.stop
                  @change="toggleSelect(row.id)"
                />
              </td>
              <td class="col-id">{{ row.id }}</td>
              <td class="col-user">{{ row.sourceUserName }}</td>
              <td class="col-leader">{{ row.leaderName }}</td>
              <td class="col-qr">
                <div class="qr-thumb" v-if="row.imageUrl">
                  <img :src="row.imageUrl" alt="QR" />
                </div>
                <span v-else class="no-image">无</span>
              </td>
              <td class="col-content" :title="row.content">
                {{ truncateText(row.content, 40) }}
              </td>
              <td class="col-source" :title="row.sourceUrl">
                <a :href="row.sourceUrl" target="_blank" class="source-link" @click.stop>
                  {{ truncateText(row.sourceUrl, 30) }}
                </a>
              </td>
              <td class="col-policy">
                <div>{{ row.siteName || '-' }}</div>
                <div class="policy-target">{{ row.targetName || '-' }}</div>
              </td>
              <td class="col-mode">
                <span class="mode-pill" :class="row.uploadMode">{{ row.uploadModeLabel }}</span>
              </td>
              <td class="col-time">{{ formatDate(row.createdAt) }}</td>
              <td class="col-actions">
                <button class="action-btn delete" @click.stop="handleDelete(row)">删除</button>
              </td>
            </tr>
            <tr v-if="focusedRowId === row.id" class="detail-row">
              <td colspan="11">
                <div class="inline-detail">
                  <button class="detail-close" @click.stop="focusedRowId = null">收起</button>
                  <div class="detail-qr-panel">
                    <button
                      v-if="row.imageUrl"
                      class="qr-large"
                      title="点击放大二维码"
                      @click.stop="previewImage(row.imageUrl)"
                    >
                      <img :src="row.imageUrl" alt="QR Code" />
                    </button>
                    <div v-else class="qr-large empty">无二维码图片</div>
                    <div class="scan-hint">管理员可直接在此扫码，点击二维码可放大预览</div>
                  </div>
                  <div class="detail-info-panel">
                    <div class="detail-title">
                      <span class="record-pill">#{{ row.id }}</span>
                      <strong>{{ row.sourceUserName }}</strong>
                      <span>{{ formatDate(row.createdAt) }}</span>
                    </div>
                    <div class="detail-grid">
                      <div class="detail-field wide">
                        <label>二维码内容</label>
                        <div class="detail-value content-value">{{ row.content || '-' }}</div>
                        <button class="mini-action" @click.stop="copyText(row.content)">复制内容</button>
                      </div>
                      <div class="detail-field">
                        <label>采集站点</label>
                        <div class="detail-value">{{ row.siteName || '-' }}</div>
                      </div>
                      <div class="detail-field">
                        <label>目标规则</label>
                        <div class="detail-value">{{ row.targetName || '-' }}</div>
                      </div>
                      <div class="detail-field">
                        <label>来源普通用户</label>
                        <div class="detail-value">{{ row.clientName }}</div>
                      </div>
                      <div class="detail-field">
                        <label>归属组长</label>
                        <div class="detail-value">{{ row.leaderName }}</div>
                      </div>
                      <div class="detail-field">
                        <label>实际上传者</label>
                        <div class="detail-value">{{ row.uploadedByName }}</div>
                      </div>
                      <div class="detail-field">
                        <label>上传方式</label>
                        <div class="detail-value">{{ row.uploadModeLabel }}</div>
                      </div>
                      <div class="detail-field wide">
                        <label>来源 URL</label>
                        <a class="detail-value source-full" :href="row.sourceUrl" target="_blank" @click.stop>
                          {{ row.sourceUrl || '-' }}
                        </a>
                        <button class="mini-action" @click.stop="copyText(row.sourceUrl)">复制 URL</button>
                      </div>
                      <div class="detail-field wide" v-if="row.sourcePageTitle">
                        <label>来源页面标题</label>
                        <div class="detail-value">{{ row.sourcePageTitle }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="pagination">
      <div class="pagination-info">
        共 {{ pagination.total }} 条记录
      </div>
      <div class="pagination-controls">
        <select v-model="pagination.pageSize" @change="handleSizeChange" class="page-size-select">
          <option :value="10">10条/页</option>
          <option :value="20">20条/页</option>
          <option :value="50">50条/页</option>
          <option :value="100">100条/页</option>
        </select>
        <button 
          class="page-btn" 
          :disabled="pagination.page === 1"
          @click="goToPage(pagination.page - 1)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span class="page-indicator">
          {{ pagination.page }} / {{ totalPages }}
        </span>
        <button 
          class="page-btn" 
          :disabled="pagination.page >= totalPages"
          @click="goToPage(pagination.page + 1)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 图片预览 -->
    <div v-if="previewVisible" class="image-preview-overlay" @click="previewVisible = false">
      <div class="image-preview-content" @click.stop>
        <button class="preview-close" @click="previewVisible = false">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <img :src="previewImageUrl" alt="Preview" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { qrcodeApi } from '@/api'
import { loadProtectedImageUrl, revokeProtectedImageUrl, revokeProtectedImageUrls } from '@/utils/protectedImage'
import dayjs from 'dayjs'

const loading = ref(false)
const tableData = ref([])
const selectedIds = ref([])
const dateRange = ref([])
const autoRefresh = ref(false)
const previewVisible = ref(false)
const previewImageUrl = ref('')
const focusedRowId = ref(null)
let autoRefreshTimer = null
let activeImageUrls = []

const filterForm = reactive({
  sourceUrl: '',
  keyword: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const totalPages = computed(() => Math.ceil(pagination.total / pagination.pageSize) || 1)

const isAllSelected = computed(() => {
  return tableData.value.length > 0 && selectedIds.value.length === tableData.value.length
})

const roleLabel = (role) => {
  if (role === 'leader') return '组长'
  if (role === 'user') return '普通用户'
  return ''
}

const authorizationName = (ip, role, fallback = '-') => {
  if (!ip) return fallback
  const label = roleLabel(role)
  return label ? `${label} ${ip}` : ip
}

const uploadModeLabel = (mode) => {
  if (mode === 'auto') return '自动上传'
  if (mode === 'leader_assisted') return '组长代扫'
  return '手动上传'
}

const toggleAutoRefresh = () => {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    autoRefreshTimer = setInterval(() => fetchData(), 5000)
    ElMessage.success('已开启自动刷新（每5秒）')
  } else {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    ElMessage.info('已关闭自动刷新')
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      limit: pagination.pageSize
    }

    if (filterForm.sourceUrl) params.source_url = filterForm.sourceUrl
    if (filterForm.keyword) params.search = filterForm.keyword
    if (dateRange.value?.length === 2) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }

    const response = await qrcodeApi.getList(params)

    revokeProtectedImageUrls(activeImageUrls)
    activeImageUrls = []

    tableData.value = await Promise.all((response.qrcodes || []).map(async qr => {
      const mode = qr.upload_mode || 'manual'
      const clientName = authorizationName(qr.client_ip_address, qr.client_role, qr.creator_name || '未知')
      const uploadedByName = qr.creator_name || authorizationName(qr.uploaded_by_ip_address, qr.uploaded_by_role, '-')
      let imageUrl = null
      if (qr.image_path) {
        try {
          imageUrl = await loadProtectedImageUrl(qr.image_path)
          if (imageUrl) activeImageUrls.push(imageUrl)
        } catch (error) {
          console.error('Failed to load protected QR image:', error)
        }
      }
      return {
        id: qr.id,
        content: qr.content,
        imageUrl,
        imagePath: qr.image_path || null,
        sourceUrl: qr.source_url,
        sourcePageTitle: qr.source_page_title,
        siteName: qr.site_name,
        targetName: qr.target_name,
        creatorName: qr.creator_name || clientName,
        sourceUserName: clientName,
        clientName,
        leaderName: authorizationName(qr.leader_ip_address, qr.leader_role),
        uploadedByName,
        uploadMode: mode,
        uploadModeLabel: uploadModeLabel(mode),
        createdAt: qr.updated_at || qr.created_at
      }
    }))

    if (focusedRowId.value && !tableData.value.some(row => row.id === focusedRowId.value)) {
      focusedRowId.value = tableData.value[0]?.id || null
    }

    pagination.total = response.pagination?.total || 0
  } catch (error) {
    console.error('Failed to fetch data:', error)
    ElMessage.error('加载数据失败')
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer)
  revokeProtectedImageUrls(activeImageUrls)
  activeImageUrls = []
  revokeProtectedImageUrl(previewImageUrl.value)
})

const handleFilterChange = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  filterForm.sourceUrl = ''
  filterForm.keyword = ''
  dateRange.value = []
  pagination.page = 1
  fetchData()
}

const toggleSelect = (id) => {
  const index = selectedIds.value.indexOf(id)
  if (index > -1) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = tableData.value.map(item => item.id)
  }
}

const handleSizeChange = () => {
  pagination.page = 1
  fetchData()
}

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return
  pagination.page = page
  focusedRowId.value = null
  fetchData()
}

const setFocusedRow = (id) => {
  focusedRowId.value = id
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除这条记录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await qrcodeApi.delete(row.id)
    ElMessage.success('删除成功')
    if (focusedRowId.value === row.id) focusedRowId.value = null
    fetchData()
  } catch (error) {
    if (error !== 'cancel') console.error('Delete failed:', error)
  }
}

const handleBatchDelete = async () => {
  if (selectedIds.value.length === 0) return
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedIds.value.length} 条记录吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await qrcodeApi.batchDelete(selectedIds.value)
    ElMessage.success('批量删除成功')
    if (selectedIds.value.includes(focusedRowId.value)) focusedRowId.value = null
    selectedIds.value = []
    fetchData()
  } catch (error) {
    if (error !== 'cancel') console.error('Batch delete failed:', error)
  }
}

const handleExport = async (type) => {
  try {
    ElMessage.info(`正在导出 ${type.toUpperCase()} 文件...`)
    const params = { ...filterForm }
    if (dateRange.value?.length === 2) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }
    const response = await qrcodeApi.export({ ...params, format: type })
    const blob = new Blob([response], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `qrcodes_${dayjs().format('YYYY-MM-DD')}.csv`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('Export failed:', error)
    ElMessage.error('导出失败')
  }
}

const previewImage = (url) => {
  previewImageUrl.value = url
  previewVisible.value = true
}

const copyText = async (text) => {
  if (!text) {
    ElMessage.warning('暂无可复制内容')
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch (error) {
    console.error('Copy failed:', error)
    ElMessage.error('复制失败')
  }
}

const formatDate = (date) => {
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
}

const truncateText = (text, maxLength) => {
  if (!text) return '-'
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.qrcode-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* 筛选区域 */
.filter-section {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  padding: 20px;
  box-shadow: var(--admin-shadow-md);
}

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-item label {
  font-size: 12px;
  color: var(--admin-muted);
  font-weight: 650;
}

.filter-input {
  padding: 8px 12px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  font-size: 13px;
  width: 180px;
  background: #fff;
  transition: border-color var(--admin-transition), box-shadow var(--admin-transition);
}

.filter-input:focus {
  outline: none;
  border-color: var(--admin-primary);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
}

/* 按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 8px 15px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-sm);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background var(--admin-transition), border-color var(--admin-transition), color var(--admin-transition), box-shadow var(--admin-transition);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--admin-primary);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--admin-primary-dark);
  box-shadow: 0 10px 20px rgba(0, 122, 255, 0.16);
}

.btn-secondary {
  background: #fff;
  border-color: var(--admin-border-soft);
  color: var(--admin-text-soft);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--admin-bg-soft);
  border-color: rgba(0, 122, 255, 0.2);
}

.btn-danger {
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
}

.btn-danger:hover:not(:disabled) {
  background: rgba(255, 59, 48, 0.15);
}

.btn-success {
  background: var(--admin-success-soft);
  color: #0f766e;
}

.btn-success:hover:not(:disabled) {
  background: rgba(52, 199, 89, 0.15);
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

.toggle-group {
  display: flex;
  align-items: center;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  background: #fff;
  font-size: 13px;
  color: var(--admin-muted);
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-btn.active {
  background: rgba(0, 122, 255, 0.1);
  border-color: var(--admin-primary);
  color: var(--admin-primary);
}

.toggle-indicator {
  width: 32px;
  height: 18px;
  background: #e0e0e0;
  border-radius: 9px;
  position: relative;
  transition: all 0.2s ease;
}

.toggle-indicator::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.toggle-btn.active .toggle-indicator {
  background: var(--admin-primary);
}

.toggle-btn.active .toggle-indicator::after {
  left: 16px;
}

/* 表格 */
.table-container {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  overflow: hidden;
  box-shadow: var(--admin-shadow-md);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  background: #f8fafc;
  padding: 12px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  color: var(--admin-muted);
  border-bottom: 1px solid var(--admin-border-soft);
}

.data-table td {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--admin-text-soft);
  border-bottom: 1px solid var(--admin-border-soft);
}

.data-row {
  cursor: pointer;
  transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.data-row:focus {
  outline: none;
}

.data-row:hover {
  background: #f8fbff;
}

.data-row.selected {
  background: rgba(0, 122, 255, 0.05);
}

.data-row.focused {
  background: linear-gradient(90deg, rgba(0, 122, 255, 0.12), rgba(52, 199, 89, 0.06));
  box-shadow: inset 3px 0 0 var(--admin-primary);
}

.col-checkbox { width: 48px; }
.col-id { width: 60px; }
.col-user { width: 140px; }
.col-leader { width: 130px; }
.col-qr { width: 80px; }
.col-time { width: 140px; }
.col-policy { width: 150px; }
.col-mode { width: 96px; }
.col-actions { width: 80px; }

.qr-thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--admin-radius-sm);
  overflow: hidden;
  background: #f8fafc;
  border: 1px solid var(--admin-border-soft);
  transition: transform 0.2s ease;
}

.qr-thumb:hover {
  transform: scale(1.1);
}

.qr-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.no-image {
  color: var(--admin-muted-light);
  font-size: 12px;
}

.source-link {
  color: var(--admin-primary);
  text-decoration: none;
}

.source-link:hover {
  text-decoration: underline;
}

.policy-target {
  color: var(--admin-muted);
  font-size: 12px;
  margin-top: 2px;
}

.mode-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: #475569;
  font-size: 12px;
  white-space: nowrap;
}

.mode-pill.auto {
  background: rgba(52, 199, 89, 0.12);
  color: #1f7a3b;
}

.mode-pill.leader_assisted {
  background: rgba(255, 149, 0, 0.14);
  color: #9a5a00;
}

.detail-row td {
  padding: 0;
  background:
    radial-gradient(circle at 18% 10%, rgba(0, 122, 255, 0.12), transparent 34%),
    linear-gradient(135deg, #f8fbff 0%, #ffffff 44%, #f6fffb 100%);
  border-bottom: 1px solid rgba(0, 122, 255, 0.16);
}

.inline-detail {
  position: relative;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 24px;
  padding: 24px;
  border-top: 1px solid rgba(0, 122, 255, 0.12);
}

.detail-close {
  position: absolute;
  top: 16px;
  right: 18px;
  padding: 6px 10px;
  border: 1px solid var(--admin-border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
}

.detail-qr-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-large {
  width: 220px;
  height: 220px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: 22px;
  background: #fff;
  box-shadow: var(--admin-shadow-lg);
  cursor: zoom-in;
}

.qr-large img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.qr-large.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: default;
}

.scan-hint {
  max-width: 220px;
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.detail-info-panel {
  min-width: 0;
  padding-right: 36px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: var(--admin-muted);
}

.detail-title strong {
  color: var(--admin-text);
}

.record-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--admin-primary);
  color: #fff;
  font-weight: 700;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.detail-field {
  position: relative;
  padding: 12px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-md);
  background: rgba(255, 255, 255, 0.74);
}

.detail-field.wide {
  grid-column: 1 / -1;
}

.detail-field label {
  display: block;
  margin-bottom: 6px;
  color: var(--admin-muted-light);
  font-size: 12px;
  font-weight: 600;
}

.detail-value {
  color: var(--admin-text);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
}

.content-value {
  padding-right: 82px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.source-full {
  display: block;
  padding-right: 82px;
  color: var(--admin-primary);
  text-decoration: none;
}

.source-full:hover {
  text-decoration: underline;
}

.mini-action {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--admin-radius-sm);
  background: rgba(0, 122, 255, 0.08);
  color: var(--admin-primary);
  font-size: 12px;
  cursor: pointer;
}

.mini-action:hover {
  background: rgba(0, 122, 255, 0.14);
}

.action-btn {
  padding: 5px 9px;
  border: none;
  border-radius: var(--admin-radius-sm);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 4px;
}

.action-btn.delete {
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
}

.action-btn.delete:hover {
  background: rgba(255, 59, 48, 0.15);
}

.loading-cell,
.empty-cell {
  text-align: center;
  padding: 60px 16px;
  color: var(--admin-muted);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e0e0e0;
  border-top-color: var(--admin-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 分页 */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
}

.pagination-info {
  font-size: 13px;
  color: var(--admin-muted);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-size-select {
  padding: 6px 12px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  font-size: 13px;
  background: #fff;
  cursor: pointer;
}

.page-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-sm);
  background: #fff;
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  background: var(--admin-bg-soft);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-indicator {
  font-size: 13px;
  color: var(--admin-text);
  min-width: 60px;
  text-align: center;
}

/* 图片预览 */
.image-preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.image-preview-content {
  max-width: 90vw;
  max-height: 90vh;
  position: relative;
}

.image-preview-content img {
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
}

.preview-close {
  position: absolute;
  top: -40px;
  right: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.preview-close:hover {
  opacity: 1;
}

/* 复选框 */
input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--admin-primary);
}
</style>
