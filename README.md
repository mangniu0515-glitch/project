# 网页验证码采集与授权管理系统

一个面向内网受管终端的网页自动化辅助系统。项目通过 Chrome 扩展在业务页面内识别二维码和邮箱验证码场景，并由后台统一管理客户端身份、采集规则、邮箱池、上传记录和存储治理。

> 适用场景：终端无法使用扩展 popup、需要管理员集中授权、需要降低人工扫码/收码操作成本的内网环境。

## 核心能力

- **页面内控制抽屉**：扩展不依赖浏览器托盘 popup，所有交互统一在页面右侧轻量抽屉完成。
- **IP 授权身份体系**：管理员按客户端 IP 授权为普通用户或组长；管理员账号仍使用账号密码登录。
- **二维码自动采集**：普通用户命中授权目标后自动上传；组长可选择名下普通用户进行代扫上传。
- **邮箱验证码闭环**：管理员采集邮箱输入框、发送按钮、验证码输入框三点规则，普通用户点击发送后短时监听邮箱并自动回填验证码。
- **规则采集与隐藏控制**：管理员可通过插件采集二维码目标、邮箱验证码规则和隐藏元素规则，支持 iframe 场景。
- **邮箱池管理**：后台维护 IMAP 邮箱、监听规则、用户绑定关系和验证码监听记录。
- **动态插件下载**：后台按当前服务器地址生成扩展 ZIP，避免手工硬编码 API 地址。
- **存储治理**：二维码截图、邮件监听记录、审计日志等数据可按策略查看和清理，降低长期运行压力。

## 项目结构

```text
qrcode-collection-system/
├── admin-panel/         # Vue 3 + Element Plus 管理后台
├── chrome-extension/    # Chrome Extension Manifest V3 内容脚本与后台脚本
├── server/              # Express + SQLite 后端服务
├── docs/                # 上手、部署、安全和 GitHub 账号说明
└── .github/             # GitHub Actions 与协作模板
```

## 技术栈

- **后台前端**：Vue 3、Vite、Element Plus、Pinia、Axios、ECharts
- **后端服务**：Node.js、Express、SQLite、JWT、Multer、ImapFlow、MailParser
- **浏览器扩展**：Chrome Extension Manifest V3、content scripts、service worker、Shadow DOM
- **二维码识别**：jsQR、ZXing
- **部署形态**：后端与后台前端可独立部署，服务器常用端口为 `3010` API 与 `3011` 管理后台

## 快速启动

### 环境要求

- Node.js 18 或更高版本
- npm 8 或更高版本
- Chrome 或 Chromium 内核浏览器

### 安装依赖

```bash
npm run install:all
```

### 启动后端

```bash
cd server
cp .env.example .env
npm run dev
```

默认 API 地址：`http://localhost:3000`

### 启动管理后台

```bash
cd admin-panel
npm run dev
```

默认后台地址：`http://localhost:3001`

### 加载插件

开发调试时可在 Chrome 扩展页加载 `chrome-extension/` 目录。生产测试建议从后台的“插件下载”入口下载 ZIP，包内会自动写入当前服务器 API 地址。

## 常用验证命令

```bash
node --check server/src/index.js server/src/routes/*.js server/src/middleware/*.js server/src/utils/*.js
node --check chrome-extension/background.js chrome-extension/content.js chrome-extension/extension-config.js
cd admin-panel && npm run build
```

## 后台主要页面

- **仪表盘**：整体采集量、运行状态和关键趋势。
- **二维码列表**：查看普通用户自动上传和组长代扫记录。
- **采集规则**：管理二维码、邮箱验证码和隐藏元素规则。
- **管理员账号**：维护后台管理员账号。
- **客户端身份**：审批 IP 授权、分配普通用户/组长、开关二维码与邮箱能力。
- **邮箱池**：维护可用邮箱、授权码、用户绑定和连接状态。
- **验证码监听**：查看验证码任务、邮件解析记录和监听结果。
- **存储治理**：观察数据规模并执行清理策略。
- **插件下载**：按当前服务器地址动态生成 Chrome 扩展 ZIP。

## 安全与数据边界

- 仓库不会提交 `.env`、SQLite 数据库、邮箱授权码、截图上传目录、扩展签名私钥等运行时数据。
- 普通用户和组长通过 IP 授权获得短期 JWT；管理员接口仍严格要求管理员账号权限。
- 插件下载包只写入静态配置，不从服务器远程加载执行代码，符合 Manifest V3 的远程代码限制。
- 邮箱验证码任务按用户点击触发短时监听，避免长期全局扫描邮箱。

更多说明见：

- [快速上手](docs/GETTING_STARTED.md)
- [部署说明](docs/DEPLOYMENT.md)
- [安全说明](docs/SECURITY.md)
- [GitHub 账号装修建议](docs/GITHUB_ACCOUNT_CHECKLIST.md)

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。
