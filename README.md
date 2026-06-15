# QR码收集系统

## 项目简介

QR码收集系统是一个完整的解决方案，用于通过Chrome浏览器扩展收集网页上的QR码，并将其存储到后端服务器进行管理和查看。

## 系统架构

系统由三个主要组件组成：

1. **Chrome扩展 (chrome-extension)** - 用户端扩展，用于检测和收集网页上的QR码
2. **后端服务器 (server)** - Express.js服务器，负责QR码数据的接收、存储和管理
3. **管理后台 (admin-panel)** - Vue.js管理界面，用于查看和管理收集的QR码

## 项目结构

```
qrcode-collection-system/
├── chrome-extension/          # Chrome扩展
│   ├── lib/                  # 第三方库
│   ├── icons/                # 扩展图标
│   └── utils/                # 工具函数
├── server/                   # 后端服务器
│   ├── src/
│   │   ├── routes/          # 路由定义
│   │   ├── controllers/     # 控制器
│   │   ├── models/          # 数据模型
│   │   ├── middleware/      # 中间件
│   │   └── utils/            # 工具函数
│   ├── uploads/             # 上传文件存储
│   └── data/                # 数据文件
├── admin-panel/             # 管理后台
│   └── src/
│       ├── views/           # 页面视图
│       ├── components/      # Vue组件
│       ├── api/             # API调用
│       ├── stores/          # 状态管理
│       └── router/          # 路由配置
└── package.json             # 根项目配置
```

## 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm >= 8.0.0
- Chrome浏览器

### 安装依赖

```bash
npm run install:all
```

### 启动开发服务器

```bash
npm run dev
```

这将同时启动：

- 后端服务器 (<http://localhost:3000>)

# 管理后台 (<http://localhost:5173>)

### 构建生产版本

```bash
npm run build
```

## 使用说明

### Chrome扩展

1. 在Chrome中打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `chrome-extension` 目录
5. 访问任意包含QR码的网页，扩展将自动检测并收集QR码

### 管理后台

1. 访问 <http://localhost:5173>
2. 查看所有收集的QR码
3. 管理QR码数据（编辑、删除等）

## API端点

| 方法     | 端点               | 描述      |
| ------ | ---------------- | ------- |
| GET    | /api/qrcodes     | 获取所有QR码 |
| POST   | /api/qrcodes     | 上传新QR码  |
| GET    | /api/qrcodes/:id | 获取单个QR码 |
| PUT    | /api/qrcodes/:id | 更新QR码   |
| DELETE | /api/qrcodes/:id | 删除QR码   |

## 技术栈

- **前端框架**: Vue.js 3
- **后端框架**: Express.js
- **数据库**: SQLite
- **QR码解析**: jsQR
- **状态管理**: Pinia
- **HTTP客户端**: Axios

## 许可证

MIT License
