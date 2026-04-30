# BN 派工管理系統

專為 banner 製作流程設計的派工管理工具，欄位對應你 Excel 工作流（派工日期、BN 類別、BN 尺寸、BN 內容、派工者、製作人、需完成日、完成日、作業時間、狀態）。

## 開始使用

把這個資料夾整個用 Cursor 打開，然後雙擊 `index.html` 即可。資料儲存於瀏覽器 localStorage，無需後端。

## 主要功能


| 功能          | 說明                        |
| ----------- | ------------------------- |
| BN 工單欄位     | 完整對應 Excel 派工流程的所有欄位      |
| 製作人 / 派工者   | 兩組獨立的下拉選單，可各自管理           |
| 表格檢視        | 預設視圖，類似 Excel 的列表，可點擊欄位排序 |
| 看板檢視        | 可切換的三欄看板（待派工 / 製作中 / 完成）  |
| 詳細檢視        | 點擊表格列或卡片可展開所有欄位           |
| 逾期提醒        | 超過需完成日仍未完成的工單會自動標紅        |
| 搜尋與篩選       | 關鍵字、狀態、製作人多重篩選            |
| 📊 Excel 匯入 | 從 .xlsx 批次匯入工單            |
| 📤 Excel 匯出 | 匯出當前資料為 .xlsx             |
| 📋 範本下載     | 下載空白 Excel 範本，填好後再匯入      |
| 統計圖表        | 狀態分布甜甜圈圖、製作人工時長條圖         |
| 深色模式        | 右上角月亮/太陽圖示切換              |
| 持久化         | 資料自動存於 localStorage       |


## Excel 匯入流程

1. 點右上角「**範本**」按鈕下載 `BN派工_範本.xlsx`
2. 打開 Excel，依照欄位填入你的資料（可貼很多筆）
3. 存檔後回網頁點「**匯入 Excel**」選擇該檔案
4. 系統會自動把新人員（派工者、製作人）加入下拉選單

### 欄位名稱（必須一致）

```
派工日期 | BN類別 | BN尺寸 | BN內容 | 派工者 | 製作人 | 需完成日 | 完成日 | 作業時間 | 狀態
```

### 日期格式支援

- `2026-01-29`（標準）
- `2026/01/29`
- `1/29`（會自動補上今年）
- Excel 原生日期儲存格

### 狀態欄位

填「完成」「製作中」「待派工」都會被識別。也接受「done / progress / pending」。

## 檔案結構

```
dispatch-app/
├── index.html    # HTML 結構
├── styles.css    # 樣式（含淺色/深色主題）
├── app.js        # 主邏輯（含 Excel I/O）
└── README.md     # 本檔案
```

## 自訂修改

### 改預設人員

打開 `app.js` 最上方：

```javascript
const DEFAULT_DISPATCHERS = ['Amy', 'Bella'];
const DEFAULT_CREATORS = ['瞳', '小明', '阿凱'];
```

**注意：** 已使用過的瀏覽器要先按右上角「清空」才會載入新預設。或者直接在「管理派工者 / 管理製作人」中新增。

### 改顏色

打開 `styles.css` 最上方的 CSS 變數：

```css
--pending: #d97706;   /* 待派工 */
--progress: #2563eb;  /* 製作中 */
--done: #16a34a;      /* 完成 */
--overdue: #dc2626;   /* 逾期 */
```

### 加新欄位（例如：客戶、活動編號）

1. `index.html`：在 `.form-grid` 加一個 `<label class="field"><input id="f-xxx"></label>`
2. `app.js`：
  - `submitTask()` 收集 `xxx: document.getElementById('f-xxx').value`
  - `editTask()` 加 `document.getElementById('f-xxx').value = t.xxx || ''`
  - `clearForm()` 加上 `f-xxx`
  - 想匯出/匯入 Excel：`tasksToRows()` 與 `importExcel()` 也要對應加上
3. `styles.css`：通常不用改

## 相依套件（CDN）

- [Chart.js 4.4.1](https://www.chartjs.org/) — 圖表
- [SheetJS 0.18.5](https://sheetjs.com/) — Excel 讀寫
- Google Fonts — Plus Jakarta Sans + JetBrains Mono

第一次開啟需要連網下載（之後瀏覽器會快取）。如需完全離線使用，可下載到本地後改 `index.html` 的引用路徑。