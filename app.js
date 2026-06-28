const STORAGE_KEY = "calorie-camera-records-v1";
const API_ENDPOINT = "/api/analyze-food";
let firebaseApi = null;

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
  lastEstimate: null,
  currentComponents: [],
  capturedAt: null,
  editingRecordId: null
};

const elements = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    capture: document.querySelector("#captureView"),
    history: document.querySelector("#historyView"),
    insights: document.querySelector("#insightsView"),
    account: document.querySelector("#accountView")
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
  componentList: document.querySelector("#componentList"),
  addComponentButton: document.querySelector("#addComponentButton"),
  mealType: document.querySelector("#mealType"),
  notes: document.querySelector("#notes"),
  saveRecordButton: document.querySelector("#saveRecordButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  todayCalories: document.querySelector("#todayCalories"),
  weekCalories: document.querySelector("#weekCalories"),
  averageCalories: document.querySelector("#averageCalories"),
  recordCount: document.querySelector("#recordCount"),
  historyList: document.querySelector("#historyList"),
  historyRange: document.querySelector("#historyRange"),
  historySearch: document.querySelector("#historySearch"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  trendChart: document.querySelector("#trendChart"),
  insightText: document.querySelector("#insightText"),
  statusMessage: document.querySelector("#statusMessage"),
  cloudStatus: document.querySelector("#cloudStatus"),
  authForm: document.querySelector("#authForm"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  signInButton: document.querySelector("#signInButton"),
  signUpButton: document.querySelector("#signUpButton"),
  signOutButton: document.querySelector("#signOutButton"),
  syncLocalButton: document.querySelector("#syncLocalButton"),
  accountSummary: document.querySelector("#accountSummary"),
  accountEmail: document.querySelector("#accountEmail")
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(normalizeRecord);
  } catch {
    return [];
  }
}

function normalizeRecord(record) {
  const calories = Math.round(Number(record.calories) || 0);
  return {
    ...record,
    components: normalizeComponents(record.components, record.foodName, calories),
    mealType: normalizeMealType(record.mealType || "午餐"),
    calories
  };
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

async function initializeCloud() {
  try {
    firebaseApi = await import("./firebase.js");
    firebaseApi.watchAuth(handleAuthChange);
  } catch (error) {
    firebaseApi = null;
    elements.cloudStatus.textContent = "本地模式";
    console.info("Firebase is not configured; using local storage only.", error);
  }
}

async function handleAuthChange(user) {
  if (!user) {
    elements.cloudStatus.textContent = "本地模式";
    elements.authForm.hidden = false;
    elements.accountSummary.hidden = true;
    render();
    return;
  }

  elements.cloudStatus.textContent = "云端同步";
  elements.authForm.hidden = true;
  elements.accountSummary.hidden = false;
  elements.accountEmail.textContent = user.email;

  try {
    state.records = (await firebaseApi.loadCloudRecords(user.uid)).map(normalizeRecord);
    saveRecords();
    render();
    showStatus("已加载云端历史记录。");
  } catch (error) {
    showStatus(`云端历史加载失败：${error.message}`);
  }
}

async function signInUser() {
  if (!firebaseApi) {
    showStatus("Firebase 尚未配置，当前只能使用本地模式。");
    return;
  }

  try {
    await firebaseApi.signIn(elements.authEmail.value.trim(), elements.authPassword.value);
  } catch (error) {
    showStatus(`登录失败：${error.message}`);
  }
}

async function signUpUser() {
  if (!firebaseApi) {
    showStatus("Firebase 尚未配置，当前只能使用本地模式。");
    return;
  }

  try {
    await firebaseApi.signUp(elements.authEmail.value.trim(), elements.authPassword.value);
  } catch (error) {
    showStatus(`注册失败：${error.message}`);
  }
}

async function signOutCurrentUser() {
  if (!firebaseApi) return;
  await firebaseApi.signOutUser();
  showStatus("已退出账号，当前使用本地历史。");
}

async function syncLocalRecordsToCloud() {
  const user = firebaseApi?.getCurrentUser();
  if (!user) {
    showStatus("请先登录再同步本机历史。");
    return;
  }

  try {
    await Promise.all(state.records.map((record) => firebaseApi.saveCloudRecord(user.uid, record)));
    showStatus(`已同步 ${state.records.length} 条本机历史到云端。`);
  } catch (error) {
    showStatus(`同步失败：${error.message}`);
  }
}

async function persistRecord(record) {
  saveRecords();
  const user = firebaseApi?.getCurrentUser();
  if (user) await firebaseApi.saveCloudRecord(user.uid, record);
}

async function removePersistedRecord(recordId) {
  saveRecords();
  const user = firebaseApi?.getCurrentUser();
  if (user) await firebaseApi.deleteCloudRecord(user.uid, recordId);
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
      components: [
        { name: selected.name, weightGrams: selected.unit === "克" ? selected.portion : 0, caloriesKcal: calories }
      ],
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
  const calories = clampNumber(data.caloriesKcal ?? data.calories, 0, 5000, 0);
  return {
    isFood: Boolean(data.isFood),
    name: data.foodName || data.name || "待确认食物",
    calories,
    unit: data.portionUnit || "份",
    portion: clampNumber(data.portion, 0.1, 20, 1),
    confidence: clampNumber(data.confidence, 0, 1, 0.5),
    mealType: normalizeMealType(data.mealTypeSuggestion || guessMealType()),
    components: normalizeComponents(data.components, data.foodName || data.name, calories),
    notes: data.notes || "",
    source: data.source || fallbackSource
  };
}

function normalizeComponents(components, fallbackName, fallbackCalories) {
  const items = Array.isArray(components) ? components : [];
  const normalized = items
    .map((item) => ({
      name: String(item.name || "").trim() || "组成",
      weightGrams: Math.round(clampNumber(item.weightGrams, 0, 3000, 0)),
      caloriesKcal: Math.round(clampNumber(item.caloriesKcal ?? item.calories, 0, 5000, 0))
    }))
    .filter((item) => item.name && (item.weightGrams > 0 || item.caloriesKcal > 0))
    .slice(0, 8);

  if (normalized.length > 0) return normalized;
  return [{
    name: fallbackName || "整份餐食",
    weightGrams: 0,
    caloriesKcal: Math.round(clampNumber(fallbackCalories, 0, 5000, 0))
  }];
}

function normalizeMealType(value) {
  if (value === "加餐") return "零食";
  return ["早餐", "午餐", "晚餐", "零食", "宵夜"].includes(value) ? value : guessMealType();
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
  state.capturedAt = new Date().toISOString();
  state.editingRecordId = null;

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
  state.currentComponents = normalizeComponents(estimate.components, estimate.name, estimate.calories);
  renderComponents();
  elements.notes.value = estimate.notes;
  elements.mealForm.hidden = false;
  elements.cancelEditButton.hidden = true;
  elements.saveRecordButton.textContent = `保存为${estimate.mealType}摄入`;
  elements.analyzeButton.textContent = "重新估算";
  elements.analyzeButton.disabled = false;
  showStatus(`已根据拍摄时间建议保存为${estimate.mealType}。确认后可保存为当天摄入记录。`);
  elements.mealForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function guessMealType(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 10) return "早餐";
  if (hour >= 10 && hour < 14) return "午餐";
  if (hour >= 14 && hour < 17) return "零食";
  if (hour >= 17 && hour < 21) return "晚餐";
  return "宵夜";
}

function addRecord(event) {
  event.preventDefault();
  saveRecordFromForm();
}

async function saveRecordFromForm() {
  syncComponentsFromDom();
  syncCaloriesFromComponents();
  const existingRecord = state.records.find((item) => item.id === state.editingRecordId);
  const record = {
    id: existingRecord?.id || getRecordId(),
    image: state.currentImage || existingRecord?.image || "",
    foodName: elements.foodName.value.trim(),
    calories: Number(elements.calories.value),
    portion: Number(elements.portion.value),
    portionUnit: elements.portionUnit.value,
    mealType: elements.mealType.value,
    notes: elements.notes.value.trim(),
    components: state.currentComponents,
    confidence: state.lastEstimate?.confidence ?? null,
    source: state.lastEstimate?.source ?? "manual",
    createdAt: existingRecord?.createdAt || state.capturedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingRecord) {
    state.records = state.records.map((item) => (item.id === record.id ? record : item));
  } else {
    state.records.unshift(record);
  }

  let savedWithImage = true;
  try {
    await persistRecord(record);
  } catch (error) {
    console.warn(error);
    savedWithImage = false;
  }

  if (!savedWithImage) {
    record.image = "";
    let savedWithoutImage = true;
    try {
      await persistRecord(record);
    } catch (error) {
      console.warn(error);
      savedWithoutImage = false;
    }

    if (!savedWithoutImage) {
      if (existingRecord) {
        state.records = state.records.map((item) => (item.id === existingRecord.id ? existingRecord : item));
      } else {
        state.records.shift();
      }
      showStatus("保存失败：浏览器本地存储不可用。可以先截图记录，或换用 GitHub Pages 的 HTTPS 地址再试。");
      return;
    }
    showStatus("已保存记录，但手机浏览器空间不足，照片没有一起保存。");
  } else {
    showStatus(existingRecord ? "已更新历史记录。" : "已保存到历史记录。");
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
  state.currentComponents = [];
  state.capturedAt = null;
  state.editingRecordId = null;
  elements.photoInput.value = "";
  elements.photoPreview.removeAttribute("src");
  elements.photoPreview.style.display = "none";
  elements.emptyPreview.style.display = "grid";
  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "开始估算";
  elements.mealForm.hidden = true;
  elements.cancelEditButton.hidden = true;
  elements.saveRecordButton.textContent = "保存为今日摄入";
  elements.componentList.innerHTML = "";
}

function renderComponents() {
  elements.componentList.innerHTML = state.currentComponents
    .map((component, index) => `
      <div class="component-row" data-component-index="${index}">
        <label>
          名称
          <input data-component-field="name" value="${escapeHtml(component.name)}" />
        </label>
        <label>
          克
          <input data-component-field="weightGrams" inputmode="numeric" min="0" type="number" value="${component.weightGrams}" />
        </label>
        <label>
          kcal
          <input data-component-field="caloriesKcal" inputmode="numeric" min="0" type="number" value="${component.caloriesKcal}" />
        </label>
        <button class="component-remove" data-component-remove="${index}" type="button" aria-label="删除组成">×</button>
      </div>
    `)
    .join("");
}

function addComponent() {
  syncComponentsFromDom();
  state.currentComponents.push({ name: "新增组成", weightGrams: 0, caloriesKcal: 0 });
  renderComponents();
}

function removeComponent(index) {
  syncComponentsFromDom();
  state.currentComponents.splice(index, 1);
  if (state.currentComponents.length === 0) {
    state.currentComponents.push({ name: elements.foodName.value.trim() || "整份餐食", weightGrams: 0, caloriesKcal: Number(elements.calories.value) || 0 });
  }
  renderComponents();
  syncCaloriesFromComponents();
}

function syncComponentsFromDom() {
  const rows = [...elements.componentList.querySelectorAll(".component-row")];
  state.currentComponents = rows.map((row) => ({
    name: row.querySelector('[data-component-field="name"]').value.trim() || "组成",
    weightGrams: Math.round(clampNumber(row.querySelector('[data-component-field="weightGrams"]').value, 0, 3000, 0)),
    caloriesKcal: Math.round(clampNumber(row.querySelector('[data-component-field="caloriesKcal"]').value, 0, 5000, 0))
  }));
}

function syncCaloriesFromComponents() {
  const total = state.currentComponents.reduce((sum, item) => sum + Number(item.caloriesKcal || 0), 0);
  if (total > 0) {
    elements.calories.value = Math.round(total);
    elements.estimateTitle.textContent = `${Math.round(total)} kcal`;
  }
}

function handleComponentInput(event) {
  if (!event.target.matches("[data-component-field]")) return;
  syncComponentsFromDom();
  if (event.target.dataset.componentField === "caloriesKcal") syncCaloriesFromComponents();
}

function editRecord(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;

  state.editingRecordId = record.id;
  state.currentImage = record.image || "";
  state.capturedAt = record.createdAt;
  state.lastEstimate = {
    confidence: record.confidence,
    source: record.source || "manual"
  };
  state.currentComponents = normalizeComponents(record.components, record.foodName, record.calories);

  if (record.image) {
    elements.photoPreview.src = record.image;
    elements.photoPreview.style.display = "block";
    elements.emptyPreview.style.display = "none";
  }

  elements.estimateTitle.textContent = `${record.calories} kcal`;
  elements.sourcePill.textContent = record.source === "ai" ? "真实识别" : "手动";
  elements.confidencePill.textContent = record.confidence ? `${Math.round(record.confidence * 100)}%` : "--";
  elements.foodName.value = record.foodName;
  elements.portion.value = record.portion;
  elements.portionUnit.value = record.portionUnit;
  elements.calories.value = record.calories;
  elements.mealType.value = normalizeMealType(record.mealType);
  elements.notes.value = record.notes || "";
  renderComponents();

  elements.mealForm.hidden = false;
  elements.cancelEditButton.hidden = false;
  elements.saveRecordButton.textContent = "保存修改";
  elements.analyzeButton.disabled = false;
  elements.analyzeButton.textContent = "重新估算";
  switchTab("capture");
  showStatus("正在编辑历史记录。保存后会更新原记录。");
  elements.mealForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteRecord(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  const confirmed = window.confirm(`删除「${record.foodName}」这条记录？`);
  if (!confirmed) return;
  state.records = state.records.filter((item) => item.id !== recordId);
  removePersistedRecord(recordId)
    .then(() => render())
    .catch((error) => showStatus(`删除失败：${error.message}`));
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
  const records = getVisibleHistoryRecords();
  if (records.length === 0) {
    elements.historyList.innerHTML = '<div class="empty-state">还没有记录。拍照估算并保存后，记录会出现在这里。</div>';
    return;
  }

  elements.historyList.innerHTML = records
    .map((record) => {
      const date = new Date(record.createdAt);
      const confidence = record.confidence ? ` · 可信度 ${Math.round(record.confidence * 100)}%` : "";
      const note = record.notes ? ` · ${escapeHtml(record.notes)}` : "";
      const components = normalizeComponents(record.components, record.foodName, record.calories);
      const summary = components
        .map((item) => `${escapeHtml(item.name)} ${item.weightGrams ? `${item.weightGrams}g` : ""} ${item.caloriesKcal}kcal`)
        .join(" / ");
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
            <div class="component-summary">${summary}</div>
            <div class="history-actions">
              <button class="text-action" data-history-edit="${record.id}" type="button">编辑</button>
              <button class="text-action danger" data-history-delete="${record.id}" type="button">删除</button>
            </div>
          </div>
          <div class="calorie-tag">${record.calories}<br />kcal</div>
        </article>
      `;
    })
    .join("");
}

function getVisibleHistoryRecords() {
  const range = elements.historyRange.value;
  const query = elements.historySearch.value.trim().toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return state.records.filter((record) => {
    const recordTime = new Date(record.createdAt).getTime();
    const inRange = range === "all" || now - recordTime <= Number(range) * dayMs;
    const text = `${record.foodName} ${record.notes || ""} ${record.mealType}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    return inRange && matchesQuery;
  });
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
elements.mealType.addEventListener("change", () => {
  if (!state.editingRecordId) elements.saveRecordButton.textContent = `保存为${elements.mealType.value}摄入`;
});
elements.addComponentButton.addEventListener("click", addComponent);
elements.componentList.addEventListener("input", handleComponentInput);
elements.componentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-component-remove]");
  if (!button) return;
  removeComponent(Number(button.dataset.componentRemove));
});
elements.cancelEditButton.addEventListener("click", () => {
  resetCapture();
  showStatus("已取消编辑。");
});
elements.historyRange.addEventListener("change", renderHistory);
elements.historySearch.addEventListener("input", renderHistory);
elements.historyList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-history-edit]");
  if (editButton) {
    editRecord(editButton.dataset.historyEdit);
    return;
  }

  const deleteButton = event.target.closest("[data-history-delete]");
  if (deleteButton) deleteRecord(deleteButton.dataset.historyDelete);
});
elements.signInButton.addEventListener("click", signInUser);
elements.signUpButton.addEventListener("click", signUpUser);
elements.signOutButton.addEventListener("click", signOutCurrentUser);
elements.syncLocalButton.addEventListener("click", syncLocalRecordsToCloud);
elements.exportButton.addEventListener("click", exportRecords);
elements.clearButton.addEventListener("click", clearRecords);
window.addEventListener("resize", drawTrendChart);

render();
initializeCloud();
