# 部署说明

当前项目由两个服务组成：

- **API 后端**：Express 服务，默认容器内端口 `3000`，服务器映射常用端口 `3010`。
- **管理后台**：Vite 构建后的静态站点，服务器映射常用端口 `3011`。

## 推荐部署边界

- 后端服务目录只部署 `server/` 相关代码和必要的扩展模板文件。
- 管理后台部署 `admin-panel/dist/`。
- 运行时数据必须放在持久化目录中，不跟随代码覆盖。

## 必须保留的运行时数据

这些文件和目录不应提交到 Git，也不应在部署时被覆盖：

```text
server/.env
server/data/
server/uploads/
```

其中通常包含：

- SQLite 数据库
- 上传截图
- 邮箱授权码或其他敏感配置
- 插件包签名或生成用私钥

## 本地构建

```bash
node --check server/src/index.js server/src/routes/*.js server/src/middleware/*.js server/src/utils/*.js
node --check chrome-extension/background.js chrome-extension/content.js chrome-extension/extension-config.js
cd admin-panel && npm run build
```

## Docker Compose 部署思路

如果服务器已有 Docker Compose 工作区，建议沿用现有容器名、端口和挂载目录：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
curl http://127.0.0.1:3010/api/health
```

## 插件下载地址推断

后台访问地址和 API 地址存在端口映射关系：

| 后台地址 | 生成插件 API 地址 |
| --- | --- |
| `http://localhost:3001` | `http://localhost:3000` |
| `http://服务器IP:3011` | `http://服务器IP:3010` |

插件 ZIP 下载时会写入 `extension-config.js`，已安装插件不会自动跟随后端地址变化。服务器地址变更后，需要重新下载并安装插件。

## 回滚建议

部署前建议创建完整备份：

```text
backup/
├── server source
├── admin dist/source
├── .env
├── data/
└── uploads/
```

回滚时恢复备份目录，再重新执行 `docker compose up -d --build`。
