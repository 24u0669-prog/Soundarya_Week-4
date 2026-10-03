const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const colors = ["#45a879", "#e78a55", "#e0b747", "#e17d79", "#579ab0", "#8c79bf"];
const icons = { food: "⌁", travel: "↗", health: "✚", shopping: "◇", general: "◈" };
const expenseDialog = document.querySelector("#expense-dialog");
const categoryDialog = document.querySelector("#category-dialog");
const expenseForm = document.querySelector("#expense-form");
const authScreen = document.querySelector("#auth-screen");
const appRoot = document.querySelector("#app-root");
const authForm = document.querySelector("#auth-form");
let allCategories = [];
let expenses = [];
let toastTimer;
let accountNeedsSetup = false;

function money(value) {
  return currency.format(Number(value || 0));
}

async function request(url, options = {}) {
  if (location.hostname.endsWith("github.io")) {
    return requestStaticDemo(url, options);
  }
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

const staticDataKey = "spendwise.pages.data.v1";
const staticSessionKey = "spendwise.pages.session.v1";

function staticData() {
  const saved = localStorage.getItem(staticDataKey);
  const data = saved ? JSON.parse(saved) : { passwordHash: "", categories: ["General"], expenses: [] };
  if (!Array.isArray(data.categories) || !Array.isArray(data.expenses)) {
    throw new Error("Saved browser data is invalid. Clear this site's data to start over.");
  }
  return data;
}

function saveStaticData(data) {
  localStorage.setItem(staticDataKey, JSON.stringify(data));
}

function staticError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function passwordHash(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function staticExpenseInput(options) {
  return Object.fromEntries(new URLSearchParams(options.body || "").entries());
}

async function requestStaticDemo(url, options = {}) {
  const parsed = new URL(url, location.href);
  const method = options.method || "GET";
  const path = parsed.pathname.replace(/^\/Soundarya_Week-4/, "");
  const data = staticData();
  const isAuthenticated = sessionStorage.getItem(staticSessionKey) === "yes";

  if (path === "/api/auth/status" && method === "GET") {
    return { setupRequired: !data.passwordHash, authenticated: isAuthenticated };
  }
  if (path === "/api/auth/setup" && method === "POST") {
    const input = staticExpenseInput(options);
    if (data.passwordHash) throw staticError("A diary password is already set in this browser.");
    if (!input.password || input.password.length < 12) {
      throw staticError("Use a password with at least 12 characters.");
    }
    if (input.password !== input.confirmPassword) throw staticError("The passwords do not match.");
    data.passwordHash = await passwordHash(input.password);
    saveStaticData(data);
    sessionStorage.setItem(staticSessionKey, "yes");
    return { success: true };
  }
  if (path === "/api/auth/login" && method === "POST") {
    const input = staticExpenseInput(options);
    if (!data.passwordHash || await passwordHash(input.password || "") !== data.passwordHash) {
      throw staticError("That password was not recognized.", 401);
    }
    sessionStorage.setItem(staticSessionKey, "yes");
    return { success: true };
  }
  if (path === "/api/auth/logout" && method === "POST") {
    sessionStorage.removeItem(staticSessionKey);
    return { success: true };
  }
  if (!isAuthenticated) throw staticError("Please log in to view your expense diary.", 401);

  if (path === "/api/dashboard" && method === "GET") {
    const params = parsed.searchParams;
    const filtered = filterStaticExpenses(data.expenses, params);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const currentMonth = sumStaticExpenses(data.expenses.filter((item) => item.date.startsWith(monthKey)));
    const previousMonth = sumStaticExpenses(data.expenses.filter((item) => item.date.startsWith(previousMonthKey)));
    const totals = new Map();
    filtered.forEach((item) => totals.set(item.category, (totals.get(item.category) || 0) + Number(item.amount)));
    const categoryBreakdown = [...totals].map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    return {
      expenses: filtered,
      categories: data.categories,
      total: sumStaticExpenses(filtered),
      currentMonth,
      previousMonth,
      monthChangePercent: previousMonth ? Math.round((currentMonth - previousMonth) / previousMonth * 1000) / 10 : 0,
      categoryBreakdown,
      currency: "INR",
    };
  }
  if (path === "/api/expenses" && method === "POST") {
    const input = staticExpenseInput(options);
    validateStaticExpense(input, data);
    const expense = { ...input, id: crypto.randomUUID().slice(0, 8), amount: Number(input.amount) };
    data.expenses.push(expense);
    saveStaticData(data);
    return { expense };
  }
  if (path === "/api/expenses" && method === "PUT") {
    const input = staticExpenseInput(options);
    const index = data.expenses.findIndex((item) => item.id === input.id);
    if (index < 0) throw staticError("Expense not found.", 404);
    validateStaticExpense(input, data);
    data.expenses[index] = { ...data.expenses[index], ...input, time: input.time || data.expenses[index].time, amount: Number(input.amount) };
    saveStaticData(data);
    return { expense: data.expenses[index] };
  }
  if (path === "/api/expenses" && method === "DELETE") {
    const id = parsed.searchParams.get("id");
    const remaining = data.expenses.filter((item) => item.id !== id);
    if (remaining.length === data.expenses.length) throw staticError("Expense not found.", 404);
    data.expenses = remaining;
    saveStaticData(data);
    return { success: true };
  }
  if (path === "/api/categories" && method === "POST") {
    const name = staticExpenseInput(options).name?.trim();
    if (!name || name.length > 40) throw staticError("Enter a category name up to 40 characters.");
    if (data.categories.some((item) => item.toLowerCase() === name.toLowerCase())) {
      throw staticError("That category already exists.");
    }
    data.categories.push(name);
    data.categories.sort((a, b) => a.localeCompare(b));
    saveStaticData(data);
    return { category: name };
  }
  if (path === "/api/categories" && method === "DELETE") {
    const name = parsed.searchParams.get("name");
    if (data.expenses.some((item) => item.category === name)) {
      throw staticError("Delete or reassign this category's expenses first.");
    }
    data.categories = data.categories.filter((item) => item !== name);
    saveStaticData(data);
    return { success: true };
  }
  throw staticError("Unsupported API route or method.", 404);
}

function filterStaticExpenses(items, params) {
  const query = (params.get("q") || "").trim().toLowerCase();
  const category = (params.get("category") || "").trim().toLowerCase();
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  return items.filter((item) =>
    (!category || item.category.toLowerCase() === category)
    && (!query || item.description.toLowerCase().includes(query) || item.category.toLowerCase().includes(query))
    && (!from || item.date >= from)
    && (!to || item.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time || "").localeCompare(a.time || ""));
}

function sumStaticExpenses(items) {
  return items.reduce((total, item) => total + Number(item.amount), 0);
}

function validateStaticExpense(input, data) {
  if (!input.description?.trim() || input.description.trim().length > 200) {
    throw staticError("Enter a description up to 200 characters.");
  }
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    throw staticError("Enter an amount greater than zero.");
  }
  if (!input.date || !data.categories.includes(input.category)) {
    throw staticError("Choose a valid date and existing category.");
  }
}

function paramsFromFilters() {
  const params = new URLSearchParams();
  const fields = {
    q: document.querySelector("#search-filter").value.trim(),
    category: document.querySelector("#category-filter").value,
    from: document.querySelector("#from-filter").value,
    to: document.querySelector("#to-filter").value,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value) params.set(key, value);
  }
  return params;
}

async function refreshDashboard() {
  const params = paramsFromFilters();
  const dashboard = await request(`/api/dashboard?${params.toString()}`);
  expenses = dashboard.expenses;
  allCategories = dashboard.categories;
  render(dashboard);
}

function render(dashboard) {
  document.querySelector("#total-spending").textContent = money(dashboard.total);
  document.querySelector("#month-spending").textContent = money(dashboard.currentMonth);
  document.querySelector("#transaction-count").textContent = expenses.length;
  document.querySelector("#shown-count").textContent = expenses.length;
  document.querySelector("#category-count").textContent = allCategories.length;
  document.querySelector("#category-total").textContent = money(dashboard.total);
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date());
  document.querySelector("#today-label").textContent = today;
  document.querySelector("#hero-date").textContent = `Your overview · ${today}`;

  const change = Number(dashboard.monthChangePercent);
  const changeElement = document.querySelector("#month-change");
  if (Number(dashboard.previousMonth) === 0) {
    changeElement.className = "trend neutral";
    changeElement.textContent = "—";
  } else {
    changeElement.className = `trend ${change > 0 ? "up" : change < 0 ? "down" : "neutral"}`;
    changeElement.textContent = `${change > 0 ? "+" : ""}${change}%`;
  }

  renderCategories(dashboard.categoryBreakdown, Number(dashboard.total));
  renderExpenses(expenses);
  updateCategorySelects();
}

function renderCategories(items, total) {
  const container = document.querySelector("#category-list");
  const donut = document.querySelector("#category-donut");
  if (!items.length) {
    container.innerHTML = '<div class="category-empty">Your category insights will show here.</div>';
    donut.style.background = "conic-gradient(#334a43 0 100%)";
    donut.setAttribute("aria-label", "No expenses in the current selection");
    return;
  }
  let position = 0;
  const gradient = items.map((item, index) => {
    const start = position;
    position += Number(item.total) / total * 100;
    return `${colors[index % colors.length]} ${start}% ${position}%`;
  });
  donut.style.background = `conic-gradient(${gradient.join(", ")})`;
  donut.setAttribute("aria-label", items.map((item) =>
    `${item.category}: ${money(item.total)}`).join(", "));
  container.innerHTML = items.map((item, index) => {
    const percent = total ? Math.round((Number(item.total) / total) * 100) : 0;
    const color = colors[index % colors.length];
    return `<div class="category-row">
      <div class="category-row-head">
        <span class="category-name"><span class="category-dot" style="background:${color}"></span>${escapeHtml(item.category)}</span>
        <span class="category-amount">${money(item.total)}</span>
      </div>
      <div class="progress-track"><div class="progress-bar" style="width:${percent}%;background:${color}"></div></div>
    </div>`;
  }).join("");
}

function renderExpenses(items) {
  const body = document.querySelector("#expense-rows");
  const empty = document.querySelector("#empty-state");
  let lastDate = "";
  body.innerHTML = items.map((expense) => {
    const name = expense.category.toLowerCase();
    const icon = Object.entries(icons).find(([key]) => name.includes(key))?.[1] || "◈";
    const date = new Date(`${expense.date}T00:00:00`);
    const dateText = new Intl.DateTimeFormat("en-IN", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(date);
    const dayHeading = expense.date !== lastDate
      ? `<tr class="diary-day"><td colspan="5"><time datetime="${escapeHtml(expense.date)}">${escapeHtml(dateText)}</time></td></tr>`
      : "";
    lastDate = expense.date;
    const timeText = expense.time
      ? new Intl.DateTimeFormat("en-IN", {
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(new Date(`${expense.date}T${expense.time}`))
      : "";
    const timeCell = timeText
      ? `<time datetime="${escapeHtml(`${expense.date}T${expense.time}`)}">${escapeHtml(timeText)}</time>`
      : '<span class="time-unrecorded">Time not recorded</span>';
    return `${dayHeading}<tr>
      <td><div class="description-cell"><span class="transaction-icon ${iconClass(name)}">${icon}</span>${escapeHtml(expense.description)}</div></td>
      <td><span class="category-chip">${escapeHtml(expense.category)}</span></td>
      <td class="time-cell">${timeCell}</td>
      <td class="amount-cell">${money(expense.amount)}</td>
      <td class="row-actions"><button class="row-action" title="Edit expense" aria-label="Edit expense" data-edit="${escapeHtml(expense.id)}">✎</button><button class="row-action" title="Delete expense" aria-label="Delete expense" data-delete="${escapeHtml(expense.id)}">×</button></td>
    </tr>`;
  }).join("");
  empty.classList.toggle("visible", items.length === 0);
  document.querySelector("#table-caption").textContent =
    items.length ? `${items.length} transaction${items.length === 1 ? "" : "s"}` : "No transactions yet";

  body.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEdit(button.dataset.edit)));
  body.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteExpense(button.dataset.delete)));
}

function iconClass(category) {
  if (category.includes("food")) return "food";
  if (category.includes("travel")) return "travel";
  if (category.includes("health")) return "health";
  return "";
}

function updateCategorySelects() {
  const filter = document.querySelector("#category-filter");
  const selected = filter.value;
  filter.innerHTML = '<option value="">All categories</option>' +
    allCategories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  filter.value = allCategories.some((name) => name.toLowerCase() === selected.toLowerCase()) ? selected : "";
  const editor = expenseForm.elements.category;
  const editorValue = editor.value;
  editor.innerHTML = allCategories.map((name) =>
    `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if (allCategories.includes(editorValue)) editor.value = editorValue;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function openAdd() {
  expenseForm.reset();
  expenseForm.elements.id.value = "";
  const now = new Date();
  expenseForm.elements.date.value = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10);
  expenseForm.elements.time.value = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  document.querySelector("#form-title").textContent = "Add an expense";
  document.querySelector("#save-expense").innerHTML = "Save expense <span>→</span>";
  document.querySelector("#form-error").textContent = "";
  updateCategorySelects();
  expenseDialog.showModal();
}

function openEdit(id) {
  const expense = expenses.find((item) => item.id === id);
  if (!expense) return;
  updateCategorySelects();
  expenseForm.elements.id.value = expense.id;
  expenseForm.elements.description.value = expense.description;
  expenseForm.elements.amount.value = expense.amount;
  expenseForm.elements.date.value = expense.date;
  expenseForm.elements.time.value = expense.time || "";
  expenseForm.elements.category.value = expense.category;
  document.querySelector("#form-title").textContent = "Edit expense";
  document.querySelector("#save-expense").innerHTML = "Save changes <span>→</span>";
  document.querySelector("#form-error").textContent = "";
  expenseDialog.showModal();
}

async function deleteExpense(id) {
  if (!window.confirm("Delete this expense? This cannot be undone.")) return;
  try {
    await request(`/api/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    showToast("Expense deleted.");
    await refreshDashboard();
  } catch (error) {
    showToast(error.message);
  }
}

function openCategoryDialog() {
  document.querySelector("#category-error").textContent = "";
  document.querySelector("#category-form").reset();
  renderManagedCategories();
  categoryDialog.showModal();
}

function renderManagedCategories() {
  document.querySelector("#category-items").innerHTML = allCategories.map((name) => {
    const inUse = expenses.some((expense) => expense.category === name);
    return `<div class="managed-category"><span>${escapeHtml(name)}</span>
      <button type="button" data-remove-category="${escapeHtml(name)}" ${inUse ? "disabled title=\"Category is in use\"" : ""}>${inUse ? "In use" : "Remove"}</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-remove-category]:not(:disabled)").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await request(`/api/categories?name=${encodeURIComponent(button.dataset.removeCategory)}`, { method: "DELETE" });
        showToast("Category removed.");
        await refreshDashboard();
        renderManagedCategories();
      } catch (error) {
        document.querySelector("#category-error").textContent = error.message;
      }
    });
  });
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelector("#open-expense").addEventListener("click", openAdd);
document.querySelector("#empty-add").addEventListener("click", openAdd);
document.querySelector("#refresh-button").addEventListener("click", () => refreshDashboard().catch((error) => showToast(error.message)));
document.querySelector("#add-category-button").addEventListener("click", openCategoryDialog);
document.querySelector("#manage-categories").addEventListener("click", openCategoryDialog);
document.querySelector("#inline-add-category").addEventListener("click", openCategoryDialog);
document.querySelector("#clear-filters").addEventListener("click", async () => {
  document.querySelector("#search-filter").value = "";
  document.querySelector("#category-filter").value = "";
  document.querySelector("#from-filter").value = "";
  document.querySelector("#to-filter").value = "";
  await refreshDashboard();
});

let filterTimer;
for (const selector of ["#search-filter", "#category-filter", "#from-filter", "#to-filter"]) {
  document.querySelector(selector).addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => refreshDashboard().catch((error) => showToast(error.message)), 180);
  });
}

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(expenseForm).entries());
  const editing = Boolean(values.id);
  const body = new URLSearchParams(values);
  try {
    await request("/api/expenses", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    expenseDialog.close();
    showToast(editing ? "Expense updated." : "Expense added.");
    await refreshDashboard();
  } catch (error) {
    document.querySelector("#form-error").textContent = error.message;
  }
});

document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const categoryName = new FormData(form).get("name").toString().trim();
  const body = new URLSearchParams(new FormData(form));
  try {
    await request("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    categoryDialog.close();
    showToast("Category created.");
    await refreshDashboard();
    renderManagedCategories();
    expenseDialog.showModal();
    expenseForm.elements.category.value = categoryName;
  } catch (error) {
    document.querySelector("#category-error").textContent = error.message;
  }
});

function showAuth(setupRequired, errorMessage = "") {
  accountNeedsSetup = setupRequired;
  appRoot.hidden = true;
  authScreen.hidden = false;
  if (location.hostname.endsWith("github.io")) {
    document.querySelector("#auth-note-text").textContent =
      "Public demo. Your diary is saved only in this browser.";
    document.querySelector("#auth-storage-note").textContent =
      "Browser-only storage; this password does not secure sensitive data.";
  }
  document.querySelector("#auth-eyebrow").textContent =
    setupRequired ? "YOUR PERSONAL SPACE" : "PRIVATE TO THIS DEVICE";
  document.querySelector("#auth-title").textContent =
    setupRequired ? "Create your diary key" : "Welcome back";
  document.querySelector("#auth-intro").textContent = setupRequired
    ? "Set a password to protect the transaction diary on this computer."
    : "Sign in to open your transaction diary.";
  document.querySelector("#auth-confirm-row").hidden = !setupRequired;
  document.querySelector("#auth-confirm-password").required = setupRequired;
  document.querySelector("#auth-password").minLength = setupRequired ? 12 : 1;
  document.querySelector("#auth-password").autocomplete =
    setupRequired ? "new-password" : "current-password";
  document.querySelector("#auth-submit").innerHTML = setupRequired
    ? "Create private diary <span>→</span>"
    : "Open my diary <span>→</span>";
  document.querySelector("#auth-error").textContent = errorMessage;
}

async function openDiary() {
  authScreen.hidden = true;
  appRoot.hidden = false;
  document.querySelector("#demo-banner").hidden = !location.hostname.endsWith("github.io");
  try {
    await refreshDashboard();
  } catch (error) {
    if (error.status === 401) {
      showAuth(false, "Your session ended. Sign in again to continue.");
      return;
    }
    showToast(error.message);
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = new FormData(authForm);
  const body = new URLSearchParams();
  body.set("password", fields.get("password").toString());
  if (accountNeedsSetup) {
    body.set("confirmPassword", fields.get("confirmPassword").toString());
  }
  document.querySelector("#auth-error").textContent = "";
  const action = accountNeedsSetup ? "setup" : "login";
  try {
    await request(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    authForm.reset();
    await openDiary();
  } catch (error) {
    document.querySelector("#auth-error").textContent = error.message;
  }
});

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    button.textContent = isVisible ? "Show" : "Hide";
    button.setAttribute("aria-label", `${isVisible ? "Show" : "Hide"} ${input.name === "confirmPassword" ? "confirm password" : "password"}`);
    button.setAttribute("aria-pressed", String(!isVisible));
  });
});

authForm.addEventListener("reset", () => {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", `Show ${input.name === "confirmPassword" ? "confirm password" : "password"}`);
    button.setAttribute("aria-pressed", "false");
  });
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST" });
    authForm.reset();
    showAuth(false);
    document.querySelector("#auth-password").focus();
  } catch (error) {
    showToast(error.message);
  }
});

async function initialize() {
  document.querySelector("#project-report-link").hidden = !location.hostname.endsWith("github.io");
  try {
    const status = await request("/api/auth/status");
    if (status.authenticated) {
      await openDiary();
    } else {
      showAuth(status.setupRequired);
    }
  } catch (error) {
    showAuth(false, `Couldn't reach the local diary. ${error.message}`);
  }
}

initialize().catch((error) => {
  showAuth(false, `Couldn't open your diary. ${error.message}`);
});
