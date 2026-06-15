<template>
  <div class="email-pool">
    <el-card class="table-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>邮箱池账号</span>
            <p>先录入可被后端读取的邮箱授权，后续验证码任务会从这里分配或监听邮箱。</p>
          </div>
          <div class="header-actions">
            <el-button type="primary" :icon="Plus" @click="handleAdd">添加邮箱</el-button>
            <el-button :icon="Refresh" @click="fetchAccounts">刷新</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="page-alert"
        type="info"
        :closable="false"
        show-icon
        title="QQ 邮箱需要在邮箱设置中开启 IMAP/SMTP，并使用授权码，不是 QQ 登录密码。"
      />

      <el-table v-loading="loading" :data="accounts" border stripe>
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="email_address" label="邮箱地址" min-width="190" />
        <el-table-column prop="provider" label="服务商" width="110">
          <template #default="{ row }">{{ providerLabel(row.provider) }}</template>
        </el-table-column>
        <el-table-column label="连接状态" min-width="250">
          <template #default="{ row }">
            <div class="connection-cell">
              <div class="connection-main">
                <span class="health-dot" :class="accountStatusClass(row)"></span>
                <strong>{{ accountStatusText(row) }}</strong>
                <el-tag
                  v-if="row.last_test_status"
                  :type="row.last_test_status === 'success' ? 'success' : 'danger'"
                  size="small"
                  effect="plain"
                >
                  测试{{ row.last_test_status === 'success' ? '成功' : '失败' }}
                </el-tag>
              </div>
              <span>{{ row.protocol?.toUpperCase() || 'IMAP' }} · {{ row.host }}:{{ row.port }} · {{ row.secure ? 'SSL' : '非 SSL' }}</span>
              <small>{{ accountSyncTime(row) }}<template v-if="row.last_test_at"> · 测试 {{ formatDate(row.last_test_at) }}</template></small>
              <small v-if="row.last_test_message">{{ row.last_test_message }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="绑定普通用户" min-width="190">
          <template #default="{ row }">
            <div v-if="row.assigned_user_ip_address" class="assignment-cell">
              <strong>{{ row.assigned_user_ip_address }}</strong>
              <span>组长：{{ row.assigned_leader_ip_address || '未绑定组长' }}</span>
            </div>
            <el-tag v-else type="info" effect="plain">未分配</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="160">
          <template #default="{ row }">{{ row.note || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="340" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openAssignmentDialog(row)">
              {{ row.assignment_id ? '更换绑定' : '分配用户' }}
            </el-button>
            <el-button type="primary" link @click="handleTest(row)">测试</el-button>
            <el-button type="primary" link :icon="Edit" @click="handleEdit(row)">编辑</el-button>
            <el-button :type="row.enabled ? 'warning' : 'success'" link @click="toggleEnabled(row)">
              {{ row.enabled ? '停用' : '启用' }}
            </el-button>
            <el-button type="danger" link :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogType === 'add' ? '添加邮箱账号' : '编辑邮箱账号'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="服务商" prop="provider">
          <el-select v-model="form.provider" @change="applyProviderPreset">
            <el-option label="QQ 邮箱" value="qq" />
            <el-option label="自定义 IMAP" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="例如 QQ 验证码邮箱 1" />
        </el-form-item>
        <el-form-item label="邮箱地址" prop="email_address">
          <el-input v-model="form.email_address" placeholder="example@qq.com" @blur="syncUsernameFromEmail" />
        </el-form-item>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="通常与邮箱地址一致" />
        </el-form-item>
        <el-form-item :label="dialogType === 'add' ? '授权码' : '授权码' " prop="auth_secret">
          <el-input
            v-model="form.auth_secret"
            type="password"
            show-password
            :placeholder="dialogType === 'add' ? '请输入邮箱授权码' : '留空表示不修改已保存授权码'"
          />
        </el-form-item>
        <el-form-item label="IMAP 主机" prop="host">
          <el-input v-model="form.host" placeholder="imap.qq.com" />
        </el-form-item>
        <el-form-item label="端口" prop="port">
          <el-input-number v-model="form.port" :min="1" :max="65535" />
          <el-checkbox v-model="form.secure" class="secure-checkbox">SSL</el-checkbox>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="3" placeholder="可记录用途、账号归属或授权说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :loading="testLoading" @click="testCurrentForm">先测试</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="assignmentDialogVisible" title="分配邮箱给普通用户" width="520px">
      <div v-if="assignmentAccount" class="assignment-summary">
        <span>当前邮箱</span>
        <strong>{{ assignmentAccount.email_address }}</strong>
        <small>授权码和 IMAP 配置只保存在服务端，不会下发到客户端。</small>
      </div>
      <el-form label-width="100px">
        <el-form-item label="普通用户">
          <el-select
            v-model="selectedUserAuthorizationId"
            filterable
            placeholder="选择已授权普通用户"
            style="width: 100%"
          >
            <el-option
              v-for="user in assignmentUsers"
              :key="user.id"
              :label="assignmentUserLabel(user)"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="assignmentAccount?.assignment_id"
          type="danger"
          plain
          :loading="assignmentLoading"
          @click="releaseCurrentAssignment"
        >
          解除绑定
        </el-button>
        <el-button @click="assignmentDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="assignmentLoading"
          :disabled="!selectedUserAuthorizationId"
          @click="saveAssignment"
        >
          确认分配
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { emailPoolApi } from '@/api'
import dayjs from 'dayjs'

const loading = ref(false)
const submitLoading = ref(false)
const testLoading = ref(false)
const accounts = ref([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const currentEditId = ref(null)
const formRef = ref(null)
const assignmentDialogVisible = ref(false)
const assignmentLoading = ref(false)
const assignmentAccount = ref(null)
const assignmentUsers = ref([])
const selectedUserAuthorizationId = ref(null)

const form = reactive({
  provider: 'qq',
  name: '',
  email_address: '',
  protocol: 'imap',
  host: 'imap.qq.com',
  port: 993,
  secure: true,
  username: '',
  auth_secret: '',
  enabled: true,
  note: ''
})

const rules = {
  provider: [{ required: true, message: '请选择服务商', trigger: 'change' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  email_address: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ],
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  host: [{ required: true, message: '请输入 IMAP 主机', trigger: 'blur' }],
  port: [{ required: true, message: '请输入端口', trigger: 'change' }]
}

const providerLabel = (provider) => {
  if (provider === 'qq') return 'QQ 邮箱'
  return '自定义'
}

const accountStatusClass = (account) => {
  if (account.last_sync_status === 'failed') return 'failed'
  if (account.last_sync_status === 'success') return 'healthy'
  return 'waiting'
}

const accountStatusText = (account) => {
  if (account.last_sync_status === 'failed') return '连接异常'
  if (account.last_sync_status === 'success') return '连接正常'
  return '等待检查'
}

const parseServerDate = (date) => {
  if (!date) return null
  const value = String(date)
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  return dayjs(hasTimezone ? value : `${value.replace(' ', 'T')}Z`)
}

const accountSyncTime = (account) => {
  if (!account.last_sync_at) return '尚未同步'
  return parseServerDate(account.last_sync_at).format('MM-DD HH:mm:ss')
}

const applyProviderPreset = () => {
  form.protocol = 'imap'
  if (form.provider === 'qq') {
    form.host = 'imap.qq.com'
    form.port = 993
    form.secure = true
  }
}

const syncUsernameFromEmail = () => {
  if (!form.username && form.email_address) {
    form.username = form.email_address
  }
}

const resetForm = () => {
  form.provider = 'qq'
  form.name = ''
  form.email_address = ''
  form.protocol = 'imap'
  form.host = 'imap.qq.com'
  form.port = 993
  form.secure = true
  form.username = ''
  form.auth_secret = ''
  form.enabled = true
  form.note = ''
}

const buildPayload = (includeEmptySecret = false) => {
  const payload = {
    provider: form.provider,
    name: form.name,
    email_address: form.email_address,
    protocol: form.protocol,
    host: form.host,
    port: form.port,
    secure: form.secure,
    username: form.username,
    enabled: form.enabled,
    note: form.note
  }
  if (includeEmptySecret || form.auth_secret) {
    payload.auth_secret = form.auth_secret
  }
  return payload
}

const fetchAccounts = async () => {
  loading.value = true
  try {
    const response = await emailPoolApi.getAccounts()
    accounts.value = response.accounts || []
  } catch (error) {
    console.error('Failed to fetch email pool accounts:', error)
  } finally {
    loading.value = false
  }
}

const fetchAssignmentOptions = async () => {
  const response = await emailPoolApi.getAssignmentOptions()
  assignmentUsers.value = response.users || []
}

const assignmentUserLabel = (user) => {
  const leader = user.leader_ip_address ? `组长 ${user.leader_ip_address}` : '未绑定组长'
  const current = user.email_address ? `，当前 ${user.email_address}` : ''
  return `${user.ip_address}（${leader}${current}）`
}

const openAssignmentDialog = async (row) => {
  assignmentAccount.value = row
  selectedUserAuthorizationId.value = row.assigned_user_authorization_id || null
  assignmentDialogVisible.value = true
  try {
    await fetchAssignmentOptions()
  } catch (error) {
    console.error('Failed to fetch assignment options:', error)
  }
}

const saveAssignment = async () => {
  if (!assignmentAccount.value || !selectedUserAuthorizationId.value) return
  assignmentLoading.value = true
  try {
    await emailPoolApi.assignAccount({
      user_authorization_id: selectedUserAuthorizationId.value,
      email_account_id: assignmentAccount.value.id
    })
    ElMessage.success('邮箱已分配给普通用户')
    assignmentDialogVisible.value = false
    await fetchAccounts()
  } catch (error) {
    console.error('Assign email account failed:', error)
  } finally {
    assignmentLoading.value = false
  }
}

const releaseCurrentAssignment = async () => {
  if (!assignmentAccount.value?.assignment_id) return
  assignmentLoading.value = true
  try {
    await emailPoolApi.releaseAssignment(assignmentAccount.value.assignment_id)
    ElMessage.success('邮箱绑定已解除')
    assignmentDialogVisible.value = false
    await fetchAccounts()
  } catch (error) {
    console.error('Release email assignment failed:', error)
  } finally {
    assignmentLoading.value = false
  }
}

const handleAdd = () => {
  dialogType.value = 'add'
  currentEditId.value = null
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogType.value = 'edit'
  currentEditId.value = row.id
  form.provider = row.provider || 'custom'
  form.name = row.name || ''
  form.email_address = row.email_address || ''
  form.protocol = row.protocol || 'imap'
  form.host = row.host || ''
  form.port = Number(row.port || 993)
  form.secure = !!row.secure
  form.username = row.username || row.email_address || ''
  form.auth_secret = ''
  form.enabled = !!row.enabled
  form.note = row.note || ''
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return
    if (dialogType.value === 'add' && !form.auth_secret) {
      ElMessage.error('新增邮箱必须填写授权码')
      return
    }

    submitLoading.value = true
    try {
      if (dialogType.value === 'add') {
        await emailPoolApi.createAccount(buildPayload(true))
        ElMessage.success('邮箱账号已添加')
      } else {
        await emailPoolApi.updateAccount(currentEditId.value, buildPayload(false))
        ElMessage.success('邮箱账号已更新')
      }
      dialogVisible.value = false
      fetchAccounts()
    } catch (error) {
      console.error('Submit email account failed:', error)
    } finally {
      submitLoading.value = false
    }
  })
}

const handleTest = async (row) => {
  testLoading.value = true
  try {
    await emailPoolApi.testAccount(row.id)
    ElMessage.success('邮箱连接测试成功')
    fetchAccounts()
  } catch (error) {
    console.error('Test email account failed:', error)
  } finally {
    testLoading.value = false
  }
}

const testCurrentForm = async () => {
  if (dialogType.value === 'add') {
    ElMessage.info('请先保存账号，再进行连接测试')
    return
  }
  testLoading.value = true
  try {
    const payload = form.auth_secret ? { auth_secret: form.auth_secret } : {}
    await emailPoolApi.testAccount(currentEditId.value, payload)
    ElMessage.success('邮箱连接测试成功')
    fetchAccounts()
  } catch (error) {
    console.error('Test current email account failed:', error)
  } finally {
    testLoading.value = false
  }
}

const toggleEnabled = async (row) => {
  await emailPoolApi.updateAccount(row.id, { enabled: !row.enabled })
  ElMessage.success(row.enabled ? '邮箱账号已停用' : '邮箱账号已启用')
  fetchAccounts()
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除邮箱账号 ${row.email_address} 吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await emailPoolApi.deleteAccount(row.id)
    ElMessage.success('删除成功')
    fetchAccounts()
  } catch (error) {
    if (error !== 'cancel') console.error('Delete email account failed:', error)
  }
}

const formatDate = (date) => {
  return date ? parseServerDate(date).format('YYYY-MM-DD HH:mm') : '-'
}

onMounted(() => {
  fetchAccounts()
  fetchAssignmentOptions()
})
</script>

<style scoped>
.email-pool {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.health-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
}

.health-dot.healthy { background: var(--admin-success); }
.health-dot.failed { background: #f97316; }
.health-dot.waiting { background: var(--admin-muted-light); }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.card-header p {
  margin: 6px 0 0;
  color: var(--admin-muted);
  font-size: 12px;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.page-alert {
  margin-bottom: 14px;
}

.connection-cell,
.test-cell,
.assignment-cell {
  display: grid;
  gap: 3px;
}

.connection-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.connection-main strong {
  color: var(--admin-text);
  font-size: 13px;
}

.connection-cell span,
.connection-cell small,
.test-cell span,
.test-cell small {
  color: var(--admin-muted);
  font-size: 12px;
}

.connection-cell small,
.test-cell small {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-cell strong {
  color: var(--admin-text);
}

.assignment-cell span {
  color: var(--admin-muted);
  font-size: 12px;
}

.assignment-summary {
  display: grid;
  gap: 5px;
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
}

.assignment-summary span,
.assignment-summary small {
  color: var(--admin-muted);
  font-size: 12px;
}

.assignment-summary strong {
  color: var(--admin-text);
  font-size: 16px;
}

.secure-checkbox {
  margin-left: 16px;
}
</style>
