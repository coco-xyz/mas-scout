# MAS Scout

MAS（新加坡金融管理局）牌照监控与合规销售自动化系统。

为 [Cynopsis Solutions](https://www.cynopsis-solutions.com/) 构建 — 一家提供 KYC/AML 合规软件的 RegTech 公司。

---

## 问题

Cynopsis 的目标客户是刚拿到 MAS 金融牌照（CMS、MPI）的公司。这些公司有法定义务建立 KYC/AML 系统，是最理想的销售对象。

当前销售流程完全靠人：
1. 手动查 MAS 网站看哪些公司拿到了新牌照
2. 手动在 LinkedIn 搜合规负责人
3. 手动写和发送外联邮件
4. 手动准备 discovery call

效率瓶颈：每人每周大约只能覆盖 5-10 个潜在客户。

---

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                      MAS Scout                            │
├──────────────┬──────────────┬─────────────┬──────────────┤
│  Watcher     │  Enricher    │  Outreach   │  Prep        │
│  监控        │  信息补全     │  外联       │  准备         │
│              │              │             │              │
│ FID diff     │ LinkedIn/    │ 个性化      │ 回复分类      │
│ 新闻扫描     │ Apollo       │ 序列邮件    │ 会前简报      │
│ RSS 监控     │ 公司信息     │ 多渠道调度   │ CRM 同步     │
└──────┬───────┴──────┬───────┴──────┬──────┴──────┬───────┘
       │              │              │             │
       ▼              ▼              ▼             ▼
┌──────────────────────────────────────────────────────────┐
│                     共享数据层                             │
│  - 客户数据库（公司 + 联系人 + 状态）                       │
│  - 序列数据库（每个客户的外联进度）                          │
│  - 模板库（按牌照类型定制）                                 │
│  - 分析面板（转化追踪）                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 模块

### 1. Watcher — MAS 牌照监控

**输入：** MAS 金融机构目录（eservices.mas.gov.sg/fid）
**输出：** 新获牌公司及其基本信息

- 每日抓取 MAS FID，与历史快照做 diff
- 检测新的 CMS（资本市场服务）和 MPI（主要支付机构）牌照持有者
- 辅以新闻稿监控（PRNewswire、Business Wire、金融科技媒体）
- 提取字段：公司名、牌照类型、获批日期、注册地址、网站

**核心洞察：** 获牌 2-4 周内的公司正处于「搭建合规体系」阶段 — 这是销售的黄金窗口。

**技术栈：** Node.js，Puppeteer/Playwright 抓取 FID，RSS 解析器
**外部依赖：** MAS FID（公开，无需认证），新闻 API

### 2. Enricher — 联系人与公司情报

**输入：** 新获牌公司名称
**输出：** 决策层联系人 + 公司背景数据

- 在 LinkedIn / Apollo.io / Hunter.io 搜索目标公司的合规相关职位
- 优先级排序：CCO > MLRO > 合规主管 > 合规VP > 合规总监
- 过滤非决策层（分析师、助理等）
- 补全公司信息：员工数、融资阶段、技术栈、近期新闻

**技术栈：** Node.js，Apollo/PhantomBuster API
**外部依赖：** Apollo.io API（付费），LinkedIn（通过 PhantomBuster 或 Sales Navigator）

### 3. Outreach — 个性化多渠道外联

**输入：** 完整的潜在客户档案（公司 + 联系人 + 牌照类型）
**输出：** 自动化外联序列

- 根据客户信息生成个性化邮件：
  - 牌照类型 → 具体监管义务（如"PSA 第 29 条要求 MPI 持有人建立交易监控系统"）
  - 公司背景（规模、融资、行业）
  - 时间线切入（"恭喜贵司于 [日期] 获得 [牌照类型]"）
- 多渠道序列：邮件 Day 1 → LinkedIn 加好友 Day 3 → LinkedIn 消息 Day 7 → 跟进邮件 Day 10
- 人工审核门控（可配：高置信度自动发送，边缘情况人工审核）

**技术栈：** Node.js，LLM 生成内容
**外部依赖：** 邮件发送（Instantly.ai / Lemlist），LinkedIn 自动化（Expandi / PhantomBuster）

### 4. Prep — 回复处理与会前准备

**输入：** 潜在客户的回复
**输出：** 回复分类 + 会议预约 + 会前简报

- **回复分类：** 积极（约会议） / 中性（发资料） / 异议 / 拒绝
- **自动预约：** 积极回复自动发 Calendly 链接 + 上下文确认
- **会前简报：** 会议前 24 小时自动生成：
  - 公司背景 + 牌照详情
  - 该牌照类型适用的监管要求
  - 相关 Cynopsis 产品（Artemis 做 KYC、Athena 做交易监控、Iris 做顾问管理）
  - 近期公司新闻 + 谈话要点
- **CRM 同步：** 所有互动自动记录

**技术栈：** Node.js，LLM 做分类和简报生成
**外部依赖：** 日历 API（Cal.com / Calendly），CRM API（HubSpot / Salesforce）

---

## 数据模型

```
Company {
  id: string
  name: string                    // 公司名称
  licenseType: "CMS" | "MPI" | "RFA" | ...  // 牌照类型
  licenseDate: date               // 获牌日期
  registeredAddress: string       // 注册地址
  website: string                 // 公司网站
  headcount: number               // 员工数
  fundingStage: string            // 融资阶段
  source: "mas_fid" | "press" | "manual"  // 数据来源
  discoveredAt: date              // 发现时间
}

Contact {
  id: string
  companyId: string
  name: string                    // 姓名
  title: string                   // 职位
  email: string
  linkedInUrl: string
  priority: number                // 1=CCO, 2=MLRO, 3=主管, 4=VP, 5=总监
  source: "apollo" | "linkedin" | "hunter" | "manual"
}

Sequence {
  id: string
  contactId: string
  status: "pending" | "active" | "replied" | "booked" | "closed"
  steps: [{
    channel: "email" | "linkedin"
    scheduledAt: date
    sentAt: date | null
    content: string
    opened: boolean
    replied: boolean
  }]
}
```

---

## 资源需求

### 基础设施
- 1 台 VPS（与其他服务共用，占用很小）
- 数据库：MVP 用 SQLite，生产用 PostgreSQL
- 调度器：cron 或 PM2

### 外部服务（MVP 阶段）
- **Apollo.io** — 联系人补全（免费额度：50 次/月；付费：$49/月）
- **Instantly.ai 或 Lemlist** — 邮件序列（$30-97/月）
- **PhantomBuster** — LinkedIn 自动化（入门版 $56/月）
- **LLM API** — 内容生成（Claude 或 GPT，规模化约 $20-50/月）

### 开发计划
- **Phase 1（Watcher）：** ~1 周
  - FID 抓取器、diff 引擎、新闻监控
  - 交付物：每日新增 MAS 牌照持有者清单
- **Phase 2（Enricher）：** ~1 周
  - Apollo/LinkedIn 集成、联系人排序
  - 交付物：补全后的客户档案卡
- **Phase 3（Outreach）：** ~1-2 周
  - 按牌照类型的模板库、序列引擎、人工审核界面
  - 交付物：半自动外联流水线
- **Phase 4（Prep）：** ~1 周
  - 回复分类器、简报生成器、CRM 集成
  - 交付物：从获牌到 discovery call 的端到端流水线

### 团队
- 1 名开发（Node.js + API 集成）
- Cynopsis 销售团队（模板验证和序列调优）
- Agent 团队（Jessie + Lucy 开发，Boot 做 QA/DevOps）

---

## MVP 范围

Phase 1 — Watcher：
1. 每日抓取 MAS FID + diff → 检测新的 CMS/MPI 牌照持有者
2. 新闻稿监控，发现牌照获批公告
3. 输出：每日摘要推送到配置的渠道（邮件、Lark、Telegram）

仅这一步就能给销售团队一个他们目前缺少的**实时信号** — 准确知道什么时候有潜在客户拿到了牌照。

---

## 许可

MIT
