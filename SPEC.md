# Response Mock - 浏览器插件规格说明

## 1. 项目概述

- **项目名称**: Response Mock
- **类型**: 浏览器扩展（Chrome Manifest V3）
- **核心功能**: 拦截并修改指定 URL 接口的响应数据，无需修改后端即可测试不同响应场景
- **目标用户**: 前端开发者和 QA 工程师

## 2. 功能列表

### 2.1 规则管理（核心）
- 创建、编辑、删除拦截规则
- 每条规则包含：名称、URL 模式、HTTP 方法、响应状态码、响应体（JSON）
- 规则开关：启用 / 禁用指定规则
- 规则优先级：按列表顺序匹配
- 支持通配符 `*` 匹配 URL 路径

### 2.2 拦截引擎
- 拦截所有匹配的 XHR 和 Fetch 请求
- 支持 JSON 响应体修改
- 支持自定义 HTTP 状态码
- 请求匹配时展示通知提示

### 2.3 交互操作
- Popup 弹窗：快速查看 / 管理规则
- 便捷添加规则（从请求列表中点击添加）
- 日志面板：查看已拦截的请求记录（时间、URL、方法、状态）

### 2.4 持久化
- 规则存储在 Chrome Storage（同步至云端）
- 日志保留最近 200 条（内存中）

## 3. UI / UX 设计方向

### 3.1 整体风格
- 深色主题，与 Chrome DevTools 风格统一
- 简洁专业，去除多余装饰

### 3.2 配色方案
- 背景色: `#1e1e1e` / `#252526`
- 主色: `#0e639c`（蓝色）
- 强调色: `#4ec9b0`（青绿）
- 文字色: `#cccccc`
- 成功: `#4caf50` / 错误: `#f44336`

### 3.3 布局
- **Popup 弹窗**: 规则列表 + 快捷操作（400×500px）
- **设置页**: 表单风格配置（独立页面）
- **日志面板**: 在设置页内嵌 Tab 切换

## 4. 技术方案

- **Manifest V3**（Chrome 扩展最新版）
- **前端**: 纯 HTML + CSS + Vanilla JS，无框架依赖
- **存储**: `chrome.storage.sync` 存储规则配置
- **拦截**: `chrome.webRequest.onBeforeRequest` + `chrome.webNavigation`
- **通信**: `chrome.runtime.sendMessage` / `onMessage`

## 5. 文件结构

```
src/
├── manifest.json              # 扩展配置
├── background/
│   └── service-worker.js      # 后台服务脚本
├── content/
│   └── content-script.js      # 内容脚本（拦截逻辑）
├── popup/
│   ├── popup.html              # 弹窗页面
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html            # 设置页面
│   ├── options.css
│   └── options.js
└── shared/
    ├── constants.js            # 常量 & 工具函数
    └── storage.js              # 存储封装
```
