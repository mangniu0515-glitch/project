<template>
  <div class="client-authorizations">
    <el-card class="table-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>IP 授权列表</span>
            <p>插件客户端会自动登记 IP，管理员在这里批准为组长或普通用户。</p>
          </div>
          <div class="header-actions">
            <el-select v-model="statusFilter" class="status-filter" @change="fetchData">
              <el-option label="全部状态" value="" />
              <el-option label="待审核" value="pending" />
              <el-option label="已授权" value="approved" />
              <el-option label="已禁用" value="disabled" />
            </el-select>
            <el-button type="primary" :icon="Plus" @click="handleAdd">手动添加 IP</el-button>
            <el-button :icon="Refresh" @click="fetchData">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="tableRows"
        row-key="_rowKey"
        border
        stripe
        default-expand-all
        :tree-props="{ children: 'children' }"
        :row-class-name="getRowClassName"
      >
        <el-table-column prop="ip_address" label="IP 地址" min-width="150" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMeta[row.status]?.type || 'info'">
              {{ statusMeta[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="role" label="身份" width="110">
          <template #default="{ row }">
            <el-tag :type="row.role === 'leader' ? 'warning' : 'info'">
              {{ row.role === 'leader' ? '组长' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="归属组长" min-width="150">
          <template #default="{ row }">
            <span v-if="row.role === 'user'">{{ row.leader_ip_address || '未绑定' }}</span>
            <span v-else>{{ row.member_count || 0 }} 个普通用户</span>
          </template>
        </el-table-column>
        <el-table-column label="绑定邮箱" min-width="190">
          <template #default="{ row }">
            <span v-if="row.role === 'user'">{{ row.email_address || '未分配' }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="二维码采集" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              v-if="row.role === 'user'"
              :model-value="isFeatureEnabled(row.qrcode_enabled)"
              :loading="featureSwitchingId === `${row.id}:qrcode`"
              @change="toggleFeature(row, 'qrcode_enabled', $event)"
            />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="邮箱验证码" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              v-if="row.role === 'user'"
              :model-value="isFeatureEnabled(row.email_enabled)"
              :loading="featureSwitchingId === `${row.id}:email`"
              @change="toggleFeature(row, 'email_enabled', $event)"
            />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="160">
          <template #default="{ row }">{{ row.note || '-' }}</template>
        </el-table-column>
        <el-table-column prop="extension_version" label="插件版本" width="110">
          <template #default="{ row }">{{ row.extension_version || '-' }}</template>
        </el-table-column>
        <el-table-column prop="last_seen_at" label="最近访问" width="160">
          <template #default="{ row }">{{ formatDate(row.last_seen_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="380" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'approved'" type="success" link @click="approve(row, 'user')">
              授权普通
            </el-button>
            <el-button v-if="row.status !== 'approved'" type="warning" link @click="approve(row, 'leader')">
              授权组长
            </el-button>
            <el-button
              v-if="row.role === 'user' && row.status === 'approved'"
              type="primary"
              link
              @click="openEmailDialog(row)"
            >
              {{ row.email_assignment_id ? '更换邮箱' : '分配邮箱' }}
            </el-button>
            <el-button type="primary" link :icon="Edit" @click="handleEdit(row)">编辑</el-button>
            <el-button
              :type="row.status === 'disabled' ? 'success' : 'danger'"
              link
              @click="toggleDisabled(row)"
            >
              {{ row.status === 'disabled' ? '恢复' : '禁用' }}
            </el-button>
            <el-button type="danger" link :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item v-if="dialogType === 'add'" label="添加方式">
          <el-radio-group v-model="addMode">
            <el-radio-button label="single">单个 IP</el-radio-button>
            <el-radio-button label="batch">批量文本</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="addMode === 'single'" label="IP 地址" prop="ip_address">
          <el-input v-model="form.ip_address" :disabled="dialogType === 'edit'" placeholder="例如 192.168.1.23" />
        </el-form-item>
        <el-form-item v-else label="IP 文本" prop="batch_text">
          <el-input
            v-model="form.batch_text"
            type="textarea"
            :rows="8"
            placeholder="每行一个 IP，也支持逗号、空格或分号分隔&#10;例如：&#10;10.0.0.182&#10;10.0.0.183, 10.0.0.184"
          />
          <div class="batch-help">
            系统会自动去重并跳过已存在 IP；最多一次处理 500 个有效 IP。
          </div>
        </el-form-item>
        <el-form-item label="身份" prop="role">
          <el-select v-model="form.role">
            <el-option label="普通用户" value="user" />
            <el-option label="组长" value="leader" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status">
            <el-option label="待审核" value="pending" />
            <el-option label="已授权" value="approved" />
            <el-option label="已禁用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.role === 'user'" label="归属组长">
          <el-select v-model="form.leader_authorization_id" clearable placeholder="可不分配">
            <el-option label="不分配组长" :value="null" />
            <el-option
              v-for="leader in availableLeaderOptions"
              :key="leader.id"
              :label="leaderLabel(leader)"
              :value="leader.id"
            />
          </el-select>
        </el-form-item>
        <template v-if="form.role === 'user'">
          <el-form-item label="二维码采集">
            <el-switch
              v-model="form.qrcode_enabled"
              active-text="开启"
              inactive-text="关闭"
            />
          </el-form-item>
          <el-form-item label="邮箱验证码">
            <el-switch
              v-model="form.email_enabled"
              active-text="开启"
              inactive-text="关闭"
            />
          </el-form-item>
        </template>
        <el-form-item label="备注" prop="note">
          <el-input v-model="form.note" type="textarea" :rows="3" placeholder="可填写设备、人员或工位信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchResultVisible" title="批量添加结果" width="560px">
      <div v-if="batchResult" class="batch-result">
        <div class="batch-result-summary">
          <div><strong>{{ batchResult.summary?.created || 0 }}</strong><span>新增</span></div>
          <div><strong>{{ batchResult.summary?.skipped || 0 }}</strong><span>跳过</span></div>
          <div><strong>{{ batchResult.summary?.input || 0 }}</strong><span>有效输入</span></div>
        </div>
        <div v-if="batchResult.skipped?.length" class="batch-skipped">
          <span>已存在而跳过的 IP</span>
          <p>{{ batchResult.skipped.map(item => item.ip_address).join('、') }}</p>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="batchResultVisible = false">知道了</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="emailDialogVisible" title="普通用户邮箱绑定" width="520px">
      <div v-if="selectedAuthorization" class="email-assignment-summary">
        <span>普通用户</span>
        <strong>{{ selectedAuthorization.ip_address }}</strong>
        <small>组长：{{ selectedAuthorization.leader_ip_address || '未绑定组长' }}</small>
      </div>
      <el-form label-width="90px">
        <el-form-item label="邮箱">
          <el-select
            v-model="selectedEmailAccountId"
            filterable
            placeholder="选择未占用邮箱"
            style="width: 100%"
          >
            <el-option
              v-for="account in availableEmailOptions"
              :key="account.id"
              :label="`${account.name}（${account.email_address}）`"
              :value="account.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="selectedAuthorization?.email_assignment_id"
          type="danger"
          plain
          :loading="emailAssignmentLoading"
          @click="releaseEmailAssignment"
        >
          解除绑定
        </el-button>
        <el-button @click="emailDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!selectedEmailAccountId"
          :loading="emailAssignmentLoading"
          @click="saveEmailAssignment"
        >
          确认分配
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { clientAuthApi, emailPoolApi } from '@/api'
import dayjs from 'dayjs'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const leaderOptions = ref([])
const statusFilter = ref('')
const dialogVisible = ref(false)
const dialogType = ref('add')
const addMode = ref('single')
const currentEditId = ref(null)
const formRef = ref(null)
const batchResultVisible = ref(false)
const batchResult = ref(null)
const emailDialogVisible = ref(false)
const emailAssignmentLoading = ref(false)
const emailOptions = ref([])
const selectedAuthorization = ref(null)
const selectedEmailAccountId = ref(null)
const featureSwitchingId = ref('')

const statusMeta = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已授权', type: 'success' },
  disabled: { label: '已禁用', type: 'danger' }
}

const form = reactive({
  ip_address: '',
  batch_text: '',
  role: 'user',
  status: 'approved',
  leader_authorization_id: null,
  qrcode_enabled: true,
  email_enabled: true,
  note: ''
})

const rules = {
  ip_address: [
    {
      validator: (rule, value, callback) => {
        if (dialogType.value === 'add' && addMode.value === 'batch') return callback()
        if (!String(value || '').trim()) return callback(new Error('请输入 IP 地址'))
        callback()
      },
      trigger: 'blur'
    }
  ],
  batch_text: [
    {
      validator: (rule, value, callback) => {
        if (dialogType.value !== 'add' || addMode.value !== 'batch') return callback()
        if (!String(value || '').trim()) return callback(new Error('请粘贴 IP 文本'))
        callback()
      },
      trigger: 'blur'
    }
  ],
  role: [{ required: true, message: '请选择身份', trigger: 'change' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }]
}

const dialogTitle = computed(() => {
  if (dialogType.value === 'edit') return '编辑 IP 授权'
  return addMode.value === 'batch' ? '批量添加 IP' : '手动添加 IP'
})

const availableLeaderOptions = computed(() => {
  return leaderOptions.value.filter(leader => Number(leader.id) !== Number(currentEditId.value))
})

const availableEmailOptions = computed(() => {
  if (!selectedAuthorization.value) return []
  return emailOptions.value.filter(account => {
    return !account.user_authorization_id
      || Number(account.user_authorization_id) === Number(selectedAuthorization.value.id)
  })
})

const tableRows = computed(() => {
  const rows = tableData.value.map((row, index) => ({
    ...row,
    _rowKey: `${row.id || row.ip_address}-${index}`,
    _isChild: false,
    _visibleMemberCount: Number(row.member_count || 0),
    children: row.role === 'leader' ? [] : undefined
  }))
  const byId = new Map(rows.map(row => [Number(row.id), row]))

  rows.forEach(row => {
    if (row.role !== 'user' || !row.leader_authorization_id) return

    const leader = byId.get(Number(row.leader_authorization_id))
    if (!leader || leader.role !== 'leader') return

    row._isChild = true
    row._parentLeaderIp = leader.ip_address
    leader.children.push(row)
  })

  rows.forEach(row => {
    if (row.role === 'leader') {
      row._visibleMemberCount = row.children.length || Number(row.member_count || 0)
    }
  })

  return rows.filter(row => !row._isChild)
})

const getRowClassName = ({ row }) => {
  if (row._isChild) return 'authorization-child-row'
  if (row.role === 'leader') return 'authorization-leader-row'
  return 'authorization-standalone-row'
}

const leaderLabel = (leader) => {
  return leader.note ? `${leader.ip_address} · ${leader.note}` : leader.ip_address
}

const isFeatureEnabled = (value) => {
  return value !== false && value !== 0
}

const fetchLeaderOptions = async () => {
  const response = await clientAuthApi.getAuthorizations({ status: 'approved' })
  leaderOptions.value = (response.authorizations || []).filter(item => item.role === 'leader')
}

const fetchData = async () => {
  loading.value = true
  try {
    const params = statusFilter.value ? { status: statusFilter.value } : {}
    const response = await clientAuthApi.getAuthorizations(params)
    tableData.value = response.authorizations || []
  } catch (error) {
    console.error('Failed to fetch client authorizations:', error)
  } finally {
    loading.value = false
  }
}

const fetchEmailOptions = async () => {
  const response = await emailPoolApi.getAssignmentOptions()
  emailOptions.value = response.accounts || []
}

const openEmailDialog = async (row) => {
  selectedAuthorization.value = row
  selectedEmailAccountId.value = row.email_account_id || null
  emailDialogVisible.value = true
  try {
    await fetchEmailOptions()
  } catch (error) {
    console.error('Failed to fetch email assignment options:', error)
  }
}

const saveEmailAssignment = async () => {
  if (!selectedAuthorization.value || !selectedEmailAccountId.value) return
  emailAssignmentLoading.value = true
  try {
    await emailPoolApi.assignAccount({
      user_authorization_id: selectedAuthorization.value.id,
      email_account_id: selectedEmailAccountId.value
    })
    ElMessage.success('邮箱绑定已保存')
    emailDialogVisible.value = false
    await Promise.all([fetchData(), fetchEmailOptions()])
  } catch (error) {
    console.error('Save email assignment failed:', error)
  } finally {
    emailAssignmentLoading.value = false
  }
}

const releaseEmailAssignment = async () => {
  if (!selectedAuthorization.value?.email_assignment_id) return
  emailAssignmentLoading.value = true
  try {
    await emailPoolApi.releaseAssignment(selectedAuthorization.value.email_assignment_id)
    ElMessage.success('邮箱绑定已解除')
    emailDialogVisible.value = false
    await Promise.all([fetchData(), fetchEmailOptions()])
  } catch (error) {
    console.error('Release email assignment failed:', error)
  } finally {
    emailAssignmentLoading.value = false
  }
}

const resetForm = () => {
  form.ip_address = ''
  form.batch_text = ''
  form.role = 'user'
  form.status = 'approved'
  form.leader_authorization_id = null
  form.qrcode_enabled = true
  form.email_enabled = true
  form.note = ''
}

const handleAdd = () => {
  dialogType.value = 'add'
  addMode.value = 'single'
  currentEditId.value = null
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogType.value = 'edit'
  currentEditId.value = row.id
  form.ip_address = row.ip_address
  form.batch_text = ''
  form.role = row.role || 'user'
  form.status = row.status || 'pending'
  form.leader_authorization_id = row.leader_authorization_id || null
  form.qrcode_enabled = isFeatureEnabled(row.qrcode_enabled)
  form.email_enabled = isFeatureEnabled(row.email_enabled)
  form.note = row.note || ''
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return
    submitLoading.value = true
    try {
      const payload = {
        role: form.role,
        status: form.status,
        note: form.note,
        leader_authorization_id: form.role === 'user' ? (form.leader_authorization_id || null) : null,
        qrcode_enabled: form.role === 'user' ? form.qrcode_enabled : true,
        email_enabled: form.role === 'user' ? form.email_enabled : true
      }
      if (dialogType.value === 'add') {
        if (addMode.value === 'batch') {
          batchResult.value = await clientAuthApi.batchCreateAuthorizations({
            ...payload,
            text: form.batch_text
          })
          const created = batchResult.value.summary?.created || 0
          const skipped = batchResult.value.summary?.skipped || 0
          ElMessage.success(`批量处理完成，新增 ${created} 个，跳过 ${skipped} 个`)
          batchResultVisible.value = true
        } else {
          await clientAuthApi.createAuthorization({ ...payload, ip_address: form.ip_address })
          ElMessage.success('添加成功')
        }
      } else {
        await clientAuthApi.updateAuthorization(currentEditId.value, payload)
        ElMessage.success('更新成功')
      }
      dialogVisible.value = false
      await fetchLeaderOptions()
      fetchData()
    } catch (error) {
      console.error('Submit authorization failed:', error)
    } finally {
      submitLoading.value = false
    }
  })
}

const toggleFeature = async (row, field, enabled) => {
  const switchKey = `${row.id}:${field === 'qrcode_enabled' ? 'qrcode' : 'email'}`
  featureSwitchingId.value = switchKey
  try {
    await clientAuthApi.updateAuthorization(row.id, {
      role: row.role,
      status: row.status,
      note: row.note || '',
      leader_authorization_id: row.role === 'user' ? (row.leader_authorization_id || null) : null,
      qrcode_enabled: field === 'qrcode_enabled' ? !!enabled : isFeatureEnabled(row.qrcode_enabled),
      email_enabled: field === 'email_enabled' ? !!enabled : isFeatureEnabled(row.email_enabled)
    })
    ElMessage.success(enabled ? '功能已开启' : '功能已关闭')
    fetchData()
  } catch (error) {
    console.error('Toggle feature failed:', error)
    fetchData()
  } finally {
    featureSwitchingId.value = ''
  }
}

const approve = async (row, role) => {
  await clientAuthApi.updateAuthorization(row.id, {
    role,
    status: 'approved',
    qrcode_enabled: role === 'user' ? isFeatureEnabled(row.qrcode_enabled) : true,
    email_enabled: role === 'user' ? isFeatureEnabled(row.email_enabled) : true
  })
  ElMessage.success(role === 'leader' ? '已授权为组长' : '已授权为普通用户')
  await fetchLeaderOptions()
  fetchData()
}

const toggleDisabled = async (row) => {
  const status = row.status === 'disabled' ? 'approved' : 'disabled'
  await clientAuthApi.updateAuthorization(row.id, { status })
  ElMessage.success(status === 'disabled' ? '已禁用' : '已恢复授权')
  fetchData()
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除 ${row.ip_address} 的授权记录吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await clientAuthApi.deleteAuthorization(row.id)
    ElMessage.success('删除成功')
    fetchData()
  } catch (error) {
    if (error !== 'cancel') console.error('Delete authorization failed:', error)
  }
}

const formatDate = (date) => {
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
}

onMounted(() => {
  fetchLeaderOptions()
  fetchData()
  fetchEmailOptions()
})
</script>

<style scoped>
.client-authorizations {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

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

.status-filter {
  width: 130px;
}

.batch-help {
  margin-top: 6px;
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.5;
}

.batch-result {
  display: grid;
  gap: 14px;
}

.batch-result-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.batch-result-summary div {
  display: grid;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
  text-align: center;
}

.batch-result-summary strong {
  color: var(--admin-text);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}

.batch-result-summary span,
.batch-skipped span {
  color: var(--admin-muted);
  font-size: 12px;
}

.batch-skipped {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: var(--admin-radius-lg);
  background: #fffbeb;
}

.batch-skipped p {
  margin: 0;
  color: #92400e;
  line-height: 1.6;
  word-break: break-all;
}

.email-assignment-summary {
  display: grid;
  gap: 5px;
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-soft);
}

.email-assignment-summary span,
.email-assignment-summary small {
  color: var(--admin-muted);
  font-size: 12px;
}

.email-assignment-summary strong {
  color: var(--admin-text);
  font-size: 16px;
}

:deep(.authorization-leader-row) {
  --el-table-tr-bg-color: #f8fbff;
  font-weight: 600;
}

:deep(.authorization-leader-row td:first-child .cell) {
  color: var(--admin-text);
}

:deep(.authorization-child-row) {
  --el-table-tr-bg-color: #fbfdff;
}

:deep(.authorization-child-row td:first-child .cell) {
  position: relative;
  padding-left: 42px !important;
  color: var(--admin-muted);
}

:deep(.authorization-child-row td:first-child .cell::before) {
  content: '';
  position: absolute;
  left: 22px;
  top: 0;
  width: 14px;
  height: 50%;
  border-left: 2px solid rgba(0, 122, 255, 0.24);
  border-bottom: 2px solid rgba(0, 122, 255, 0.24);
  border-radius: 0 0 0 6px;
}

:deep(.authorization-child-row td:first-child .cell::after) {
  content: '归属';
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 600;
}

:deep(.authorization-standalone-row td:first-child .cell) {
  color: var(--admin-text-soft);
}
</style>
