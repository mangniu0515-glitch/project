import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api'
import { isUsableAuthToken } from '@/utils/authToken'

export const useAuthStore = defineStore('auth', () => {
  const storedToken = localStorage.getItem('token') || ''
  const storedUser = JSON.parse(localStorage.getItem('user') || 'null')
  const token = ref(isUsableAuthToken(storedToken) ? storedToken : '')
  const user = ref(token.value ? storedUser : null)

  if (storedToken && !token.value) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  const isAuthenticated = computed(() => {
    return !!token.value
      && token.value === localStorage.getItem('token')
      && isUsableAuthToken(token.value)
  })

  const clearAuth = () => {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  const login = async (username, password) => {
    try {
      const response = await authApi.login({ username, password })
      token.value = response.token
      user.value = response.user
      localStorage.setItem('token', response.token)
      localStorage.setItem('user', JSON.stringify(response.user))
      return true
    } catch (error) {
      throw error
    }
  }

  const logout = async () => {
    try {
      if (isUsableAuthToken(token.value)) {
        await authApi.logout()
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearAuth()
    }
  }

  const fetchUserInfo = async () => {
    try {
      const response = await authApi.getUserInfo()
      user.value = response.user
      localStorage.setItem('user', JSON.stringify(response.user))
    } catch (error) {
      throw error
    }
  }

  return {
    token,
    user,
    isAuthenticated,
    clearAuth,
    login,
    logout,
    fetchUserInfo
  }
})
