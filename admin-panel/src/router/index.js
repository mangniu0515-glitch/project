import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Layout from '@/components/Layout.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/extension-download',
    name: 'ExtensionDownload',
    component: () => import('@/views/ExtensionDownload.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/collection-rules',
    redirect: '/collection-rules/qrcode'
  },
  {
    path: '/',
    component: Layout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue')
      },
      {
        path: 'qrcodes',
        name: 'QrcodeList',
        component: () => import('@/views/QrcodeList.vue')
      },
      {
        path: 'collection-rules/:ruleType(qrcode|hidden|email)?',
        name: 'CollectionRules',
        component: () => import('@/views/CollectionRules.vue')
      },
      {
        path: 'users',
        name: 'UserManagement',
        component: () => import('@/views/UserManagement.vue')
      },
      {
        path: 'client-authorizations',
        name: 'ClientAuthorizations',
        component: () => import('@/views/ClientAuthorizations.vue')
      },
      {
        path: 'email-pool',
        name: 'EmailPool',
        component: () => import('@/views/EmailPool.vue')
      },
      {
        path: 'email-monitor',
        name: 'EmailMonitor',
        component: () => import('@/views/EmailMonitor.vue')
      },
      {
        path: 'storage',
        name: 'StorageGovernance',
        component: () => import('@/views/StorageGovernance.vue')
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  const requiresAuth = to.meta.requiresAuth

  if (requiresAuth && !authStore.isAuthenticated) {
    authStore.clearAuth()
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router
