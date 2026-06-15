import { getConfig } from './storage.js';

export async function uploadQRCode(data) {
  const config = await getConfig();
  
  if (!config.serverUrl) {
    throw new Error('服务器地址未配置');
  }

  const url = `${config.serverUrl.replace(/\/$/, '')}/api/qrcodes/upload`;
  
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: data.data,
      source: data.source || '',
      timestamp: data.timestamp || new Date().toISOString(),
      metadata: data.metadata || {}
    })
  });

  if (!response.ok) {
    throw new Error(`上传失败: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export async function checkServerStatus() {
  const config = await getConfig();
  
  if (!config.serverUrl) {
    return { online: false, message: '服务器地址未配置' };
  }

  try {
    const url = `${config.serverUrl.replace(/\/$/, '')}/api/health`;
    const response = await fetch(url, { 
      method: 'GET',
      timeout: 5000 
    });
    
    return { 
      online: response.ok, 
      message: response.ok ? '服务器在线' : '服务器离线' 
    };
  } catch (error) {
    return { 
      online: false, 
      message: '服务器离线或无法连接' 
    };
  }
}
