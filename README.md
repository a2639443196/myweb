# Wellness Hub - 健康生活管理平台

<div align="center">

![Wellness Hub Logo](/assets/logo.png)

**专注健康，享受生活**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Browser Support](https://img.shields.io/badge/browser-modern-orange.svg)](https://caniuse.com/es6-module)

[功能特性](#功能特性) • [快速开始](#快速开始) • [项目结构](#项目结构) • [开发指南](#开发指南) • [部署指南](#部署指南)

</div>

## 项目简介

Wellness Hub 是一个综合性的健康生活管理平台，提供多种健康追踪工具和益智训练游戏，帮助用户建立健康的生活习惯。

### 核心功能

- 🏃 **健康追踪器**：饮水、排便、吸烟、摸鱼等多种习惯追踪
- 🎮 **益智游戏**：舒尔特方格、记忆翻牌、反应力测试、数独等
- 📊 **数据分析**：个人活动统计、游戏成绩排行榜
- 👥 **社交功能**：用户系统、在线状态、成绩分享
- 🌙 **主题切换**：支持深色/浅色主题，多种配色方案

## 技术栈

### 前端
- **语言**：原生 HTML5 / CSS3 / ES6+ JavaScript
- **架构**：模块化 ES6 模块系统
- **样式**：CSS 变量、Flexbox、Grid、响应式设计
- **存储**：LocalStorage、IndexedDB
- **通信**：WebSocket、RESTful API

### 后端
- **语言**：Python 3.10+
- **框架**：Flask 3.0.2
- **数据库**：SQLite
- **实时通信**：WebSocket (Flask-Sock)
- **AI 集成**：OpenAI、DeepSeek、通义千问等

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- Python 3.10+
- 现代浏览器（支持 ES6 模块）

### 安装依赖

```bash
# 前端依赖（可选，用于开发工具）
npm install

# 后端依赖
cd backend
pip install -r requirements.txt
```

### 启动开发服务器

```bash
# 启动后端服务器
python3.10 -m backend.app

# 启动前端开发服务器
npm run serve
```

访问 http://localhost:8000 查看应用。

### 构建项目

```bash
# 构建生产版本
npm run build

# 清理构建文件
npm run clean
```

## 项目结构

```
wellness-hub/
├── src/                          # 源代码
│   ├── css/                      # 样式文件
│   │   ├── core/                 # 核心样式
│   │   ├── components/           # 组件样式
│   │   ├── pages/                # 页面样式
│   │   └── utils/                # 工具样式
│   ├── js/                       # JavaScript 文件
│   │   ├── core/                 # 核心模块
│   │   ├── modules/              # 功能模块
│   │   ├── utils/                # 工具函数
│   │   ├── components/           # 组件类
│   │   └── pages/                # 页面逻辑
│   └── templates/                # 模板文件
├── public/                       # 构建输出
│   ├── css/                      # 编译后的样式
│   ├── js/                       # 编译后的脚本
│   └── assets/                   # 静态资源
├── pages/                        # HTML 页面
├── backend/                      # 后端代码
├── docs/                         # 文档
├── scripts/                      # 构建脚本
└── assets/                       # 静态资源
```

## 开发指南

### 代码规范

- **JavaScript**：遵循 ESLint Standard Style
- **CSS**：使用 BEM 命名规范
- **HTML**：语义化标签，无障碍支持
- **提交信息**：遵循 Conventional Commits

### 开发流程

1. **创建功能分支**
   ```bash
   git checkout -b feature/new-feature
   ```

2. **开发新功能**
   - 在 `src/js/pages/` 创建页面逻辑
   - 在 `src/css/pages/` 创建页面样式
   - 遵循模块化设计原则

3. **测试和调试**
   ```bash
   npm run lint     # 代码检查
   npm run test     # 运行测试
   ```

4. **提交代码**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

### 添加新页面

1. **创建页面逻辑**
   ```javascript
   // src/js/pages/new-page.js
   import BasePage from '../components/BasePage.js';

   export default class NewPage extends BasePage {
     constructor() {
       super({
         name: 'NewPage',
         title: '新页面'
       });
     }

     async init() {
       await super.init();
       // 页面初始化逻辑
     }
   }
   ```

2. **创建页面样式**
   ```css
   /* src/css/pages/new-page.css */
   .new-page {
     /* 页面样式 */
   }
   ```

3. **添加路由映射**
   在 `public/js/main.js` 中添加页面路径映射。

### 添加新游戏

1. **继承游戏基类**
   ```javascript
   import BaseGame from '../components/BaseGame.js';

   export default class NewGame extends BaseGame {
     getDefaultConfig() {
       return {
         ...super.getDefaultConfig(),
         gridSize: 5,
         difficulty: 'medium'
       };
     }

     renderGameArea() {
       // 实现游戏界面
     }

     calculateResults(duration) {
       // 计算游戏结果
     }
   }
   ```

2. **集成 API**
   ```javascript
   import { api } from '../modules/api.js';

   async saveScore(results) {
     await api.games.newGame.submitRecord(results);
   }
   ```

## 部署指南

### 生产环境部署

1. **构建项目**
   ```bash
   npm run build
   ```

2. **配置后端**
   ```bash
   # 复制配置文件
   cp config/production.py.example config/production.py

   # 编辑配置
   vim config/production.py
   ```

3. **启动服务**
   ```bash
   # 使用生产配置启动
   python3.10 -m backend.app

   # 或使用 Gunicorn
   gunicorn -w 4 -b 0.0.0.0:8000 backend.app:app
   ```

### Docker 部署

```dockerfile
FROM node:18-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM python:3.10-alpine AS backend
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY --from=frontend /app/public ./public
COPY backend/ .
EXPOSE 8000
CMD ["python", "-m", "backend.app"]
```

### Nginx 配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/wellness-hub/public;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## API 文档

### 认证接口

```javascript
// 登录
POST /api/login
{
  "username": "用户名",
  "password": "密码"
}

// 注册
POST /api/register
{
  "username": "用户名",
  "password": "密码",
  "phone": "手机号"
}

// 获取当前用户
GET /api/session
```

### 活动接口

```javascript
// 创建活动
POST /api/activity
{
  "category": "water",
  "action": "drink",
  "details": { "amount": 250 }
}

// 获取用户活动
GET /api/users/{username}/activity?category=water
```

### 游戏接口

```javascript
// 提交游戏成绩
POST /api/schulte/records
{
  "gridSize": 5,
  "elapsedMs": 30000
}

// 获取排行榜
GET /api/schulte/leaderboard
```

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 提交规范

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建工具或辅助工具的变动

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 更新日志

### v2.0.0 (2024-11-10)
- 🎉 **重大重构**：模块化架构重写
- ✨ **新增功能**：游戏基类、日志系统、API 客户端
- 🎨 **UI 改进**：全新设计系统，响应式优化
- 🚀 **性能优化**：代码分割、懒加载、缓存策略
- 🛠️ **开发体验**：热重载、类型提示、错误处理

### v1.x.x
- 基础功能实现
- 多种追踪器和游戏
- 用户系统和排行榜

## 支持

如果您遇到问题或有建议，请：

- 🐛 [提交 Issue](https://github.com/your-repo/wellness-hub/issues)
- 💬 [参与讨论](https://github.com/your-repo/wellness-hub/discussions)
- 📧 [联系我们](mailto:support@wellness-hub.com)

---

<div align="center">

**Made with ❤️ by Wellness Hub Team**

[官网](https://wellness-hub.com) • [文档](https://docs.wellness-hub.com) • [社区](https://community.wellness-hub.com)

</div>