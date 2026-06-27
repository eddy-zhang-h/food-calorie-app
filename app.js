const STORAGE_KEY = "calorie-camera-records-v1";
const API_ENDPOINT = "/api/analyze-food";

const FOOD_LIBRARY = [
  { name: "米饭配鸡胸肉", calories: 520, unit: "份", portion: 1, confidence: 0.76 },
  { name: "牛肉面", calories: 690, unit: "碗", portion: 1, confidence: 0.72 },
  { name: "蔬菜沙拉", calories: 260, unit: "份", portion: 1, confidence: 0.81 },
  { name: "汉堡套餐", calories: 880, unit: "份", portion: 1, confidence: 0.69 },
  { name: "番茄炒蛋盖饭", calories: 610, unit: "份", portion: 1, confidence: 0.74 },
  { name: "三明治", calories: 430, unit: "个", portion: 1, confidence: 0.71 },
  { name: "水果酸奶碗", calories: 340, unit: "碗", portion: 1, confidence: 0.78 },
  { name: "煎饺", calories: 560, unit: "份", portion: 1, confidence: 0.7 }
];

const state = {
  records: loadRecords(),
  currentImage: "",
  lastEstimate: null
};

const elements = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    capture: document.querySelector("#captureView"),
    history: document.querySelector("#historyView"),
    insights: document.querySelector("#insightsView")
  },
  photoInput: document.querySelector("#photoInput"),
  photoPreview: document.querySelector("#photoPreview"),
  emptyPreview: document.querySelector("#emptyPreview"),
  analyzeButton: document.querySelector("#analyzeButton"),
  mealForm: document.querySelector("#mealForm"),
  estimateTitle: document.querySelector("#estimateTitle"),
  sourcePill: document.querySelector("#sourcePill"),
  confidencePill: document.querySelector("#confidencePill"),
  foodName: document.querySelector("#foodName"),
  portion: document.querySelector("#portion"),
  portionUnit: document.querySelector("#portionUnit"),
  calories: document.querySelector("#calories"),
  mealType: document.querySelector("#mealType"),
  notes: document.querySelector("#notes"),
  todayCalories: document.querySelector("#todayCalories"),
  weekCalories: document.querySelector("#weekCalories"),
  averageCalories: document.querySelector("#averageCalories"),
  recordCount: document.querySelector("#recordCount"),
  historyList: document.querySelector("#historyList"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  trendChart: document.querySelector("#trendChart"),
  insightText: document.querySelector("#insightText"),
  statusMessage: document.querySelector("#statusMessage")
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecords(records = state.records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch (error) {
    console.warn("Unable to save records locally.", error);
    return false;
  }
}

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.hidden = false;
}

function hideStatus() {
  elements.statusMessage.hidden = true;
}

function switchTab(tabName) {
  elements.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === tabName));
  Object.entries(elements.views).forEach(([name, view]) => view.classList.toggle("is-active", name === tabName));
  if (tabName === "insights") drawTrendChart();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  if (image.decode) {
    await image.decode();
  } else {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
  }

  const maxSize = 520;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.62);
}

function hashText(value) {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

const analyzerEngine = {
  async estimate({ file, imageData }) {
    const apiEstimate = await requestRealEstimate({ imageData });
    if (apiEstimate) return apiEstimate;

    const imageHash = hashText(`${file.name}-${file.size}-${file.lastModified}-${imageData.length}`);
    const selected = FOOD_LIBRARY[imageHash % FOOD_LIBRARY.length];
    const variation = ((imageHash % 17) - 8) * 8;
    const calories = Math.max(120, selected.calories + variation);

    return {
      ...selected,
      isFood: true,
      calories,
      confidence: Math.min(0.92, selected.confidence + (imageHash % 9) / 100),
      notes: "演示估算结果，请手动确认。",
      source: "demo"
    };
  }
};

async function requestRealEstimate({ imageData }) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData })
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return normalizeEstimate(data, "ai");
  } catch (error) {
    console.info("Using demo estimator because real analyzer is unavailable.", error);
    showStatus(`真实识别失败，已切换为演示估算：${error.message}`);
    return null;
  }
}

async function readErrorMessage(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data.error || text;
  } catch {
    return text;
  }
}

function normalizeEstimate(data, fallbackSource) {
  return {
    isFood: Boolean(data.isFood),
    name: data.foodName || data.name || "待确认食物",
    calories: clampNumber(data.caloriesKcal ?? data.calories, 0, 5000, 0),
    unit: data.portionUnit || "份",
    portion: clampNumber(data.portion, 0.1, 20, 1),
    confidence: clampNumber(data.confidence, 0, 1, 0.5),
    mealType: data.mealTypeSuggestion || guessMealType(),
    notes: data.notes || "",
    source: data.source || fallbackSource
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function handlePhotoChange(event) {
  const [file] = event.target.files;
  if (!file) return;

  hideStatus();
  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "处理照片...";

  try {
    const dataUrl = await fileToDataUrl(file);
    state.currentImage = await compressImage(dataUrl);
    state.lastEstimate = null;

    elements.photoPreview.src = state.currentImage;
    elements.photoPreview.style.display = "block";
    elements.emptyPreview.style.display = "none";
    elements.mealForm.hidden = true;
    elements.analyzeButton.dataset.fileName = file.name;
    elements.analyzeButton.dataset.fileSize = file.size;
    elements.analyzeButton.dataset.fileModified = file.lastModified;
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "开始估算";
  } catch (error) {
    console.error(error);
    state.currentImage = "";
    elements.analyzeButton.textContent = "开始估算";
    showStatus("照片处理失败，请换一张照片或从相册选择较小的图片。");
  }
}

async function analyzeCurrentPhoto() {
  if (!state.currentImage) return;

  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "估算中...";

  const estimate = await analyzerEngine.estimate({
    imageData: state.currentImage,
    file: {
      name: elements.analyzeButton.dataset.fileName || "camera-photo",
      size: Number(elements.analyzeButton.dataset.fileSize || 0),
      lastModified: Number(elements.analyzeButton.dataset.fileModified || Date.now())
    }
  });

  state.lastEstimate = estimate;
  if (!estimate.isFood) {
    elements.mealForm.hidden = true;
    elements.analyzeButton.textContent = "重新估算";
    elements.analyzeButton.disabled = false;
    showStatus("未检测到明确食物，请换一张餐食照片再试。");
    return;
  }

  elements.estimateTitle.textContent = `${estimate.calories} kcal`;
  elements.sourcePill.textContent = estimate.source === "ai" ? "真实识别" : "演示";
  elements.confidencePill.textContent = `${Math.round(estimate.confidence * 100)}%`;
  elements.foodName.value = estimate.name;
  elements.portion.value = estimate.portion;
  elements.portionUnit.value = estimate.unit;
  elements.calories.value = estimate.calories;
  elements.mealType.value = estimate.mealType;
  elements.notes.value = estimate.notes;
  elements.mealForm.hidden = false;
  elements.analyzeButton.textContent = "重新估算";
  elements.analyzeButton.disabled = false;
  elements.mealForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function guessMealType(date = new Date()) {
  const hour = date.getHours();
  if (hour < 10) return "早餐";
  if (hour < 15) return "午餐";
  if (hour < 21) return "晚餐";
  return "加餐";
}

function addRecord(event) {
  event.preventDefault();
  const record = {
    id: getRecordId(),
    image: state.currentImage,
    foodName: elements.foodName.value.trim(),
    calories: Number(elements.calories.value),
    portion: Number(elements.portion.value),
    portionUnit: elements.portionUnit.value,
    mealType: elements.mealType.value,
    notes: elements.notes.value.trim(),
    confidence: state.lastEstimate?.confidence ?? null,
    source: state.lastEstimate?.source ?? "manual",
    createdAt: new Date().toISOString()
  };

  state.records.unshift(record);
  const savedWithImage = saveRecords();
  if (!savedWithImage) {
    record.image = "";
    const savedWithoutImage = saveRecords();
    if (!savedWithoutImage) {
      state.records.shift();
      showStatus("保存失败：浏览器本地存储不可用。可以先截图记录，或换用 GitHub Pages 的 HTTPS 地址再试。");
      return;
    }
    showStatus("已保存记录，但手机浏览器空间不足，照片没有一起保存。");
  } else {
    showStatus("已保存到历史记录。");
  }
  resetCapture();
  render();
  switchTab("history");
}

function getRecordId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resetCapture() {
  state.currentImage = "";
  state.lastEstimate = null;
  elements.photoInput.value = "";
  elements.photoPreview.removeAttribute("src");
  elements.photoPreview.style.display = "none";
  elements.emptyPreview.style.display = "grid";
  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "开始估算";
  elements.mealForm.hidden = true;
}

function sameLocalDate(dateA, dateB) {
  return dateA.toDateString() === dateB.toDateString();
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getDailyTotals(days = 7) {
  const today = startOfDay(new Date());
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    const total = state.records
      .filter((record) => sameLocalDate(new Date(record.createdAt), date))
      .reduce((sum, record) => sum + record.calories, 0);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      total
    };
  });
}

function render() {
  const today = new Date();
  const dailyTotals = getDailyTotals(7);
  const todayTotal = state.records
    .filter((record) => sameLocalDate(new Date(record.createdAt), today))
    .reduce((sum, record) => sum + record.calories, 0);
  const weekTotal = dailyTotals.reduce((sum, day) => sum + day.total, 0);

  elements.todayCalories.textContent = Math.round(todayTotal);
  elements.weekCalories.textContent = Math.round(weekTotal);
  elements.averageCalories.textContent = Math.round(weekTotal / 7);
  elements.recordCount.textContent = state.records.length;
  renderHistory();
  renderInsight(dailyTotals);
  drawTrendChart();
}

function renderHistory() {
  if (state.records.length === 0) {
    elements.historyList.innerHTML = '<div class="empty-state">还没有记录。拍照估算并保存后，记录会出现在这里。</div>';
    return;
  }

  elements.historyList.innerHTML = state.records
    .map((record) => {
      const date = new Date(record.createdAt);
      const confidence = record.confidence ? ` · 可信度 ${Math.round(record.confidence * 100)}%` : "";
      const note = record.notes ? ` · ${escapeHtml(record.notes)}` : "";
      const imageMarkup = record.image
        ? `<img class="history-thumb" src="${record.image}" alt="${escapeHtml(record.foodName)}" />`
        : `<div class="history-thumb placeholder" aria-hidden="true">无照片</div>`;
      return `
        <article class="history-item">
          ${imageMarkup}
          <div class="history-main">
            <strong>${escapeHtml(record.foodName)}</strong>
            <div class="history-meta">${record.mealType} · ${record.portion}${record.portionUnit}${confidence}</div>
            <div class="history-meta">${formatDate(date)}${note}</div>
          </div>
          <div class="calorie-tag">${record.calories}<br />kcal</div>
        </article>
      `;
    })
    .join("");
}

function renderInsight(dailyTotals) {
  if (state.records.length < 2) {
    elements.insightText.textContent = "保存至少两条记录后，会根据近期热量走势生成建议。";
    return;
  }

  const weekTotal = dailyTotals.reduce((sum, day) => sum + day.total, 0);
  const average = Math.round(weekTotal / 7);
  const maxDay = dailyTotals.reduce((max, day) => (day.total > max.total ? day : max), dailyTotals[0]);
  const topMeal = getTopMealType();

  elements.insightText.textContent = `近 7 日平均每天 ${average} kcal，最高的一天是 ${maxDay.label}（${maxDay.total} kcal）。目前 ${topMeal} 占比最高，可优先优化这类餐食的份量或搭配。`;
}

function getTopMealType() {
  const totals = state.records.reduce((acc, record) => {
    acc[record.mealType] = (acc[record.mealType] || 0) + record.calories;
    return acc;
  }, {});

  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || "餐食";
}

function drawTrendChart() {
  const canvas = elements.trendChart;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = 180 * ratio;
  context.scale(ratio, ratio);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const padding = 28;
  const totals = getDailyTotals(7);
  const max = Math.max(800, ...totals.map((day) => day.total));
  const barWidth = (width - padding * 2) / totals.length - 8;

  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#e1dbcf";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, height - padding);
  context.lineTo(width - padding, height - padding);
  context.stroke();

  totals.forEach((day, index) => {
    const x = padding + index * (barWidth + 8) + 4;
    const barHeight = (day.total / max) * (height - padding * 2);
    const y = height - padding - barHeight;
    context.fillStyle = day.total > 0 ? "#1b7f64" : "#d8d0c4";
    roundRect(context, x, y, barWidth, Math.max(5, barHeight), 5);
    context.fill();
    context.fillStyle = "#71766f";
    context.font = "11px system-ui";
    context.textAlign = "center";
    context.fillText(day.label, x + barWidth / 2, height - 8);
  });
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function exportRecords() {
  const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `calorie-records-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearRecords() {
  const confirmed = window.confirm("确定清空所有本地记录吗？此操作无法撤销。");
  if (!confirmed) return;

  state.records = [];
  saveRecords();
  render();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

elements.tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
elements.photoInput.addEventListener("change", handlePhotoChange);
elements.analyzeButton.addEventListener("click", analyzeCurrentPhoto);
elements.mealForm.addEventListener("submit", addRecord);
elements.exportButton.addEventListener("click", exportRecords);
elements.clearButton.addEventListener("click", clearRecords);
window.addEventListener("resize", drawTrendChart);

render();
