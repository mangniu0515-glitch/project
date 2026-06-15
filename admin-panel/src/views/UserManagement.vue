<template>
  <div class="user-management">
    <section class="identity-overview">
      <div class="overview-copy">
        <span class="eyebrow">系统账号层</span>
        <h2>管理员账号只负责后台配置与审计</h2>
        <p>组长和普通用户已经迁移到 IP 授权体系，不再通过账号密码登录。这里仅维护可进入管理后台的管理员账号。</p>
      </div>
      <div class="overview-cards">
        <div class="overview-card">
          <span>管理员账号</span>
          <strong>{{ adminCount }}</strong>
          <p>账号密码登录后台</p>
        </div>
        <div class="overview-card accent">
          <span>已授权客户端</span>
          <strong>{{ clientStats.approved }}</strong>
          <p>{{ clientStats.leaders }} 个组长 / {{ clientStats.users }} 个普通用户</p>
        </div>
        <div class="overview-card warning">
          <span>待审核 IP</span>
          <strong>{{ clientStats.pending }}</strong>
          <router-link to="/client-authorizations">去 IP 授权处理</router-link>
        </div>
      </div>
    </section>

    <el-card class="table-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>管理员账号列表</span>
            <p>仅管理员账号可使用账号密码登录后台；请不要在这里创建普通用户或组长。</p>
          </div>
          <el-button type="primary" :icon="Plus" @click="handleAdd">
            添加管理员
          </el-button>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        stripe
      >
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
        <el-table-column prop="role" label="角色">
          <template #default="{ row }">
            <el-tag type="danger">
              管理员
            </el-tag>
            <el-tag v-if="row.id === currentUserId" class="current-tag" type="info">当前账号</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link :icon="Edit" @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button type="warning" link :icon="Key" @click="handleChangePassword(row)">
              修改密码
            </el-button>
            <el-button
              v-if="!isSuperAdmin(row)"
              type="danger"
              link
              :icon="Delete"
              :disabled="isDeleteDisabled(row)"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '添加管理员' : '编辑管理员'"
      width="500px"
      >
      <el-alert
        title="这里只能创建管理员账号"
        description="普通用户和组长由客户端自动登记 IP 后，在 IP 授权页面审批，并由管理员统一分配归属。"
        type="info"
        show-icon
        :closable="false"
        class="dialog-alert"
      />
      <el-form
        ref="userFormRef"
        :model="userForm"
        :rules="userRules"
        label-width="80px"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="userForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-tag type="danger">管理员</el-tag>
        </el-form-item>
        <el-form-item v-if="dialogType === 'add'" label="密码" prop="password">
          <el-input
            v-model="userForm.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="passwordDialogVisible"
      title="修改密码"
      width="400px"
    >
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-width="80px"
      >
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="passwordForm.newPassword"
            type="password"
            placeholder="请输入新密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            placeholder="请确认密码"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handlePasswordSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Key } from '@element-plus/icons-vue'
import { clientAuthApi, userApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import dayjs from 'dayjs'

const authStore = useAuthStore()

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const passwordDialogVisible = ref(false)
const dialogType = ref('add')
const currentEditId = ref(null)

const userFormRef = ref(null)
const passwordFormRef = ref(null)

const currentUserId = computed(() => authStore.user?.id)
const adminCount = computed(() => tableData.value.length)

const clientStats = reactive({
  approved: 0,
  pending: 0,
  leaders: 0,
  users: 0
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const userForm = reactive({
  username: '',
  role: 'admin',
  password: ''
})

const passwordForm = reactive({
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (rule, value, callback) => {
  if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const userRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为3-20个字符', trigger: 'blur' }
  ],
  role: [
    { required: true, message: '请选择角色', trigger: 'change' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少为6位', trigger: 'blur' }
  ]
}

const passwordRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少为6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

const fetchClientStats = async () => {
  try {
    const response = await clientAuthApi.getAuthorizations()
    const rows = response.authorizations || []
    clientStats.approved = rows.filter(row => row.status === 'approved').length
    clientStats.pending = rows.filter(row => row.status === 'pending').length
    clientStats.leaders = rows.filter(row => row.status === 'approved' && row.role === 'leader').length
    clientStats.users = rows.filter(row => row.status === 'approved' && row.role === 'user').length
  } catch (error) {
    console.error('Failed to fetch client authorization stats:', error)
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    const response = await userApi.getList()
    tableData.value = response.users || []
    pagination.total = response.users?.length || 0
  } catch (error) {
    console.error('Failed to fetch users:', error)
  } finally {
    loading.value = false
  }
}

const isDeleteDisabled = (row) => {
  return isSuperAdmin(row) || row.id === currentUserId.value || adminCount.value <= 1
}

const isSuperAdmin = (row) => {
  return row?.username === 'admin'
}

const handleAdd = () => {
  dialogType.value = 'add'
  userForm.username = ''
  userForm.role = 'admin'
  userForm.password = ''
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogType.value = 'edit'
  currentEditId.value = row.id
  userForm.username = row.username
  userForm.role = row.role
  userForm.password = ''
  dialogVisible.value = true
}

const handleDelete = async (row) => {
  try {
    if (isSuperAdmin(row)) {
      ElMessage.warning('admin 超级管理员账号不可删除')
      return
    }

    const reason = row.id === currentUserId.value
      ? '不能删除当前登录账号。'
      : adminCount.value <= 1
        ? '至少需要保留一个管理员账号。'
        : ''
    if (reason) {
      ElMessage.warning(reason)
      return
    }

    await ElMessageBox.confirm(`确定删除管理员账号 ${row.username} 吗？`, '删除管理员', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    await userApi.delete(row.id)
    ElMessage.success('删除成功')
    fetchData()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Delete failed:', error)
    }
  }
}

const handleChangePassword = (row) => {
  currentEditId.value = row.id
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordDialogVisible.value = true
}

const handleSubmit = async () => {
  if (!userFormRef.value) return

  await userFormRef.value.validate(async (valid) => {
    if (valid) {
      submitLoading.value = true
      try {
        if (dialogType.value === 'add') {
          await userApi.create({
            username: userForm.username,
            role: 'admin',
            password: userForm.password
          })
          ElMessage.success('添加成功')
        } else {
          await userApi.update(currentEditId.value, {
            username: userForm.username,
            role: 'admin'
          })
          ElMessage.success('更新成功')
        }
        dialogVisible.value = false
        fetchData()
      } catch (error) {
        console.error('Submit failed:', error)
      } finally {
        submitLoading.value = false
      }
    }
  })
}

const handlePasswordSubmit = async () => {
  if (!passwordFormRef.value) return

  await passwordFormRef.value.validate(async (valid) => {
    if (valid) {
      submitLoading.value = true
      try {
        await userApi.changePassword(currentEditId.value, {
          password: passwordForm.newPassword
        })
        ElMessage.success('密码修改成功')
        passwordDialogVisible.value = false
      } catch (error) {
        console.error('Change password failed:', error)
      } finally {
        submitLoading.value = false
      }
    }
  })
}

const handleSizeChange = () => {
  pagination.page = 1
  fetchData()
}

const handleCurrentChange = () => {
  fetchData()
}

const formatDate = (date) => {
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
}

onMounted(() => {
  fetchData()
  fetchClientStats()
})
</script>

<style scoped>
.user-management {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.identity-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(420px, 1fr);
  gap: 18px;
  align-items: stretch;
  padding: 22px;
  border-radius: var(--admin-radius-xl);
  background:
    radial-gradient(circle at 8% 8%, rgba(0, 122, 255, 0.16), transparent 30%),
    linear-gradient(135deg, #ffffff 0%, #f7fbff 48%, #f8fff9 100%);
  box-shadow: var(--admin-shadow-md);
  border: 1px solid var(--admin-border-soft);
}

.overview-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.eyebrow {
  width: fit-content;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: var(--admin-primary);
  font-size: 12px;
  font-weight: 700;
}

.overview-copy h2 {
  margin: 12px 0 8px;
  font-size: 24px;
  color: var(--admin-text);
}

.overview-copy p {
  margin: 0;
  max-width: 640px;
  color: var(--admin-muted);
  line-height: 1.7;
}

.overview-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.overview-card {
  min-height: 118px;
  padding: 16px;
  border-radius: var(--admin-radius-lg);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--admin-border-soft);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.overview-card span,
.overview-card p,
.overview-card a {
  color: var(--admin-muted);
  font-size: 12px;
}

.overview-card strong {
  font-size: 30px;
  color: var(--admin-text);
}

.overview-card p {
  margin: 0;
}

.overview-card a {
  color: var(--admin-primary);
  text-decoration: none;
}

.overview-card.accent strong {
  color: #0f7a3a;
}

.overview-card.warning strong {
  color: #b45309;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.card-header span {
  font-weight: 700;
}

.card-header p {
  margin: 6px 0 0;
  color: var(--admin-muted);
  font-size: 12px;
}

.current-tag {
  margin-left: 8px;
}

.dialog-alert {
  margin-bottom: 16px;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

@media (max-width: 1100px) {
  .identity-overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .overview-cards {
    grid-template-columns: 1fr;
  }
}
</style>
