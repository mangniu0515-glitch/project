import api from '@/api'

const blobUrls = new Set()

export async function loadProtectedImageUrl(publicPath) {
  if (!publicPath) return null
  const response = await api.get(publicPath, {
    baseURL: '',
    responseType: 'blob'
  })
  const url = window.URL.createObjectURL(response)
  blobUrls.add(url)
  return url
}

export function revokeProtectedImageUrl(url) {
  if (!url || !blobUrls.has(url)) return
  window.URL.revokeObjectURL(url)
  blobUrls.delete(url)
}

export function revokeProtectedImageUrls(urls = []) {
  urls.forEach(revokeProtectedImageUrl)
}
