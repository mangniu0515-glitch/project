import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { isUsableAuthToken } from '@/utils/authToken'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

const publicApi = axios.create({
  baseURL: '/api',
  timeout: 30000
})

function clearAuthState() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

function redirectToLogin(message = '登录已过期，请重新登录') {
  clearAuthState()
  ElMessage.error(message)
  if (router.currentRoute.value.path !== '/login') {
    router.replace('/login')
  }
}

function isExpiredTokenError(errorData) {
  const errorText = String(errorData?.error || errorData?.message || '').toLowerCase()
  return errorText.includes('invalid or expired token') || errorText.includes('token expired')
}

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      if (!isUsableAuthToken(token)) {
        redirectToLogin()
        return Promise.reject(new axios.Cancel('AUTH_TOKEN_EXPIRED'))
      }
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

api.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response

      if (status === 401 || (status === 403 && isExpiredTokenError(data))) {
        redirectToLogin(status === 401 ? '登录已过期，请重新登录' : '登录状态已失效，请重新登录')
      } else if (status === 403) {
        ElMessage.error('没有权限访问')
      } else if (status === 404) {
        ElMessage.error('请求的资源不存在')
      } else if (status >= 500) {
        ElMessage.error('服务器错误')
      } else {
        ElMessage.error(data.message || data.error || '请求失败')
      }
    } else if (axios.isCancel(error) && error.message === 'AUTH_TOKEN_EXPIRED') {
      return Promise.reject(error)
    } else if (error.request) {
      ElMessage.error('网络连接失败')
    } else {
      ElMessage.error('请求配置错误')
    }

    return Promise.reject(error)
  }
)

export const authApi = {
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  getUserInfo: () => api.get('/auth/me')
}

export const qrcodeApi = {
  getStats: () => api.get('/qrcodes/stats'),
  getList: (params) => api.get('/qrcodes/list', { params }),
  getById: (id) => api.get(`/qrcodes/${id}`),
  delete: (id) => api.delete(`/qrcodes/${id}`),
  batchDelete: (ids) => api.delete('/qrcodes/batch', { data: { ids } }),
  export: (params) => api.get('/qrcodes/export', { params, responseType: 'blob' })
}

export const collectionApi = {
  getPolicy: () => api.get('/collection/policy'),
  getSites: () => api.get('/collection/sites'),
  createSite: (data) => api.post('/collection/sites', data),
  updateSite: (id, data) => api.put(`/collection/sites/${id}`, data),
  deleteSite: (id) => api.delete(`/collection/sites/${id}`),
  getTargets: (siteId) => api.get(`/collection/sites/${siteId}/targets`),
  createTarget: (siteId, data) => api.post(`/collection/sites/${siteId}/targets`, data),
  updateTarget: (targetId, data) => api.put(`/collection/targets/${targetId}`, data),
  deleteTarget: (targetId) => api.delete(`/collection/targets/${targetId}`),
  getHiddenRules: (siteId) => api.get(`/collection/sites/${siteId}/hidden-rules`),
  createHiddenRule: (siteId, data) => api.post(`/collection/sites/${siteId}/hidden-rules`, data),
  updateHiddenRule: (ruleId, data) => api.put(`/collection/hidden-rules/${ruleId}`, data),
  deleteHiddenRule: (ruleId) => api.delete(`/collection/hidden-rules/${ruleId}`),
  getEmailVerificationRules: (siteId) => api.get(`/collection/sites/${siteId}/email-verification-rules`),
  createEmailVerificationRule: (siteId, data) => api.post(`/collection/sites/${siteId}/email-verification-rules`, data),
  updateEmailVerificationRule: (ruleId, data) => api.put(`/collection/email-verification-rules/${ruleId}`, data),
  deleteEmailVerificationRule: (ruleId) => api.delete(`/collection/email-verification-rules/${ruleId}`),
  getAuditLogs: (params) => api.get('/collection/audit-logs', { params }),
  getDrafts: (params) => api.get('/collection/drafts', { params }),
  updateDraft: (id, data) => api.put(`/collection/drafts/${id}`, data),
  approveDraft: (id, data) => api.post(`/collection/drafts/${id}/approve`, data),
  rejectDraft: (id) => api.post(`/collection/drafts/${id}/reject`)
}

export const userApi = {
  getList: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  changePassword: (id, data) => api.post(`/users/${id}/password`, data)
}

export const clientAuthApi = {
  getAuthorizations: (params) => api.get('/client-auth/authorizations', { params }),
  createAuthorization: (data) => api.post('/client-auth/authorizations', data),
  batchCreateAuthorizations: (data) => api.post('/client-auth/authorizations/batch', data),
  updateAuthorization: (id, data) => api.put(`/client-auth/authorizations/${id}`, data),
  deleteAuthorization: (id) => api.delete(`/client-auth/authorizations/${id}`)
}

export const emailPoolApi = {
  getAccounts: () => api.get('/email-pool/accounts'),
  createAccount: (data) => api.post('/email-pool/accounts', data),
  updateAccount: (id, data) => api.put(`/email-pool/accounts/${id}`, data),
  deleteAccount: (id) => api.delete(`/email-pool/accounts/${id}`),
  testAccount: (id, data = {}) => api.post(`/email-pool/accounts/${id}/test`, data),
  getAssignments: (params) => api.get('/email-pool/assignments', { params }),
  getAssignmentOptions: () => api.get('/email-pool/assignments/options'),
  getMyAssignment: () => api.get('/email-pool/assignments/me'),
  assignAccount: (data) => api.post('/email-pool/assignments', data),
  releaseAssignment: (id) => api.delete(`/email-pool/assignments/${id}`),
  createVerificationTask: (data) => api.post('/email-pool/verification-tasks', data),
  getVerificationTask: (id) => api.get(`/email-pool/verification-tasks/${id}`),
  getMonitorRules: () => api.get('/email-pool/monitor/rules'),
  createMonitorRule: (data) => api.post('/email-pool/monitor/rules', data),
  updateMonitorRule: (id, data) => api.put(`/email-pool/monitor/rules/${id}`, data),
  deleteMonitorRule: (id) => api.delete(`/email-pool/monitor/rules/${id}`),
  testMonitorRule: (data) => api.post('/email-pool/monitor/rules/test', data),
  pollMessages: (data = {}) => api.post('/email-pool/monitor/poll', data),
  getMessages: (params) => api.get('/email-pool/monitor/messages', { params }),
  getMonitorStats: () => api.get('/email-pool/monitor/stats'),
  deleteMessage: (id) => api.delete(`/email-pool/monitor/messages/${id}`),
  batchDeleteMessages: (ids) => api.delete('/email-pool/monitor/messages/batch', { data: { ids } })
}

export const extensionApi = {
  getInfo: () => publicApi.get('/extension/info').then(response => response.data),
  downloadZip: () => publicApi.get('/extension/package.zip', { responseType: 'blob' }).then(response => response.data)
}

export const storageApi = {
  getOverview: () => api.get('/storage/overview'),
  cleanup: (data) => api.post('/storage/cleanup', data)
}

export default api
