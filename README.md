# 餐热量拍照记录

一个面向手机浏览器的轻量原型，用于拍照或上传食物照片、估算热量、保存历史记录并查看基础分析。

## 功能

- 拍照或上传图片，压缩后本地预览
- 支持真实视觉识别后端，返回食物名称、热量、份量和可信度
- 未配置后端时自动回落到本地演示估算
- 保存餐别、份量、热量和备注
- 使用 `localStorage` 持久化历史记录
- 今日摄入、本周摄入、日均摄入和累计记录统计
- 7 日趋势图和简短分析建议
- 导出 JSON、清空本地数据

## 运行

直接打开 `index.html` 即可运行。也可以在本目录启动静态服务：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 真实识别模式

真实识别需要 API key，不能把 key 放在浏览器前端。用内置 Node 后端启动：

```bash
cp .env.example .env
```

编辑 `.env`，填入 OpenAI、Claude 或 PackyCode API key。然后启动：

```bash
npm start
```

访问 `http://localhost:8081`。前端会自动调用 `/api/analyze-food`；如果后端未配置或调用失败，会显示提示并回落到演示估算。

OpenAI 示例：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
```

Claude 示例：

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

PackyCode / OpenAI-compatible 示例：

```bash
AI_PROVIDER=packycode
PACKYCODE_API_KEY=your-packycode-api-key
PACKYCODE_MODEL=your-vision-model
PACKYCODE_BASE_URL=https://your-packycode-openai-compatible-base-url/v1
```

PackyCode 需要提供 OpenAI-compatible 的 base URL；后端会请求 `${PACKYCODE_BASE_URL}/chat/completions`。

ChatGPT Plus / Claude Pro 的网页订阅不包含 API 调用额度；真实识别需要分别在 OpenAI Platform 或 Anthropic Console 配置 API 计费。

## 手机上测试

电脑和手机连接同一个 Wi-Fi 后，在电脑上启动静态服务：

```bash
python3 -m http.server 8081
```

查询电脑局域网 IP：

```bash
ipconfig getifaddr en0
```

手机浏览器访问 `http://电脑IP:8081`，例如 `http://192.168.1.23:8081`。

GitHub Pages 地址：

```text
https://eddy-zhang-h.github.io/food-calorie-app/
```

## 后续扩展点

- 将后端部署到 Vercel、Render、Railway 或 Cloudflare Workers，再让 GitHub Pages 调用线上 API
- 增加用户目标热量、营养素拆分、体重趋势等数据模型
- 将 `localStorage` 切换为 IndexedDB 或云端账户同步
- 加入离线缓存和真实 PWA 图标
