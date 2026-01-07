<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# SciStudio AI · 科学可视化实验室

> 本项目由阿里云ESA提供加速、计算和保护。

SciStudio AI 是一个基于 React + Vite 的交互式科学可视化工作室。  
你可以通过自然语言指令，让 AI 生成和迭代 2D/3D 科学可视化「作品」，包括：

- 3D 太阳系运行模拟、引力场可视化
- 决策树、逻辑斯蒂增长等经典机器学习与数学模型
- 双缝干涉、网络防火墙原理等物理与计算机系统演示

前端由 Vite 构建，运行在阿里云 ESA Pages 上；  
生成逻辑通过 Edge 函数调用大模型完成代码生成与自修复。

## 在线访问

- ESA Pages 访问地址（示例）：`https://scistudio.xxxxx.er.aliyun-esa.net`

## 架构一览

- 前端框架：React 18 + Vite
- 3D & 可视化：three.js, @react-three/fiber, @react-three/drei, @react-three/rapier, Recharts
- 状态管理：Zustand
- 数学与渲染：mathjs, KaTeX
- AI 接入：Gemini / GLM（通过自定义 `ModelConfig`）
- 边缘运行时：阿里云 ESA Edge 函数 + Pages 静态托管

主要目录：

- `components/`：聊天界面、作品渲染器、控制面板等 UI 组件
- `edge/`：在 ESA 上运行的 Edge 函数（如 `generateArtifact.ts`）
- `services/`：与大模型交互的服务（如 `geminiService.ts`）
- `utils/`：代码清洗、3D 场景 DSL 等工具方法
- `dist/`：构建后静态资源目录（由 Vite 生成）

## 本地运行

**前置依赖：**

- Node.js（建议与 ESA 构建环境一致，如 Node 22）

**步骤：**

1. 安装依赖

   ```bash
   npm install
   ```

2. 配置 API Key

   在项目根目录创建 `.env.local`，设置所需的大模型密钥，例如：

   ```bash
   GEMINI_API_KEY=你的_Gemini_API_Key
   # 或者 / 以及
   ZAI_API_KEY=你的_智谱GLM_API_Key
   ```

3. 启动开发服务器

   ```bash
   npm run dev
   ```

   本地开发时，`/api/generate-artifact` 由 Vite 中间件代理到 `generateScienceArtifactInternal`，无需额外后端服务。

4. 构建生产版本

   ```bash
   npm run build
   ```

   产物输出到 `dist/`，可直接部署到任何静态托管或 CDN，当前项目使用阿里云 ESA Pages。

## 阿里云 ESA 集成说明

本项目使用阿里云边缘安全加速 ESA 提供的一站式 **Pages 静态托管 + Edge 函数 + 安全防护** 能力：

- **加速：**
  - 使用 ESA Pages 将 `dist/` 目录静态托管在全球 3200+ 边缘节点上，提升科学可视化页面访问速度。
  - ESA 提供高性能 DNS 与 Anycast 调度，显著降低首字节延迟。

- **计算：**
  - 在 `esa.jsonc` 中配置：

    ```jsonc
    {
      "name": "SciStudio",
      "entry": "./edge/generateArtifact.ts",
      "installCommand": "npm install",
      "buildCommand": "npm run build",
      "assets": {
        "directory": "./dist",
        "notFoundStrategy": "singlePageApplication"
      }
    }
    ```

  - ESA 在边缘节点以 Serverless 方式执行 `edge/generateArtifact.ts` 中的默认导出函数 `generateArtifactEntry`，处理 `/api/generate-artifact` 请求。
  - 函数内调用大模型生成/修复前端可视化代码，并以 JSON 形式返回给前端聊天界面。

- **保护：**
  - ESA 默认提供基础 DDoS 防护和 WAF 能力，可在控制台进一步开启更细粒度的安全策略，对 AI API 与页面访问进行联合防护。

### ESA Pages 构建与部署流程

在 `esa` 分支中，ESA Pages 会按照以下步骤自动构建并部署：

1. 克隆仓库并检出 `esa` 分支
2. 执行 `installCommand: npm install`
3. 执行 `buildCommand: npm run build`
4. 将 `assets.directory: ./dist` 作为静态资源目录进行托管
5. 将未命中静态资源但属于 `/api/generate-artifact` 类的请求，路由到 `entry: ./edge/generateArtifact.ts` 对应的 Edge 函数处理

### ESA 品牌

阿里云 ESA Pages 官方横幅示意（可替换为你自己的控制台截图）：

![阿里云ESA Pages，构建、加速并保护你的网站]
dist\esa.png
