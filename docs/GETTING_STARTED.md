# 快速上手

这份文档面向新接手的管理人员和开发人员，帮助快速理解系统怎么用、各模块负责什么。

## 角色说明

| 角色 | 登录方式 | 主要能力 |
| --- | --- | --- |
| 管理员 | 后台账号密码 | 管理规则、客户端身份、邮箱池、存储治理、下载插件 |
| 组长 | IP 授权 | 选择名下普通用户，辅助二维码代扫 |
| 普通用户 | IP 授权 | 自动上传二维码、自动接收并回填邮箱验证码 |

## 管理后台使用顺序

1. **登录后台**
   - 打开后台地址，例如 `http://localhost:3001` 或服务器后台地址。
   - 使用管理员账号登录。

2. **下载插件**
   - 进入“插件下载”。
   - 下载 ZIP 包并分发给受管终端。
   - ZIP 包会自动写入当前后台对应的 API 地址。

3. **授权客户端身份**
   - 终端安装插件后会自动向后端登记 IP。
   - 进入“客户端身份”，把待审核 IP 批准为普通用户或组长。
   - 普通用户可单独开启或关闭“二维码采集”“邮箱验证码”能力。

4. **配置归属关系**
   - 在“客户端身份”中把普通用户分配给对应组长。
   - 组长插件端只处理名下普通用户的代扫工作。

5. **配置采集规则**
   - 二维码规则：管理员在目标业务页面中使用插件采集二维码目标。
   - 邮箱验证码规则：依次采集邮箱输入框、发送验证码按钮、验证码输入框。
   - 隐藏元素规则：采集需要隐藏的页面元素。

6. **维护邮箱池**
   - 在“邮箱池”添加 IMAP 邮箱账号。
   - 配置监听来源和验证码提取规则。
   - 把邮箱绑定到普通用户。

7. **查看结果**
   - “二维码列表”查看自动上传和组长代扫结果。
   - “验证码监听”查看邮件解析、任务状态和验证码回填链路。
   - “存储治理”观察数据规模并清理旧数据。

## 本地开发启动

### 1. 安装依赖

```bash
npm run install:all
```

### 2. 启动后端

```bash
cd server
cp .env.example .env
npm run dev
```

后端默认运行在 `http://localhost:3000`。

### 3. 启动后台

```bash
cd admin-panel
npm run dev
```

后台默认运行在 `http://localhost:3001`。

### 4. 加载插件

开发环境可直接加载 `chrome-extension/`：

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `chrome-extension/` 目录。

生产或内网测试建议从后台“插件下载”下载 ZIP。

## 常见验证

```bash
curl http://localhost:3000/api/health
node --check server/src/index.js server/src/routes/*.js server/src/middleware/*.js server/src/utils/*.js
node --check chrome-extension/background.js chrome-extension/content.js chrome-extension/extension-config.js
cd admin-panel && npm run build
```
