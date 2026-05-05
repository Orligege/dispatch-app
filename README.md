# 派工管理系統

公司內部派工管理工具，目前包含 **BN 派工** 與 **文案派工** 兩個獨立模組，資料雲端同步到 Google Sheets，可多人共用。

## 系統架構

```
[ 網頁前端 ]            ← 部署在 GitHub Pages
   │  密碼門禁
   │  POST + API Token
   ▼
[ Apps Script API ]     ← 中介層，驗 token 後讀寫
   │
   ▼
[ Google Sheet ]        ← 實際資料儲存（tasks / copy_tasks / meta）
```

## 首次設定

### 1️⃣ 建立 Google Sheet
建立一個 Google Sheet，新增以下三個工作表（第一列填入對應欄位名）：

- `tasks` — BN 派工資料
- `copy_tasks` — 文案派工資料
- `meta` — 人員管理（type、name 兩欄）

欄位完整列表見下方〈資料結構〉。

### 2️⃣ 部署 Apps Script
1. 在 Google Sheet 點選「擴充功能 → Apps Script」
2. 貼入 `apps-script.gs` 內容
3. 修改最上方的 `API_TOKEN`（產一組長亂碼，例如執行 `crypto.randomUUID() + crypto.randomUUID()`）
4. 「部署 → 新增部署作業 → 類型 Web App」
    - 執行身分：**以「我」執行**
    - 誰可以存取：**任何人**（用 token 控管）
5. 複製 Web App URL（`.../exec` 結尾那串）

### 3️⃣ 設定前端
打開 `app.js` 最上方，修改：

```javascript
const API_URL = '你的 Apps Script Web App URL';
const API_TOKEN = '跟 Apps Script 同一組 token';
```

打開 `index.html`，修改第 11 行附近的密碼：

```javascript
const PASSWORD = "你設定的網頁密碼";
```

### 4️⃣ 部署網頁
推到 GitHub 並開啟 GitHub Pages（或任何靜態網站服務）。本機開發可直接雙擊 `index.html`。

---

## 主要功能

### 共用功能
| 功能 | 說明 |
|---|---|
| 🔒 密碼門禁 | 進入前需輸入密碼，同分頁內記住不重問 |
| ☁️ 雲端同步 | 即時同步到 Google Sheets，多人共用 |
| 🌙 深色模式 | 右上角切換 |
| 🗑 最近刪除 | 誤刪可復原 |
| 👥 人員管理 | 派工者、製作人各自獨立的下拉選單 |
| 🔄 重新整理 | 從雲端重新載入最新資料 |

### BN 派工模組
| 功能 | 說明 |
|---|---|
| 表格 / 日曆檢視 | 兩種視圖切換，可點欄位排序 |
| 詳細檢視 | 點工單展開所有欄位 |
| 逾期提醒 | 超過需完成日仍未完成會標紅 |
| 大分類 | 電商 / 通路 / 行銷 三類 |
| 統計圖表 | 狀態分布甜甜圈、製作人工時長條 |

### 文案派工模組
| 功能 | 說明 |
|---|---|
| 三階段日期追蹤 | 撰寫完成 → 文案確認 → 文案圖完成 |
| 大平台上架 | 勾選即標記完成 |
| 優先順序 | 高 / 中 / 低 |

### Excel 工具
| 功能 | 說明 |
|---|---|
| 📥 匯入 Excel | 依當前分頁自動匯入對應 model |
| 📤 匯出 Excel | 含進階篩選（見下） |
| 📄 下載範本 | 各 model 有獨立範本 |
| 📋 匯入紀錄 | 保留近 10 次匯入檔案 |

---

## Excel 進階功能

### 匯出篩選（兩段式 AND）

匯出 modal 採「範圍 + 大分類」兩段式篩選：

**Step 1 範圍（單選）**
- 全部資料
- 目前篩選結果
- 指定月份（依派工日）
- 自訂時間區間（依完成日，月份起訖）

**Step 2 大分類疊加（複選，BN 才有）**
- 電商 / 通路 / 行銷
- 不勾 = 不疊加；勾的跟範圍取**交集**

實際範例：
- `自訂時間區間 2026-01 → 2026-03` + ☑ 電商 → 2026 Q1 完成的電商 BN
- `全部資料` + ☑ 電商 ☑ 通路 → 所有電商與通路的 BN

### 匯入預覽 + 重複偵測

匯入時跳出預覽 modal，顯示：

```
✅ 新增 X    ⚠️ 重複 Y    ❌ 錯誤 Z
```

**重複定義：**
- BN：`大分類 + BN類別 + BN尺寸 + BN內容` 全部一致
- 文案：`品牌 + 品名` 全部一致
- 同一個檔案內出現兩筆相同也會被偵測

**遇到重複可選：**
- 跳過重複（只匯入新的）
- 全部匯入（重複的也建立新筆）

**錯誤判斷：**
- BN：缺少「BN 內容」與「BN 類別」
- 文案：缺少「品名」

---

## 檔案結構

```
dispatch-app/
├── index.html       # HTML + 密碼門禁
├── styles.css       # 樣式（含淺色/深色主題）
├── app.js           # BN 派工 + 共用 helper（API、匯入匯出 dispatcher）
├── copy.js          # 文案派工邏輯
├── apps-script.gs   # 部署在 Google Apps Script（非靜態檔）
└── README.md        # 本檔案
```

---

## 資料結構（Google Sheets）

### `tasks`（BN 派工）
```
id | dispatchDate | majorCategory | bnCategory | bnSize | bnContent | filePath | dispatcher | creator | dueDate | completedDate | hours | status
```

### `copy_tasks`（文案派工）
```
id | dispatchDate | brand | productName | writingDate | copyConfirmedDate | imageCompleted | creator | priority | launched | hours
```

### `meta`（人員）
```
type | name
```
`type` 填 `dispatcher` 或 `creator`

---

## Excel 範本欄位

### BN 派工
```
派工日期 | 大分類 | BN類別 | BN尺寸 | BN內容 | 檔案路徑 | 派工者 | 製作人 | 需完成日 | 完成日 | 作業時間 | 狀態
```

### 文案派工
```
品牌 | 品名 | 撰寫完成日期 | 文案確認日期 | 文案圖完成日期 | 製作人 | 文圖優先順序 | 大平台上架 | 作業時間
```

### 日期格式支援
- `2026-01-29`（標準）
- `2026/01/29`
- `1/29`（自動補上今年）
- Excel 原生日期儲存格

### BN 狀態欄位
- 「完成」「製作中」「待派工」
- 也接受 `done / progress / pending`
- **若有完成日 → 自動視為完成**

---

## 安全性說明

| 防護層 | 擋什麼 | 不擋什麼 |
|---|---|---|
| 🔒 網頁密碼 | 不小心點到 URL 的路人 | 看 F12 Source 的同事 |
| 🔑 API Token | 知道 API URL 但沒看過網頁原始碼的人 | 用過網頁的人（token 在 JS 裡） |
| 🔐 Apps Script GET 拒絕 | 直接瀏覽器打開 API URL 偷讀 | 帶 token 打 POST 的人 |

**設計意圖**：擋掉外部偶然訪問，內部完全信任。**這不是企業級資安**。

若需更高保護，可改用：Cloudflare Access（限定 email）、Apps Script email 白名單、或內網限定部署。

---

## 自訂修改

### 改網頁密碼
`index.html` 開頭 `<script>` 區塊內的 `PASSWORD` 常數。改完使用者下次進入要重輸密碼。

### 換 API Token
1. 產一組新亂碼（瀏覽器 Console 跑 `crypto.randomUUID() + crypto.randomUUID()`）
2. 同時改 `app.js` 的 `API_TOKEN` 和 `apps-script.gs` 的 `API_TOKEN`
3. Apps Script「管理部署作業 → 編輯 → 新版本 → 部署」
4. URL 不會變，前端 `API_URL` 不用改

### 改顏色
`styles.css` 最上方的 CSS 變數：
```css
--pending: #d97706;   /* 待派工 */
--progress: #2563eb;  /* 製作中 */
--done: #16a34a;      /* 完成 */
--overdue: #dc2626;   /* 逾期 */
```

### 加新欄位
1. `apps-script.gs`：在 `SHEET_SCHEMAS` 對應 model 加欄位名
2. Google Sheet：在工作表第一列加上對應欄位
3. `index.html`：在表單區加 `<input id="f-xxx">`
4. JS（`app.js` 或 `copy.js`）：
    - `submitTask()` 收集新欄位值
    - `editTask()` 編輯時填入
    - 要支援 Excel 的話，`tasksToRows()` 與匯入解析也要對應更新
5. Apps Script 記得**重新部署為新版本**

### 加第三個派工模組（例如「設計派工」）
1. `apps-script.gs`：`SHEET_SCHEMAS` 加新工作表名稱與欄位
2. Google Sheet：新增對應工作表
3. 仿 `copy.js` 寫一個對應的 JS 檔
4. `index.html`：加新分頁按鈕、修改 `*Smart()` dispatcher 的判斷
5. 共用的匯入預覽 modal 與匯出 modal 已支援多 model

---

## 疑難排解

| 症狀 | 可能原因 |
|---|---|
| 載入不到雲端資料 | 兩邊 token 沒對齊 / Apps Script 沒重新部署為新版本 |
| 看到 `Forbidden` 錯誤 | token 不一致 |
| 看到 `Method not allowed` | ✅ 正常，是直接打開 `/exec` URL 才會遇到 |
| 匯入跳「沒有可匯入的資料」 | 全部都是重複或錯誤，看預覽明細 |
| 密碼正確但仍進不去 | 開 F12 Console 看錯誤訊息 |
| 修改 Apps Script 後沒生效 | **存檔不夠**，必須走「部署 → 新版本」流程 |

---

## 相依套件（CDN）

- [Chart.js 4.4.1](https://www.chartjs.org/) — 圖表
- [SheetJS 0.18.5](https://sheetjs.com/) — Excel 讀寫
- Google Fonts — Plus Jakarta Sans + JetBrains Mono

第一次開啟需要連網下載（之後瀏覽器會快取）。
