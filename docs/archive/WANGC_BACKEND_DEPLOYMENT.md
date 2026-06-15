# WangC 部署维护说明

> 本文档由 AI 生成，用于帮助后续维护成员快速了解本次部署的目录、服务、验证方式和常用操作。请在后续人工调整后同步更新本文档。

## 当前状态

- 后端和管理后台已部署到服务器 `192.168.20.53`
- 部署工作区限定在 `/home/sjht/apps/WangC`
- 后端部署目录为 `/home/sjht/apps/WangC/qrcode-server`
- 管理后台部署目录为 `/home/sjht/apps/WangC/qrcode-admin`
- 对外 API 地址为 `http://192.168.20.53:3010`
- 健康检查地址为 `http://192.168.20.53:3010/api/health`
- 管理后台地址为 `http://192.168.20.53:3011`

## 服务形态

后端和管理后台都使用 Docker Compose 部署，没有在服务器系统层安装 Node.js、npm、pm2 或 nginx。

容器信息：

```bash
backend container_name: wangc-qrcode-server
backend image: qrcode-server-qrcode-server
backend port: 3010 -> 3000

admin container_name: wangc-qrcode-admin
admin image: nginx:alpine
admin port: 3011 -> 80
```

部署目录中的关键文件：

```bash
/home/sjht/apps/WangC/qrcode-server/Dockerfile
/home/sjht/apps/WangC/qrcode-server/docker-compose.yml
/home/sjht/apps/WangC/qrcode-server/.env
/home/sjht/apps/WangC/qrcode-server/data
/home/sjht/apps/WangC/qrcode-server/uploads
```

数据持久化位置：

```bash
/home/sjht/apps/WangC/qrcode-server/data/qrcodes.db
/home/sjht/apps/WangC/qrcode-server/uploads
```

`.env` 中包含 `JWT_SECRET` 和 `API_KEY`，不要提交、外传或直接贴到聊天记录中。

管理后台使用 nginx 托管静态文件，并通过 nginx 将 `/api` 和 `/uploads` 反代到后端 `http://192.168.20.53:3010`。

## 常用运维命令

后端运维：

```bash
cd /home/sjht/apps/WangC/qrcode-server
docker compose ps
docker compose logs --tail=100
docker compose restart
docker compose down
docker compose down
docker compose up -d --build
```

管理后台运维：

```bash
cd /home/sjht/apps/WangC/qrcode-admin
docker compose ps
docker compose logs --tail=100
docker compose restart
docker compose down
docker compose up -d
```

统一启动脚本：

```bash
cd /home/sjht/apps/WangC
./start.sh
```

`start.sh` 会依次启动后端和管理后台，并打印两个容器的状态。服务器重启后容器通常会因 `restart: unless-stopped` 自动恢复；如果没有自动恢复，可以执行这个脚本手动拉起。

验证健康检查：

```bash
curl http://127.0.0.1:3010/api/health
curl http://192.168.20.53:3010/api/health
curl http://192.168.20.53:3011/api/health
```

## 登录和访问说明

后端首次以空库启动时会创建默认管理员：

```text
username: admin
password: admin123
```

管理后台页面：

```text
http://192.168.20.53:3011
```

后端 API：

```text
http://192.168.20.53:3010
```

## 已知部署细节

服务器访问 Docker Hub 拉取 `node` 官方镜像时出现超时，因此本次后端镜像基于服务器本地已有的 `lissy93/dashy:latest` 构建。Dockerfile 已清空基础镜像原有入口，只运行：

```bash
node src/index.js
```

容器使用 `user: "1000:1000"` 运行，确保 `data` 和 `uploads` 中的文件归属为服务器用户 `sjht`，便于后续备份和维护。

## 验证记录

本次部署完成后已验证：

- `GET /api/health` 正常返回 `status: ok`
- `POST /api/auth/login` 使用 `admin/admin123` 登录成功
- `GET /api/qrcodes/list` 带 token 访问成功
- 未登录访问 `POST /api/qrcodes/upload` 返回 `401 Unauthorized`
- 容器重启后数据库从 `/home/sjht/apps/WangC/qrcode-server/data/qrcodes.db` 正常加载
- `http://192.168.20.53:3011` 管理后台页面返回 `200`
- `http://192.168.20.53:3011/api/health` 能通过管理后台 nginx 代理访问后端
