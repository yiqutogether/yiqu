(function () {
  const config = {
    supabaseUrl: "https://pltebbyumdjojipudwny.supabase.co",
    publishableKey: "sb_publishable_3Db-M-ZwCi5aeaMF0-BBhg_oAoxpLBK",
    inboxBucket: "keyword-tool-inbox",
    productMapUrl: "../assets/product-map.json?v=20260816-report-period",
    maxUploadBytes: 20 * 1024 * 1024
  };

  const storageKey = "yiqu_session";
  const taskStatusClass = {
    "待处理": "status-pending",
    "进行中": "status-running",
    "已完成": "status-done",
    "失败": "status-failed"
  };
  const taskDisplayLabels = {
    "71e93c3f-13d7-4455-97e5-18c7e247a06e": "test"
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function setMessage(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-ok", kind === "ok");
  }

  function friendlyError(error) {
    const message = String(error && (error.message || error.msg || error.error_description || error.error) || error || "");
    if (message.includes("Invalid login credentials")) return "邮箱或密码不对。";
    if (message.includes("User already registered")) return "这个邮箱已经注册过，可以直接登录。";
    if (message.includes("Email not confirmed")) return "邮箱还没确认，请先确认邮箱或关闭邮箱确认。";
    if (message.includes("JWT")) return "登录状态过期，请重新登录。";
    if (message.includes("row-level security")) return "权限被中转台拒绝，请检查登录状态。";
    if (message.includes("Failed to fetch")) return "网络连接失败，请稍后再试。";
    return message || "操作失败，请稍后再试。";
  }

  function session() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveSession(data) {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user
    }));
  }

  function clearSession() {
    localStorage.removeItem(storageKey);
  }

  async function supabaseFetch(path, options = {}, requireAuth = false) {
    const current = session();
    const headers = new Headers(options.headers || {});
    headers.set("apikey", config.publishableKey);
    if (requireAuth) {
      if (!current || !current.access_token) {
        location.href = basePath("index.html");
        throw new Error("请先登录。");
      }
      headers.set("Authorization", `Bearer ${current.access_token}`);
    } else if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${config.publishableKey}`);
    }

    const response = await fetch(`${config.supabaseUrl}${path}`, {
      ...options,
      headers
    });
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {}

    if (!response.ok) {
      throw data || new Error(response.statusText);
    }
    return data;
  }

  function basePath(path) {
    const isNested = location.pathname.includes("/tool/") || location.pathname.includes("/report/");
    return isNested ? `../${path}` : path;
  }

  async function requireUser() {
    const current = session();
    if (!current || !current.access_token) {
      location.href = basePath("index.html");
      return null;
    }
    try {
      const user = await supabaseFetch("/auth/v1/user", { method: "GET" }, true);
      return user;
    } catch (_) {
      clearSession();
      location.href = basePath("index.html");
      return null;
    }
  }

  const productFields = [
    { id: "site", key: "countryCode", label: "站点", required: true },
    { id: "store", key: "store", label: "店铺", required: true },
    { id: "category1", key: "category1", label: "一级分类" },
    { id: "category2", key: "category2", label: "二级分类" },
    { id: "category3", key: "category3", label: "三级分类" },
    { id: "spu", key: "spu", label: "SPU" },
    { id: "sku", key: "sku", label: "SKU" },
    { id: "asin", key: "asin", label: "ASIN", required: true }
  ];

  function normalizeProductValue(value) {
    return String(value == null ? "" : value).trim();
  }

  function selectValue(node) {
    if (!node) return "";
    return normalizeProductValue(node.value);
  }

  function uniqueProducts(rows, key) {
    const map = new Map();
    rows.forEach((row) => {
      const value = normalizeProductValue(row[key]);
      const label = value || "未填写";
      if (!map.has(value)) map.set(value, label);
    });
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => {
        if (!a.value) return 1;
        if (!b.value) return -1;
        return a.label.localeCompare(b.label, "zh-CN");
      });
  }

  function productFieldValue(row, field) {
    return normalizeProductValue(row[field.key]);
  }

  function siteLabels(row) {
    const code = normalizeProductValue(row.countryCode);
    const label = normalizeProductValue(row.countryLabel);
    return [code, label, label ? `${code} · ${label}` : code].filter(Boolean);
  }

  function productFieldExact(row, field, input) {
    const value = normalizeProductValue(input);
    if (!value) return true;
    if (field.id === "site") return siteLabels(row).some((item) => item.toLowerCase() === value.toLowerCase());
    return productFieldValue(row, field).toLowerCase() === value.toLowerCase();
  }

  function productFieldSearch(row, field, input) {
    const value = normalizeProductValue(input).toLowerCase();
    if (!value) return true;
    if (field.id === "site") return siteLabels(row).some((item) => item.toLowerCase().includes(value));
    return productFieldValue(row, field).toLowerCase().includes(value);
  }

  function hasExactProductValue(rows, field, input) {
    const value = normalizeProductValue(input);
    return !!value && rows.some((row) => productFieldExact(row, field, value));
  }

  function exactMatchedRows(rows, fields) {
    return rows.filter((row) => fields.every((field) => {
      const value = selectValue(field.node);
      if (!value) return true;
      return hasExactProductValue(rows, field, value) ? productFieldExact(row, field, value) : true;
    }));
  }

  function setFieldOptions(field, rows) {
    const datalist = $(`#${field.id}-options`);
    if (!datalist) return;
    const inputValue = selectValue(field.node);
    let options = [];
    if (field.id === "site") {
      const byCode = new Map();
      rows.forEach((row) => {
        if (!productFieldSearch(row, field, inputValue)) return;
        const code = normalizeProductValue(row.countryCode);
        const label = normalizeProductValue(row.countryLabel);
        if (code && !byCode.has(code)) byCode.set(code, label);
      });
      options = Array.from(byCode, ([value, label]) => ({ value, label })).sort((a, b) => a.value.localeCompare(b.value));
    } else {
      options = uniqueProducts(rows.filter((row) => productFieldSearch(row, field, inputValue)), field.key)
        .filter((option) => option.value);
    }
    datalist.innerHTML = "";
    options.slice(0, 80).forEach((option) => {
      const item = document.createElement("option");
      item.value = option.value;
      if (option.label && option.label !== option.value) item.label = option.label;
      datalist.appendChild(item);
    });
  }

  function summarizeProduct(row) {
    if (!row) return "选择 ASIN 后显示产品信息。";
    const chunks = [
      row.productName ? `<strong>${escapeHtml(row.productName)}</strong>` : "",
      `站点：${escapeHtml(row.countryCode || row.countryLabel || "-")}`,
      row.store ? `店铺：${escapeHtml(row.store)}` : "",
      row.category1 || row.category2 || row.category3
        ? `分类：${escapeHtml([row.category1, row.category2, row.category3].filter(Boolean).join(" / "))}`
        : "",
      row.spu ? `SPU：${escapeHtml(row.spu)}` : "",
      row.sku ? `SKU：${escapeHtml(row.sku)}` : "",
      row.msku ? `MSKU：${escapeHtml(row.msku)}` : "",
      row.asin ? `ASIN：${escapeHtml(row.asin)}` : ""
    ].filter(Boolean);
    return chunks.join("<br>");
  }

  function taskProductPayload(row) {
    return {
      site: normalizeProductValue(row.countryCode),
      store: normalizeProductValue(row.store),
      category_1: normalizeProductValue(row.category1),
      category_2: normalizeProductValue(row.category2),
      category_3: normalizeProductValue(row.category3),
      spu: normalizeProductValue(row.spu),
      sku: normalizeProductValue(row.sku),
      msku: normalizeProductValue(row.msku),
      product_name: normalizeProductValue(row.productName)
    };
  }

  function taskProductSummary(row) {
    const tags = [
      row.site ? ["站点", row.site] : null,
      row.store ? ["店铺", row.store] : null,
      row.report_date_range ? ["报表", row.report_date_range] : null,
      row.spu ? ["SPU", row.spu] : null,
      row.sku ? ["SKU", row.sku] : null
    ].filter(Boolean).map(([label, value]) => `
      <span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>
    `).join("");
    const productName = row.product_name
      ? `<div class="task-product-name" title="${escapeHtml(row.product_name)}">${escapeHtml(row.product_name)}</div>`
      : "";
    if (!tags && !productName) return "";
    return `<div class="task-product"><div class="task-product-tags">${tags}</div>${productName}</div>`;
  }

  async function setupProductSelectors(message) {
    const summary = $("#product-summary");
    const selectors = productFields.map((field) => ({
      ...field,
      node: $(`#${field.id}`),
      hint: document.querySelector(`[data-hint-for="${field.id}"]`)
    }));
    if (selectors.some((field) => !field.node)) return { selectedProduct: () => null };
    const autoFilledFields = new Set();

    let rows = [];
    try {
      const response = await fetch(config.productMapUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`产品映射表读取失败，HTTP ${response.status}`);
      const data = await response.json();
      rows = Array.isArray(data.rows) ? data.rows : [];
      if (!rows.length) throw new Error("产品映射表里没有可用记录。");
    } catch (error) {
      setMessage(message, friendlyError(error), "error");
      selectors.forEach((field) => { field.node.disabled = true; });
      if (summary) summary.textContent = "产品映射表加载失败。";
      return { selectedProduct: () => null };
    }

    function rowsForOptions(field) {
      return rows.filter((row) => selectors.every((other) => {
        if (other.id === field.id) return true;
        const value = selectValue(other.node);
        if (!value) return true;
        return hasExactProductValue(rows, other, value) ? productFieldExact(row, other, value) : true;
      }));
    }

    function candidateRows() {
      return exactMatchedRows(rows, selectors);
    }

    function currentSelectedRow() {
      const asin = selectValue($("#asin"));
      if (!asin) return null;
      const candidates = candidateRows().filter((row) => productFieldExact(row, selectors.find((field) => field.id === "asin"), asin));
      return candidates[0] || null;
    }

    function clearAutoFilledFields(exceptId) {
      selectors.forEach((field) => {
        if (field.id === exceptId || !autoFilledFields.has(field.id)) return;
        field.node.value = "";
        autoFilledFields.delete(field.id);
        if (field.hint) {
          field.hint.textContent = "已清掉上次自动补齐的旧内容。";
          field.hint.classList.remove("is-warning");
        }
      });
    }

    function setAutoFilledValue(field, value) {
      if (!value) return;
      field.node.value = value;
      autoFilledFields.add(field.id);
    }

    function clearConflictingFields(anchorField) {
      if (!anchorField) return;
      const anchorValue = selectValue(anchorField.node);
      if (!anchorValue) return;
      const anchorRows = rows.filter((row) => productFieldSearch(row, anchorField, anchorValue));
      if (!anchorRows.length) return;

      selectors.forEach((field) => {
        if (field.id === anchorField.id) return;
        const value = selectValue(field.node);
        if (!value) return;
        const valueExists = hasExactProductValue(rows, field, value);
        if (!valueExists) return;
        const stillCompatible = anchorRows.some((row) => productFieldExact(row, field, value));
        if (!stillCompatible) {
          field.node.value = "";
          autoFilledFields.delete(field.id);
          if (field.hint) {
            field.hint.textContent = "已清掉和新输入冲突的旧条件。";
            field.hint.classList.remove("is-warning");
          }
        }
      });
    }

    function autoFillUniqueFields(anchorField) {
      if (!anchorField || !hasExactProductValue(rows, anchorField, selectValue(anchorField.node))) return;
      let candidates = candidateRows().filter((row) => productFieldExact(row, anchorField, selectValue(anchorField.node)));
      if (!candidates.length) return;

      selectors.forEach((field) => {
        if (field.id === anchorField.id || selectValue(field.node)) return;
        const values = uniqueProducts(candidates, field.key).filter((option) => option.value);
        if (field.id === "site") {
          const sites = new Map();
          candidates.forEach((row) => {
            const code = normalizeProductValue(row.countryCode);
            if (code) sites.set(code, true);
          });
          if (sites.size === 1) setAutoFilledValue(field, Array.from(sites.keys())[0]);
          return;
        }
        if (values.length === 1) setAutoFilledValue(field, values[0].value);
      });
    }

    function updateFieldState(field, candidates, optionRows) {
      const value = selectValue(field.node);
      const options = uniqueProducts(candidates, field.key).filter((option) => option.value);
      const searchOptions = uniqueProducts(optionRows.filter((row) => productFieldSearch(row, field, value)), field.key)
        .filter((option) => option.value);
      const exact = !value || hasExactProductValue(rows, field, value);
      const needsChoice = !value && options.length > 1;
      const invalid = !!value && !exact && searchOptions.length === 0;
      const partial = !!value && !exact && searchOptions.length > 0;
      const requiredBlank = field.required && !value;
      field.node.classList.toggle("needs-choice", needsChoice || requiredBlank || invalid);
      field.node.classList.toggle("is-confirmed", !!value && exact);
      if (!field.hint) return;
      if (invalid) {
        field.hint.textContent = "没有匹配项，请改字或从候选里选。";
        field.hint.classList.add("is-warning");
      } else if (needsChoice) {
        field.hint.textContent = `匹配到 ${options.length} 个候选，需要选择。`;
        field.hint.classList.add("is-warning");
      } else if (partial) {
        field.hint.textContent = `已出现 ${searchOptions.length} 个候选，请从候选里选完整值。`;
        field.hint.classList.remove("is-warning");
      } else if (requiredBlank) {
        field.hint.textContent = "提交前必须确定。";
        field.hint.classList.add("is-warning");
      } else if (value && exact) {
        field.hint.textContent = "已确定。";
        field.hint.classList.remove("is-warning");
      } else {
        field.hint.textContent = "";
        field.hint.classList.remove("is-warning");
      }
    }

    function refresh(anchorField, isManualEdit) {
      if (anchorField && anchorField.id === "asin") anchorField.node.value = selectValue(anchorField.node).toUpperCase();
      if (anchorField && isManualEdit) {
        autoFilledFields.delete(anchorField.id);
        clearAutoFilledFields(anchorField.id);
      }
      clearConflictingFields(anchorField);
      autoFillUniqueFields(anchorField);
      const candidates = candidateRows();
      selectors.forEach((field, index) => {
        const optionRows = rowsForOptions(field);
        setFieldOptions(field, optionRows);
        updateFieldState(field, candidates, optionRows);
      });
      const selected = currentSelectedRow();
      if (summary) summary.innerHTML = summarizeProduct(selected);
    }

    selectors.forEach((field) => {
      field.node.disabled = false;
      field.node.addEventListener("input", () => refresh(field, true));
      field.node.addEventListener("change", () => refresh(field, true));
    });

    const clearButton = $("#clear-product-fields");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        selectors.forEach((field) => {
          field.node.value = "";
          autoFilledFields.delete(field.id);
          field.node.classList.remove("needs-choice", "is-confirmed");
          if (field.hint) {
            field.hint.textContent = "";
            field.hint.classList.remove("is-warning");
          }
        });
        refresh(null);
      });
    }

    refresh(null);

    return {
      selectedProduct: currentSelectedRow,
      reset: () => {
        autoFilledFields.clear();
        selectors.forEach((field) => { field.node.value = ""; });
        refresh(null);
      }
    };
  }

  function initAuthPage() {
    const current = session();
    if (current && current.access_token) {
      location.href = "./tool/";
      return;
    }

    let mode = "login";
    const form = $("#auth-form");
    const submit = $("#auth-submit");
    const message = $("#auth-message");

    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.dataset.authMode;
        document.querySelectorAll("[data-auth-mode]").forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        submit.textContent = mode === "login" ? "登录" : "注册";
        setMessage(message, "");
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      setMessage(message, mode === "login" ? "正在登录..." : "正在注册...");
      const email = $("#email").value.trim();
      const password = $("#password").value;
      try {
        const path = mode === "login" ? "/auth/v1/token?grant_type=password" : "/auth/v1/signup";
        const data = await supabaseFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        if (!data.access_token && mode === "signup") {
          setMessage(message, "注册成功，请直接登录。", "ok");
          return;
        }
        saveSession(data);
        location.href = "./tool/";
      } catch (error) {
        setMessage(message, friendlyError(error), "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function initToolPage() {
    const user = await requireUser();
    if (!user) return;

    const form = $("#task-form");
    const submit = $("#submit-task");
    const message = $("#task-message");
    const tasks = $("#tasks");

    $("#logout").addEventListener("click", () => {
      clearSession();
      location.href = "../index.html";
    });
    $("#refresh-tasks").addEventListener("click", loadTasks);
    const productSelectorControl = await setupProductSelectors(message);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const asin = selectValue($("#asin")).trim().toUpperCase();
      const selectedProduct = productSelectorControl.selectedProduct();
      const file = $("#report-file").files[0];
      if (!/^B0[A-Z0-9]{8}$/.test(asin)) {
        setMessage(message, "请先从产品映射表里选择一个有效 ASIN。", "error");
        return;
      }
      if (!selectedProduct) {
        setMessage(message, "当前 ASIN 没有匹配到产品映射记录，请重新选择。", "error");
        return;
      }
      if (!file) {
        setMessage(message, "请选择广告报表。", "error");
        return;
      }
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["xlsx", "csv"].includes(ext)) {
        setMessage(message, "报表只支持.xlsx或.csv。", "error");
        return;
      }
      if (file.size > config.maxUploadBytes) {
        setMessage(message, "报表不能超过20MB。", "error");
        return;
      }

      submit.disabled = true;
      setMessage(message, "正在上传并提交...");
      const taskId = crypto.randomUUID();
      const uploadPath = `${user.id}/${taskId}.${ext}`;

      try {
        await supabaseFetch(`/storage/v1/object/${config.inboxBucket}/${uploadPath}`, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "x-upsert": "false"
          },
          body: file
        }, true);

        await supabaseFetch("/rest/v1/keyword_tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            id: taskId,
            user_id: user.id,
            asin,
            upload_path: uploadPath,
            ...taskProductPayload(selectedProduct)
          })
        }, true);

        form.reset();
        productSelectorControl.reset();
        setMessage(message, "提交成功，工人会自动处理。", "ok");
        await loadTasks();
      } catch (error) {
        setMessage(message, friendlyError(error), "error");
      } finally {
        submit.disabled = false;
      }
    });

    await loadTasks();
    setInterval(loadTasks, 30000);

    async function loadTasks() {
      try {
        const data = await supabaseFetch(
          "/rest/v1/keyword_tasks?select=id,asin,status,failure_reason,report_url,created_at,completed_at,site,store,category_1,category_2,category_3,spu,sku,msku,product_name,task_note,report_start_date,report_end_date,report_date_range&order=created_at.desc&limit=100",
          { method: "GET" },
          true
        );
        renderTasks(data || []);
      } catch (error) {
        tasks.innerHTML = `<p class="form-message is-error">${friendlyError(error)}</p>`;
      }
    }

    function renderTasks(rows) {
      if (!rows.length) {
        tasks.innerHTML = '<p class="form-message">暂无任务。</p>';
        return;
      }
      tasks.innerHTML = rows.map((row) => {
        const statusClass = taskStatusClass[row.status] || "status-pending";
        const createdAt = row.created_at ? new Date(row.created_at).toLocaleString("zh-CN") : "-";
        const failure = row.status === "失败" && row.failure_reason ? `<div class="task-meta">${escapeHtml(row.failure_reason)}</div>` : "";
        const labelText = row.task_note || taskDisplayLabels[row.id] || "";
        const label = labelText ? `<span class="task-label">${escapeHtml(labelText)}</span>` : "";
        const product = taskProductSummary(row);
        const report = row.status === "已完成" && row.report_url
          ? `<a class="ghost-button" href="../report/?task=${encodeURIComponent(row.id)}">查看报告</a>`
          : "";
        return `
          <article class="task-card">
            <div><strong>${escapeHtml(row.asin)}${label}</strong><span class="task-meta">${createdAt}</span></div>
            ${product || '<div class="task-meta">产品信息<br>未记录</div>'}
            <div><span class="status-pill ${statusClass}">${escapeHtml(row.status)}</span></div>
            <div class="task-meta">任务号<br>${escapeHtml(row.id.slice(0, 8))}</div>
            <div>${failure}</div>
            <div class="task-actions">${report}</div>
          </article>
        `;
      }).join("");
    }
  }

  async function initReportPage() {
    const user = await requireUser();
    if (!user) return;
    const message = $("#report-message");
    const frame = $("#report-frame");
    const taskId = new URLSearchParams(location.search).get("task");
    if (!taskId) {
      setMessage(message, "缺少任务号。", "error");
      return;
    }

    try {
      const rows = await supabaseFetch(
        `/rest/v1/keyword_tasks?select=id,status,report_url,failure_reason&id=eq.${encodeURIComponent(taskId)}&limit=1`,
        { method: "GET" },
        true
      );
      const task = rows && rows[0];
      if (!task) throw new Error("没有找到这个任务。");
      if (task.status === "失败") throw new Error(task.failure_reason || "任务处理失败。");
      if (task.status !== "已完成" || !task.report_url) throw new Error("报告还没生成。");

      const reportUrl = normalizeReportUrl(task.report_url);
      const response = await fetch(reportUrl).catch((error) => {
        throw new Error(`报告文件网络读取失败。请检查 OSS CORS 是否放行当前来源：${location.origin}；报告地址：${reportUrl}；浏览器错误：${error.message || error}`);
      });
      if (!response.ok) throw new Error(`报告文件读取失败，OSS 返回 HTTP ${response.status}。报告地址：${reportUrl}`);
      const html = await response.text();
      frame.srcdoc = polishReportHtmlV2(html);
      frame.style.display = "block";
      setMessage(message, "");
    } catch (error) {
      setMessage(message, friendlyError(error), "error");
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeReportUrl(url) {
    return String(url || "").replace(
      /^http:\/\/yiqutogether-tools\.oss-cn-guangzhou\.aliyuncs\.com/i,
      "https://yiqutogether-tools.oss-cn-guangzhou.aliyuncs.com"
    );
  }

  function polishReportHtml(html) {
    const style = `
      <style>
        body { background: #f3f6fa !important; color: #172033 !important; }
        header { display: none !important; }
        main { max-width: 1680px; margin: 0 auto; padding: 22px 24px 36px !important; }
        .report-hero { margin-bottom: 14px; padding: 22px 24px; border-radius: 8px; color: #fff; background: linear-gradient(120deg, #123a70, #2468d8); }
        .report-hero h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
        .report-hero p { margin: 0; color: rgba(255,255,255,.82); font-size: 13px; }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px; }
        .metric-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; padding: 12px 14px; box-shadow: 0 6px 18px rgba(15, 23, 42, .04); }
        .metric-card span { display: block; color: #667085; font-size: 12px; margin-bottom: 6px; }
        .metric-card strong { display: block; color: #0f172a; font-size: 22px; line-height: 1.1; }
        .metric-card small { display: block; color: #667085; font-size: 12px; margin-top: 5px; white-space: nowrap; }
        .table-title { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 10px; }
        .table-title h2 { margin: 0; font-size: 18px; }
        .table-title span { color: #667085; font-size: 12px; }
        .table-wrap { border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, .06); }
        table { min-width: 1740px !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 0 !important; }
        th, td { font-size: 12px !important; padding: 11px 10px !important; border-bottom: 1px solid #dfe6ee !important; }
        th { color: #17324d !important; background: #eef4fb !important; }
        tbody tr:nth-child(even) td { background: #fbfdff; }
        tbody tr:hover td { background: #f6fbff; }
        tbody td:nth-child(1), thead tr:first-child th:first-child { width: 180px; position: sticky; left: 0; z-index: 12; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
        thead tr:first-child th:first-child { z-index: 30; background: #e9f0f8 !important; }
        th:nth-child(4), td:nth-child(4) { width: 170px !important; }
        th:nth-child(8), td:nth-child(8) { width: 250px !important; }
        th:nth-child(10), td:nth-child(10) { width: 270px !important; }
        .group-row th { text-align: center !important; font-weight: 700; border-bottom: 1px solid #cad6e3 !important; }
        .group-market { background: #eaf7f2 !important; color: #006b55 !important; }
        .group-competition { background: #fff4e5 !important; color: #9a5a00 !important; }
        .group-self { background: #eef4ff !important; color: #2452b8 !important; }
        .group-ad { background: #f4f0ff !important; color: #6941c6 !important; }
        .sparkline { width: 140px; height: 40px; display: block; }
        .sparkline path { fill: none; stroke: #2f6fce; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
        .sparkline polyline { fill: none; stroke: #2f6fce; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
        .sparkline text { fill: #667085; font-size: 10px; }
        .asin { display: grid !important; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: center; margin-bottom: 7px !important; line-height: 1.25; }
        .asin img, .image-fallback { width: 30px; height: 30px; object-fit: cover; background: #eef1f5; border: 1px solid #dde3ea; border-radius: 5px; }
        .image-fallback { display: inline-flex; align-items: center; justify-content: center; color: #667085; font-size: 10px; font-weight: 700; }
        .tag { border-radius: 999px !important; padding: 3px 8px !important; background: #e7f0ff !important; color: #175cd3 !important; }
      </style>
    `;
    const script = `
      <script>
        (function () {
          function text(node) { return (node && node.textContent || "").trim(); }
          function numberFrom(value) {
            var n = Number(String(value || "").replace(/[^0-9.\\-]/g, ""));
            return Number.isFinite(n) ? n : 0;
          }
          function compact(value) { return Number(value || 0).toLocaleString("en-US"); }
          function parseTrend(raw) {
            return String(raw || "").match(/[0-9.]+\\s*[kKmM]?/g) || [];
          }
          function trendValue(part) {
            var match = String(part || "").match(/([0-9.]+)\\s*([kKmM]?)/);
            if (!match) return 0;
            var n = Number(match[1]);
            var unit = match[2].toLowerCase();
            if (unit === "m") n *= 1000000;
            if (unit === "k") n *= 1000;
            return n;
          }
          function sparkline(parts) {
            var values = parts.map(trendValue).filter(function (n) { return n > 0; });
            if (values.length < 2) return parts.join(" → ");
            var min = Math.min.apply(null, values);
            var max = Math.max.apply(null, values);
            var spread = max - min || 1;
            var points = values.map(function (value, index) {
              var x = 4 + index * (132 / Math.max(1, values.length - 1));
              var y = 32 - ((value - min) / spread) * 24;
              return x.toFixed(1) + "," + y.toFixed(1);
            }).join(" ");
            return '<svg class="sparkline" viewBox="0 0 144 44" role="img" aria-label="ABA trend"><polyline points="' + points + '"></polyline><text x="4" y="42">' + parts[0] + '</text><text x="104" y="42">' + parts[parts.length - 1] + '</text></svg>';
          }
          function fixImages(scope) {
            scope.querySelectorAll(".asin").forEach(function (node) {
              var img = node.querySelector("img");
              var label = (node.textContent || "ASIN").trim().slice(0, 4);
              function fallback() {
                var span = document.createElement("span");
                span.className = "image-fallback";
                span.textContent = label || "ASIN";
                if (img && img.parentNode) img.replaceWith(span);
                else node.insertBefore(span, node.firstChild);
              }
              if (!img || !img.getAttribute("src")) {
                fallback();
                return;
              }
              if (img.getAttribute("src").indexOf("http://") === 0) {
                img.setAttribute("src", img.getAttribute("src").replace(/^http:\\/\\//, "https://"));
              }
              img.referrerPolicy = "no-referrer";
              img.loading = "lazy";
              img.onerror = fallback;
            });
          }

          var table = document.querySelector("table");
          if (!table) return;
          var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"));
          var oldHeader = document.querySelector("header");
          var oldTitle = oldHeader ? text(oldHeader.querySelector("h1")) : "关键词作战总表";
          var oldMeta = oldHeader ? text(oldHeader.querySelector(".meta")) : "";
          var main = document.querySelector("main");

          function sourceAdCell(row) { return row.cells.length >= 11 ? row.cells[9] : row.cells[8]; }
          var adRows = rows.filter(function (row) { return text(sourceAdCell(row)).indexOf("无投放") === -1; });
          var weeklyTotal = rows.reduce(function (sum, row) { return sum + numberFrom(text(row.cells[2])); }, 0);
          var avgDifficulty = rows.length ? Math.round(rows.reduce(function (sum, row) { return sum + numberFrom(text(row.cells[4])); }, 0) / rows.length) : 0;
          var avgAcos = adRows.length ? adRows.reduce(function (sum, row) {
            var match = text(sourceAdCell(row)).match(/([0-9.]+)%\\s*$/);
            return sum + (match ? Number(match[1]) : 0);
          }, 0) / adRows.length : 0;

          var hero = document.createElement("section");
          hero.className = "report-hero";
          hero.innerHTML = '<h1>' + oldTitle + '</h1><p>' + oldMeta + '</p>';
          main.insertBefore(hero, main.firstChild);

          var metrics = document.createElement("section");
          metrics.className = "metric-grid";
          metrics.innerHTML =
            '<div class="metric-card"><span>报告关键词</span><strong>' + rows.length + '</strong></div>' +
            '<div class="metric-card"><span>合计最新周搜索量</span><strong>' + compact(weeklyTotal) + '</strong></div>' +
            '<div class="metric-card"><span>有广告数据</span><strong>' + adRows.length + '</strong></div>' +
            '<div class="metric-card"><span>平均难度</span><strong>' + avgDifficulty + '</strong></div>' +
            '<div class="metric-card"><span>广告平均 ACOS</span><strong>' + (avgAcos ? avgAcos.toFixed(1) + '%' : '-') + '</strong></div>';
          hero.after(metrics);

          var title = document.createElement("div");
          title.className = "table-title";
          title.innerHTML = '<h2>关键词数据</h2><span>市场、竞对、自身、广告和打法合并扫表</span>';
          metrics.after(title);

          var thead = table.querySelector("thead");
          if (thead && !thead.querySelector(".group-row")) {
            var group = document.createElement("tr");
            group.className = "group-row";
            group.innerHTML =
              '<th rowspan="2">关键词</th>' +
              '<th class="group-market" colspan="5">市场</th>' +
              '<th class="group-self" colspan="1">自身</th>' +
              '<th class="group-competition" colspan="1">竞对</th>' +
              '<th class="group-ad" colspan="1">广告</th>' +
              '<th rowspan="2">打法建议</th>';
            var labels = document.createElement("tr");
            labels.innerHTML =
              '<th>ASIN总流量</th><th>最新周搜索量</th><th>ABA 12月</th><th>难度</th><th>建议竞价</th>' +
              '<th>自然位</th><th>点击前三/竞品</th><th>点击/花费/订单/ACOS</th>';
            thead.textContent = "";
            thead.appendChild(group);
            thead.appendChild(labels);
          }

          rows.forEach(function (row) {
            var trendCell = row.cells && row.cells[3];
            if (trendCell && !trendCell.querySelector(".sparkline")) {
              var parts = parseTrend(trendCell.textContent);
              trendCell.innerHTML = parts.length > 1 ? sparkline(parts) : trendCell.textContent;
            }
          });
          fixImages(document);
        })();
      <\\/script>
    `;
    return html.replace("</head>", `${style}</head>`).replace("</body>", `${script}</body>`);
  }

  function polishReportHtmlV2(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const moduleOne = doc.querySelector('[data-report-module="01"]');
    const table = moduleOne ? moduleOne.querySelector("table") : doc.querySelector("table");
    const main = moduleOne || doc.querySelector("main") || doc.body;
    const oldHeader = doc.querySelector("header");
    const rows = table ? Array.from(table.querySelectorAll("tbody tr")) : [];

    const style = doc.createElement("style");
    style.textContent = `
      body { margin: 0; background: #f3f6fa !important; color: #172033 !important; font-family: Arial, "Microsoft YaHei", sans-serif; }
      body > header { display: none !important; }
      main { max-width: 1680px; margin: 0 auto; padding: 22px 24px 36px !important; }
      .report-layout { display: grid !important; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: start; max-width: 1680px; margin: 0 auto; }
      .module-menu { position: sticky; top: 12px; display: grid; gap: 8px; }
      .module-tab { width: 100%; min-height: 42px; padding: 0 12px; border: 1px solid #d7dee8; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 13px; font-weight: 800; text-align: left; cursor: pointer; }
      .module-tab.is-soon { color: #98a2b3; background: #f5f7fa; }
      .module-tab.is-ready { color: #174ea6; background: #fff; }
      .module-tab.is-active { border-color: #1d5fd1; background: #eaf2ff; color: #174ea6; box-shadow: inset 3px 0 0 #1d5fd1; }
      .module-content { min-width: 0; }
      .module-section { display: none; }
      .module-section.is-active { display: block; }
      .module-placeholder { min-height: 320px; display: grid; place-items: center; padding: 34px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; color: #98a2b3; font-size: 15px; font-weight: 800; }
      .report-hero { margin-bottom: 14px; padding: 22px 24px; border-radius: 8px; color: #fff; background: linear-gradient(120deg, #123a70, #2468d8); }
      .report-hero h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
      .report-hero p { margin: 0; color: rgba(255,255,255,.82); font-size: 13px; }
      .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .metric-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; padding: 12px 14px; box-shadow: 0 6px 18px rgba(15, 23, 42, .04); }
      .metric-card span { display: block; color: #667085; font-size: 12px; margin-bottom: 6px; }
      .metric-card strong { display: block; color: #0f172a; font-size: 22px; line-height: 1.1; }
      .metric-card small { display: block; color: #667085; font-size: 12px; margin-top: 5px; white-space: nowrap; }
      .table-title { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 10px; }
      .table-title h2 { margin: 0; font-size: 18px; }
      .table-title span { color: #667085; font-size: 12px; }
      .action-panel { display: grid; gap: 10px; margin: 14px 0 18px; }
      .action-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; }
      .action-title { margin-right: 8px; font-size: 16px; font-weight: 800; color: #172033; }
      .filter-button, .legend-pill { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 13px; border-radius: 999px; border: 1px solid #d5deea; background: #fff; color: #344054; font-size: 13px; font-weight: 700; }
      .filter-button { cursor: pointer; }
      .filter-button.is-active { border-color: #172033; box-shadow: inset 0 0 0 2px #172033; }
      .dot { width: 9px; height: 9px; border-radius: 999px; background: currentColor; }
      .cat-profit { color: #00806b; background: #e7fbf5; }
      .cat-guard { color: #1677ff; background: #edf5ff; }
      .cat-hold { color: #0f5fbf; background: #eaf3ff; }
      .cat-scale { color: #12a150; background: #ebf8f0; }
      .cat-review { color: #d99000; background: #fff7e5; }
      .cat-stop { color: #dc2626; background: #fff1f1; }
      .cat-tail { color: #7a4cc2; background: #f4f0ff; }
      .cat-avoid { color: #667085; background: #f1f3f6; }
      .cat-season { color: #b45309; background: #fff3d6; }
      .cat-missing { color: #475467; background: #eef2f6; }
      .rule-note { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 6px 16px; color: #667085; font-size: 13px; line-height: 1.6; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; }
      .rule-note div { min-width: 0; }
      tr.is-hidden { display: none; }
      .table-wrap { border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, .06); }
      table { min-width: 2520px !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 0 !important; }
      th, td { position: relative; font-size: 12px !important; padding: 11px 10px !important; border-bottom: 1px solid #dfe6ee !important; vertical-align: top; }
      th { color: #17324d !important; background: #eef4fb !important; }
      .th-label { display: inline-flex; align-items: center; gap: 5px; max-width: calc(100% - 12px); white-space: normal; line-height: 1.25; vertical-align: middle; }
      .th-help { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; flex: 0 0 15px; border: 1px solid #9fb7d8; border-radius: 999px; color: #2f6fce; background: #fff; font-size: 10px; font-weight: 800; cursor: help; }
      .sort-button { display: inline-grid; grid-template-rows: 8px 8px; align-items: center; justify-items: center; width: 17px; height: 22px; margin-left: 4px; padding: 2px; border: 1px solid #c9d8ec; border-radius: 4px; background: #fff; color: #9aa9bd; cursor: pointer; vertical-align: middle; }
      .sort-button:hover { border-color: #7aa7e8; color: #2f6fce; }
      .sort-button span { display: block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; }
      .sort-button .sort-up { border-bottom: 6px solid currentColor; }
      .sort-button .sort-down { border-top: 6px solid currentColor; }
      .sort-button.is-asc .sort-up, .sort-button.is-desc .sort-down { color: #2f6fce; }
      th[data-col-index] { user-select: none; }
      th .resize-handle { position: absolute; top: 0; right: 0; width: 10px; height: 100%; cursor: col-resize; z-index: 6; }
      th .resize-handle::after { content: ""; position: absolute; top: 9px; bottom: 9px; right: 3px; width: 2px; border-radius: 2px; background: rgba(47, 111, 206, .28); }
      th .resize-handle:hover::after, th .resize-handle.is-dragging::after { right: 2px; width: 4px; background: #2f6fce; }
      tbody tr:nth-child(even) td { background: #fbfdff; }
      tbody tr:hover td { background: #f6fbff; }
      tbody td:nth-child(1), thead tr:first-child th:first-child { width: 180px; position: sticky; left: 0; z-index: 12; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
      thead tr:first-child th:first-child { z-index: 30; background: #e9f0f8 !important; }
      td:nth-child(6), td:nth-child(7), td:nth-child(15) { line-height: 1.45; }
      .group-row th { text-align: center !important; font-weight: 700; border-bottom: 1px solid #cad6e3 !important; }
      .group-market { background: #eaf7f2 !important; color: #006b55 !important; }
      .group-competition { background: #fff4e5 !important; color: #9a5a00 !important; }
      .group-self { background: #eef4ff !important; color: #2452b8 !important; }
      .group-ad { background: #f4f0ff !important; color: #6941c6 !important; }
      .market-cell { display: grid; gap: 5px; }
      .market-main { font-weight: 800; font-size: 15px; color: #172033; }
      .market-sub, .subtext { color: #667085; font-size: 11px; line-height: 1.35; }
      .trend-bars { display: flex; align-items: flex-end; gap: 3px; width: 170px; height: 46px; margin-top: 5px; cursor: pointer; }
      .trend-bar { flex: 1 1 0; min-width: 4px; border-radius: 3px 3px 0 0; background: #39a892; transition: transform .12s ease, background .12s ease; }
      .trend-bar:hover { transform: translateY(-2px); background: #168f7a; }
      .trend-meta { color: #667085; font-size: 10px; line-height: 1.25; margin-top: 3px; }
      .aba-modal-backdrop { position: fixed; inset: 0; z-index: 9999; display: none; align-items: center; justify-content: center; background: rgba(15, 23, 42, .45); padding: 22px; }
      .aba-modal-backdrop.is-open { display: flex; }
      .aba-modal { width: min(760px, 94vw); max-height: 78vh; overflow: hidden; background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; box-shadow: 0 20px 50px rgba(15, 23, 42, .22); }
      .aba-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e3e9f1; }
      .aba-modal-head h3 { margin: 0; font-size: 16px; letter-spacing: 0; }
      .aba-modal-close { width: 34px; height: 34px; border: 1px solid #d5deea; border-radius: 6px; background: #fff; color: #172033; cursor: pointer; font-size: 20px; line-height: 1; }
      .aba-modal-body { max-height: calc(78vh - 68px); overflow: auto; padding: 14px 18px 18px; }
      .aba-modal-keyword { margin: 0 0 10px; color: #667085; font-size: 13px; font-weight: 700; }
      .aba-detail-table { width: 100%; min-width: 0 !important; border-collapse: collapse !important; table-layout: fixed !important; }
      .aba-detail-table th, .aba-detail-table td { padding: 10px 12px !important; border-bottom: 1px solid #e3e9f1 !important; font-size: 13px !important; position: static; }
      .aba-detail-table th { background: #eaf7f2 !important; color: #006b55 !important; }
      .keyword-name { display: block; font-weight: 800; margin-bottom: 8px; }
      .keyword-tags { display: flex; flex-wrap: wrap; gap: 5px; }
      .keyword-chip, .season-chip, .conversion-chip, .difficulty-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
      .keyword-chip { background: #eef5ff; color: #175cd3; }
      .keyword-chip.cat-profit { color: #00806b; background: #e7fbf5; }
      .keyword-chip.cat-guard { color: #1677ff; background: #edf5ff; }
      .keyword-chip.cat-hold { color: #0f5fbf; background: #eaf3ff; }
      .keyword-chip.cat-scale { color: #12a150; background: #ebf8f0; }
      .keyword-chip.cat-review { color: #d99000; background: #fff7e5; }
      .keyword-chip.cat-stop { color: #dc2626; background: #fff1f1; }
      .keyword-chip.cat-tail { color: #7a4cc2; background: #f4f0ff; }
      .keyword-chip.cat-avoid { color: #667085; background: #f1f3f6; }
      .keyword-chip.cat-season { color: #b45309; background: #fff3d6; }
      .keyword-chip.cat-missing { color: #475467; background: #eef2f6; }
      .conversion-chip { background: #eaf7f1; color: #0f8f61; }
      .conversion-chip.pending { background: #eef2f6; color: #475467; }
      .season-chip { background: #fff7e5; color: #a15c00; }
      .difficulty-pill.low { background: #eaf7f1; color: #0f8f61; }
      .difficulty-pill.mid { background: #fff7e5; color: #a15c00; }
      .difficulty-pill.high { background: #fff1f1; color: #dc2626; }
      .bid-main { display: block; font-size: 15px; font-weight: 800; color: #172033; margin-bottom: 4px; }
      .bid-range { display: block; color: #667085; font-size: 11px; }
      .ad-metric { display: grid; gap: 4px; align-content: start; min-height: 40px; }
      .ad-main { display: block !important; font-size: 15px !important; line-height: 1.15 !important; font-weight: 800 !important; color: #172033 !important; white-space: nowrap; }
      .ad-sub { display: block !important; color: #667085 !important; font-size: 11px !important; line-height: 1.2 !important; margin-top: 0 !important; white-space: nowrap; }
      .ad-empty { color: #98a2b3; font-weight: 700; }
      .ad-target-list { display: grid; gap: 8px; align-content: start; }
      .ad-target-item { display: grid; gap: 2px; line-height: 1.25; }
      .ad-target-list:not(.is-expanded) .ad-target-item.is-extra { display: none; }
      .ad-target-item strong { display: block; font-weight: 800; color: #172033; }
      .ad-target-item span { display: block; color: #667085; font-size: 11px; }
      .ad-target-toggle { justify-self: start; border: 0; background: #eef5ff; color: #175cd3; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 800; cursor: pointer; }
      .ad-target-toggle:hover { background: #dbeafe; }
      .asin { display: grid !important; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: center; margin-bottom: 7px !important; line-height: 1.25; }
      .asin img, .image-fallback { width: 30px; height: 30px; object-fit: cover; background: #eef1f5; border: 1px solid #dde3ea; border-radius: 5px; }
      .image-fallback { display: inline-flex; align-items: center; justify-content: center; color: #667085; font-size: 10px; font-weight: 700; }
      .organic-title { margin-top: 0; }
      .organic-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .organic-summary .summary-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; padding: 12px 14px; box-shadow: 0 6px 18px rgba(15, 23, 42, .04); }
      .organic-summary .summary-card span { display: block; color: #667085; font-size: 12px; margin-bottom: 6px; }
      .organic-summary .summary-card strong { display: block; color: #0f172a; font-size: 22px; line-height: 1.1; }
      .organic-rule-note { margin: 0 0 18px; }
      .organic-table { min-width: 1130px !important; }
      .organic-table th { text-align: center !important; }
      .organic-table td { text-align: left !important; }
      .organic-table tbody td:first-child, .organic-table thead tr:first-child th:first-child { width: 220px; position: sticky; left: 0; z-index: 12; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
      .organic-table thead tr:first-child th:first-child { z-index: 30; background: #e9f0f8 !important; }
      .organic-table .keyword { font-weight: 800; color: #172033; }
      .rank-cell { display: grid; gap: 4px; }
      .rank-main { display: block; font-size: 15px; line-height: 1.15; font-weight: 800; color: #172033; }
      .rank-sub { display: block; color: #667085; font-size: 11px; line-height: 1.25; }
      .organic-table .benchmark-asin { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: center; margin: 0 !important; line-height: 1.25; }
      .organic-table .benchmark-asin strong { display: block; color: #172033; font-weight: 800; }
      .organic-table .benchmark-asin img { width: 30px; height: 30px; object-fit: cover; background: #eef1f5; border: 1px solid #dde3ea; border-radius: 5px; }
      .organic-hero { margin-bottom: 14px; padding: 22px 24px; border-radius: 8px; color: #fff; background: linear-gradient(120deg, #123a70, #2468d8); }
      .organic-hero h2 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
      .organic-hero p { margin: 0; color: rgba(255,255,255,.82); font-size: 13px; }
      .organic-note { margin: 0 0 18px; padding: 12px 14px; border: 1px solid #d9e1ea; border-radius: 8px; background: #eaf7f1; color: #17324d; font-size: 13px; line-height: 1.6; }
      .organic-rich-table { min-width: 1760px !important; }
      .organic-rich-table tbody td:first-child, .organic-rich-table thead tr:first-child th:first-child { width: 58px; position: static; box-shadow: none; }
      .organic-rich-table tbody td:nth-child(2), .organic-rich-table thead tr:first-child th:nth-child(2) { width: 220px; position: sticky; left: 0; z-index: 12; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
      .organic-rich-table thead tr:first-child th:nth-child(2) { z-index: 30; background: #e9f0f8 !important; }
      .organic-rank { display: grid; gap: 3px; }
      .organic-rank strong { color: #172033; font-size: 14px; }
      .organic-rank span { color: #667085; font-size: 12px; }
      .benchmark-card { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 10px; align-items: start; }
      .benchmark-card img, .benchmark-card .image-fallback { width: 68px; height: 68px; border-radius: 5px; object-fit: cover; }
      .benchmark-copy { min-width: 0; display: grid; gap: 3px; }
      .benchmark-rank { color: #174ea6; font-size: 15px; font-weight: 800; }
      .benchmark-card .benchmark-asin { display: block !important; color: #174ea6; font-weight: 800; }
      .benchmark-title { color: #172033; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .benchmark-meta { color: #344054; font-size: 12px; line-height: 1.35; }
      .benchmark-sub { color: #667085; font-size: 12px; line-height: 1.35; }
      .distance-good { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; color: #00806b !important; background: #e7fbf5; font-weight: 800; }
      .distance-bad { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; color: #dc2626 !important; background: #fff1f1; font-weight: 800; }
      .distance-empty { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; color: #98a2b3 !important; background: #f1f3f6; font-weight: 700; }
      .tag { border-radius: 999px !important; padding: 3px 8px !important; }
      .tag.cat-profit { color: #00806b !important; background: #e7fbf5 !important; }
      .tag.cat-guard { color: #1677ff !important; background: #edf5ff !important; }
      .tag.cat-hold { color: #0f5fbf !important; background: #eaf3ff !important; }
      .tag.cat-scale { color: #12a150 !important; background: #ebf8f0 !important; }
      .tag.cat-review { color: #d99000 !important; background: #fff7e5 !important; }
      .tag.cat-stop { color: #dc2626 !important; background: #fff1f1 !important; }
      .tag.cat-tail { color: #7a4cc2 !important; background: #f4f0ff !important; }
      .tag.cat-avoid { color: #667085 !important; background: #f1f3f6 !important; }
      .tag.cat-season { color: #b45309 !important; background: #fff3d6 !important; }
      .tag.cat-missing { color: #475467 !important; background: #eef2f6 !important; }
      @media (max-width: 760px) {
        main { padding: 14px !important; }
        .report-layout { display: block !important; }
        .module-menu { position: static; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 12px; }
        .module-tab { flex: 0 0 auto; width: auto; white-space: nowrap; }
      }
    `;
    doc.head.appendChild(style);

    if (!table) return doc.documentElement.outerHTML;

    const text = (node) => (node && node.textContent || "").trim();
    const numberFrom = (value) => {
      const n = Number(String(value || "").replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const compact = (value) => Number(value || 0).toLocaleString("en-US");
    const parseTrend = (raw) => String(raw || "").match(/[0-9.]+\s*[kKmM]?/g) || [];
    const trendValue = (part) => {
      const match = String(part || "").match(/([0-9.]+)\s*([kKmM]?)/);
      if (!match) return 0;
      let n = Number(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === "m") n *= 1000000;
      if (unit === "k") n *= 1000;
      return n;
    };
    const trendPoints = (sourceCell, fallbackParts) => {
      const raw = sourceCell && sourceCell.getAttribute ? (sourceCell.getAttribute("data-aba-trend") || "") : "";
      if (raw) {
        try {
          const parsed = JSON.parse(decodeEntities(raw));
          if (Array.isArray(parsed)) {
            return parsed.map((item, index) => ({
              index: index + 1,
              from: item.from || "",
              to: item.to || "",
              value: Number(item.weeklySearchVolume || 0),
              rank: item.searchFrequencyRank ?? null
            })).filter((item) => item.value > 0);
          }
        } catch (_) {}
      }
      return fallbackParts.map((part, index) => ({
        index: index + 1,
        from: "",
        to: "",
        value: trendValue(part),
        rank: null
      })).filter((item) => item.value > 0);
    };
    const monthlyTrendPoints = (sourceCell, weeklyPoints) => {
      const raw = sourceCell && sourceCell.getAttribute ? (sourceCell.getAttribute("data-aba-monthly") || "") : "";
      if (raw) {
        try {
          const parsed = JSON.parse(decodeEntities(raw));
          if (Array.isArray(parsed)) {
            const points = parsed.map((item, index) => ({
              index: index + 1,
              month: item.month || "",
              value: Number(item.monthlySearchVolume || 0),
              rank: item.averageSearchFrequencyRank ?? null,
              weeks: Array.isArray(item.weeks) ? item.weeks.map((week, weekIndex) => ({
                index: weekIndex + 1,
                from: week.from || "",
                to: week.to || "",
                value: Number(week.weeklySearchVolume || 0),
                rank: week.searchFrequencyRank ?? null
              })) : []
            })).filter((item) => item.value > 0);
            if (points.length) return points;
          }
        } catch (_) {}
      }

      const buckets = new Map();
      weeklyPoints.forEach((item) => {
        const key = item.to ? item.to.slice(0, 7) : "";
        if (!key) return;
        if (!buckets.has(key)) buckets.set(key, { month: key, value: 0, ranks: [], weeks: [] });
        const bucket = buckets.get(key);
        bucket.value += Number(item.value || 0);
        if (item.rank != null && Number.isFinite(Number(item.rank))) bucket.ranks.push(Number(item.rank));
        bucket.weeks.push(item);
      });
      return Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12).map((bucket, index) => ({
        index: index + 1,
        month: bucket.month,
        value: bucket.value,
        rank: bucket.ranks.length ? Math.round(bucket.ranks.reduce((sum, value) => sum + value, 0) / bucket.ranks.length) : null,
        weeks: bucket.weeks
      }));
    };
    const formatPeriod = (item) => {
      if (item.month) return item.month;
      if (item.from && item.to) return `${item.from} 至 ${item.to}`;
      return "日期缺失";
    };
    const trendBars = (points, keyword, weeklyDetail) => {
      if (points.length < 2) return doc.createTextNode(points.map((item) => compact(item.value)).join(" -> "));
      const max = Math.max(...points.map((item) => item.value));
      const wrap = doc.createElement("div");
      const detail = JSON.stringify(weeklyDetail && weeklyDetail.length ? weeklyDetail : points);
      wrap.innerHTML = `<div class="trend-bars" role="button" tabindex="0" data-keyword="${escapeHtml(keyword)}" data-aba-detail="${escapeHtml(detail)}" aria-label="打开 ABA 趋势明细">${points.map((item) => {
        const value = item.value;
        const height = Math.max(6, Math.round((value / (max || 1)) * 38));
        const period = formatPeriod(item);
        const title = `${period} / ABA搜索量 ${compact(value)} / ABA排名 ${item.rank ?? "-"}`;
        return `<span class="trend-bar" style="height:${height}px" title="${escapeHtml(title)}"></span>`;
      }).join("")}</div><div class="trend-meta">${points[0].month || points[0].from || ""} -> ${points[points.length - 1].month || points[points.length - 1].to || ""} · 点击看周明细</div>`;
      return wrap;
    };

    const oldTitle = oldHeader ? text(oldHeader.querySelector("h1")) : "关键词作战总表";
    const oldMeta = oldHeader ? text(oldHeader.querySelector(".meta")) : "";
    const sourceAdCell = (row) => row.cells.length >= 11 ? row.cells[9] : row.cells[8];
    const sourceAdviceCell = (row) => row.cells.length >= 11 ? row.cells[10] : row.cells[9];
    const adRows = rows.filter((row) => text(sourceAdCell(row)).indexOf("无投放") === -1);
    const weeklyTotal = rows.reduce((sum, row) => sum + numberFrom(text(row.cells[2])), 0);
    const avgDifficulty = rows.length ? Math.round(rows.reduce((sum, row) => sum + numberFrom(text(row.cells[4])), 0) / rows.length) : 0;
      const avgAcos = adRows.length ? adRows.reduce((sum, row) => {
        const match = text(sourceAdCell(row)).match(/([0-9.]+)%\s*$/);
        return sum + (match ? Number(match[1]) : 0);
      }, 0) / adRows.length : 0;

    const categoryMap = {
      profit: { label: "利润放大", className: "cat-profit" },
      guard: { label: "守住放大", className: "cat-guard" },
      hold: { label: "守住不加价", className: "cat-hold" },
      scale: { label: "谨慎加码", className: "cat-scale" },
      review: { label: "降价复查", className: "cat-review" },
      stop: { label: "暂停止损", className: "cat-stop" },
      tail: { label: "长尾测试", className: "cat-tail" },
      avoid: { label: "暂不硬碰", className: "cat-avoid" },
      season: { label: "季节布局", className: "cat-season" },
      missing: { label: "数据缺失", className: "cat-missing" },
    };
    const decodeCellValue = (value) => {
      const textarea = doc.createElement("textarea");
      textarea.innerHTML = String(value || "");
      return textarea.value;
    };
    const bidNumbersFromText = (value) => {
      const nums = String(value || "").match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      return nums.map(Number).filter(Number.isFinite);
    };
    const selfRankNumber = (value) => {
      const raw = String(value || "");
      if (/^\s*无/.test(raw)) return null;
      const pagePos = raw.match(/P\s*(\d+)\s*[·.\-:]\s*(\d+)/i);
      if (pagePos) return (Number(pagePos[1]) - 1) * 48 + Number(pagePos[2]);
      const plain = raw.match(/\d+/);
      return plain ? Number(plain[0]) : null;
    };
    const trendDirectionForRow = (row) => {
      const fallbackParts = parseTrend(text(row.cells[3]));
      const weeklyPoints = trendPoints(row.cells[3], fallbackParts);
      const points = monthlyTrendPoints(row.cells[3], weeklyPoints);
      const values = (points.length ? points : weeklyPoints).map((item) => Number(item.value || 0)).filter((n) => n > 0);
      if (values.length < 2) return "flat";
      const first = values[0];
      const last = values[values.length - 1];
      const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
      const range = Math.max(...values) - Math.min(...values);
      if (first && (last - first) / first > 0.15) return "up";
      if (first && (last - first) / first < -0.15) return "down";
      if (avg && range / avg > 0.35) return "volatile";
      return "flat";
    };
    const parseAdForRules = (row) => {
      const adCell = sourceAdCell(row);
      const encoded = adCell && adCell.getAttribute ? (adCell.dataset.ad || adCell.getAttribute("data-ad") || "") : "";
      if (encoded) {
        try {
          const data = JSON.parse(decodeCellValue(encoded));
          const impressions = numberFrom(data.impressions);
          const clicks = numberFrom(data.clicks);
          const spend = numberFrom(data.spend);
          const orders = numberFrom(data.orders);
          const sales = numberFrom(data.sales);
          const acosRaw = data.acos == null ? null : Number(data.acos);
          const acos = sales ? spend / sales * 100 : (Number.isFinite(acosRaw) ? acosRaw * (acosRaw <= 1 ? 100 : 1) : null);
          const cvr = clicks ? orders / clicks * 100 : null;
          const ctr = impressions ? clicks / impressions * 100 : null;
          return { hasData: true, impressions, clicks, spend, orders, sales, acos, cvr, ctr, targets: Array.isArray(data.targets) ? data.targets : [] };
        } catch (_) {}
      }
      const raw = text(adCell);
      if (!raw || /无投放/.test(raw)) return { hasData: false, impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, acos: null, cvr: null, ctr: null, targets: [] };
      const parts = raw.split("/").map((part) => part.trim());
      const clicks = numberFrom(parts[0]);
      const spend = numberFrom(parts[1]);
      const orders = numberFrom(parts[2]);
      const acos = numberFrom(parts[3]);
      const cvr = clicks ? orders / clicks * 100 : null;
      return { hasData: true, impressions: 0, clicks, spend, orders, acos, cvr, ctr: null, targets: [] };
    };
    const localAdviceForRow = (row) => {
      const weekly = numberFrom(text(row.cells[2]));
      const difficulty = numberFrom(text(row.cells[4]));
      const bidNumbers = bidNumbersFromText(text(row.cells[5]));
      const bidHigh = bidNumbers.length ? Math.max(...bidNumbers) : null;
      const ad = parseAdForRules(row);
      const rank = selfRankNumber(text(row.cells[6]));
      const trendDirection = trendDirectionForRow(row);
      const clicks = numberFrom(ad.clicks);
      const impressions = numberFrom(ad.impressions);
      const orders = numberFrom(ad.orders);
      const spend = numberFrom(ad.spend);
      const acos = Number.isFinite(ad.acos) ? ad.acos : null;
      const cvr = Number.isFinite(ad.cvr) ? ad.cvr : null;
      const ctr = Number.isFinite(ad.ctr) ? ad.ctr : null;
      const cpc = clicks ? spend / clicks : null;
      const selfStrong = rank !== null && rank <= 5;
      const nearBidHigh = bidHigh !== null && cpc !== null && cpc >= bidHigh * 0.9;
      const hasMarketData = weekly > 0 || difficulty > 0;
      const targetCount = Array.isArray(ad.targets) ? ad.targets.length : 0;
      const formatPct = (value) => `${Number(value).toFixed(1)}%`;
      if (!hasMarketData && !ad.hasData) {
        return { category: "missing", label: "数据缺失", text: "数据缺失：西柚或广告报表关键字段不足，先补数再判断。" };
      }
      if ((clicks >= 20 && orders === 0) || (ad.hasData && spend >= 50 && orders === 0)) {
        return { category: "stop", label: "暂停止损", text: `暂停止损：已有 ${compact(clicks)} 次点击但 0 单，优先暂停或否定，避免继续烧钱。` };
      }
      if (impressions >= 1000 && ctr !== null && ctr < 0.3) {
        return { category: "review", label: "降价复查", text: `降价复查：展示 ${compact(impressions)} 但 CTR ${formatPct(ctr)}<0.3%，先查主图、标题、价格和广告相关性。` };
      }
      if (ad.hasData && spend > 0 && ((acos !== null && acos > 45) || (cvr !== null && cvr < 5))) {
        const reason = acos !== null && acos > 45 ? `ACOS ${formatPct(acos)}>45%` : `CVR ${formatPct(cvr)}偏低`;
        return { category: "review", label: "降价复查", text: `降价复查：该词有花费且${reason}，先降 CPC，并复查主图、Listing 和价格。` };
      }
      if (orders > 0 && acos !== null && acos <= 25 && cvr !== null && cvr >= 15 && clicks >= 10) {
        return { category: "profit", label: "利润放大", text: `利润放大：已有 ${compact(orders)} 单，ACOS ${formatPct(acos)}≤25% 且 CVR ${formatPct(cvr)}，优先提高预算并强化精准投放。` };
      }
      if (orders > 0 && acos !== null && acos <= 30 && selfStrong && nearBidHigh) {
        return { category: "hold", label: "守住不加价", text: `守住不加价：ACOS ${formatPct(acos)} 可接受且自然位靠前，CPC 已接近建议上限，先稳预算不盲目提价。` };
      }
      if (orders > 0 && acos !== null && acos <= 30) {
        return { category: "guard", label: "守住放大", text: `守住放大：已有 ${compact(orders)} 单且 ACOS ${formatPct(acos)}≤30%，优先防守并放大。` };
      }
      if (orders > 0 && acos !== null && acos <= 45) {
        return { category: "scale", label: "谨慎加码", text: `谨慎加码：已有 ${compact(orders)} 单但 ACOS ${formatPct(acos)} 在30%-45%，逐步加预算观察。` };
      }
      if (orders > 0 && targetCount > 1) {
        return { category: "scale", label: "谨慎加码", text: `谨慎加码：该搜索词已出单但由 ${targetCount} 个投放对象触发，先保留效率最高对象，弱项降价或否定，避免内耗。` };
      }
      if (difficulty >= 85 && weekly >= 100000) {
        return { category: "avoid", label: "暂不硬碰", text: `暂不硬碰：周搜索量 ${compact(weekly)} 且难度 ${difficulty}，先观望或拆长尾。` };
      }
      if (trendDirection === "up" && ((orders > 0 && (acos === null || acos <= 45)) || (!ad.hasData && weekly >= 30000 && difficulty < 85))) {
        return { category: "season", label: "季节布局", text: "季节布局：ABA 12个月趋势抬升，且当前广告表现或竞争条件可接受，提前加预算或补 Exact 词。" };
      }
      if (trendDirection === "down" && ad.hasData && spend > 0) {
        return { category: "review", label: "降价复查", text: "降价复查：ABA 12个月趋势回落但广告仍有花费，建议降预算、保核心词、收泛词。" };
      }
      if (!ad.hasData && weekly >= 30000 && difficulty < 85) {
        return { category: "tail", label: "长尾测试", text: "长尾测试：搜索量中高且难度未明显过强，广告报表无投放记录，可低价 Exact 或 Phrase 小预算试投。" };
      }
      if (!ad.hasData && weekly > 0 && weekly < 100000 && difficulty < 85) {
        return { category: "tail", label: "长尾测试", text: "长尾测试：搜索量中低且竞争未明显过强，暂无投放记录，可低价小预算测试。" };
      }
      if (ad.hasData && orders > 0) {
        return { category: "scale", label: "谨慎加码", text: "谨慎加码：已有订单但效率未达到守住放大标准，先小幅加预算并观察 ACOS。" };
      }
      if (!ad.hasData) {
        return { category: "tail", label: "长尾测试", text: "长尾测试：暂无历史投放，先用低价小预算验证相关性和转化。" };
      }
      return { category: "missing", label: "数据缺失", text: "数据缺失：当前数据不足以强判断，先补充市场或广告表现后再决策。" };
    };
    const localAdviceHtml = (advice) => {
      if (!advice) return "";
      const item = categoryMap[advice.category] || categoryMap.missing;
      return `<span class="tag ${item.className}">${escapeHtml(advice.label)}</span> ${escapeHtml(advice.text.replace(`${advice.label}：`, ""))}`;
    };
    const classifyRow = (row) => {
      const local = localAdviceForRow(row);
      if (local) {
        row._localAdvice = local;
        return local.category;
      }
      const advice = text(sourceAdviceCell(row));
      if (/数据缺失/.test(advice)) return "missing";
      if (/暂停|止损|否定/.test(advice)) return "stop";
      if (/降价|复查|Listing|查图/.test(advice)) return "review";
      if (/长尾|测试/.test(advice)) return "tail";
      if (/不硬碰|硬碰/.test(advice)) return "avoid";
      if (/谨慎|加码/.test(advice)) return "scale";
      if (/守住|放大|防守/.test(advice)) return "guard";
      return "missing";
    };
    const counts = { all: rows.length };
    Object.keys(categoryMap).forEach((key) => {
      counts[key] = 0;
    });
    rows.forEach((row) => {
      const category = classifyRow(row);
      row.dataset.category = category;
      counts[category] = (counts[category] || 0) + 1;
      const adviceCell = sourceAdviceCell(row);
      const tag = adviceCell && adviceCell.querySelector(".tag");
      const categoryItem = categoryMap[category] || categoryMap.missing;
      if (tag) tag.classList.add(categoryItem.className);
    });
    const kpiMoney = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kpiPct = (value) => (value == null || !Number.isFinite(value)) ? "-" : `${value.toFixed(1)}%`;
    const adSummary = rows.reduce((summary, row) => {
      const ad = parseAdForRules(row);
      if (ad.hasData) summary.keywordCount += 1;
      summary.impressions += numberFrom(ad.impressions);
      summary.clicks += numberFrom(ad.clicks);
      summary.orders += numberFrom(ad.orders);
      summary.spend += numberFrom(ad.spend);
      summary.sales += numberFrom(ad.sales);
      return summary;
    }, { keywordCount: 0, impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 });
    adSummary.ctr = adSummary.impressions ? adSummary.clicks / adSummary.impressions * 100 : null;
    adSummary.cvr = adSummary.clicks ? adSummary.orders / adSummary.clicks * 100 : null;
    adSummary.cpc = adSummary.clicks ? adSummary.spend / adSummary.clicks : null;
    adSummary.acos = adSummary.sales ? adSummary.spend / adSummary.sales * 100 : null;
    adSummary.aov = adSummary.orders ? adSummary.sales / adSummary.orders : null;

    const hero = doc.createElement("section");
    hero.className = "report-hero";
    hero.innerHTML = `<h1>${escapeHtml(oldTitle)}</h1><p>${escapeHtml(oldMeta)}</p>`;
    main.insertBefore(hero, main.firstChild);

    const metrics = doc.createElement("section");
    metrics.className = "metric-grid";
    metrics.innerHTML =
      `<div class="metric-card"><span>关键词数</span><strong>${rows.length}</strong><small>有广告数据 ${adSummary.keywordCount}</small></div>` +
      `<div class="metric-card"><span>展示</span><strong>${compact(adSummary.impressions)}</strong><small>CTR ${kpiPct(adSummary.ctr)}</small></div>` +
      `<div class="metric-card"><span>点击</span><strong>${compact(adSummary.clicks)}</strong><small>CPC ${adSummary.cpc == null ? "-" : `$${kpiMoney(adSummary.cpc)}`}</small></div>` +
      `<div class="metric-card"><span>订单</span><strong>${compact(adSummary.orders)}</strong><small>CVR ${kpiPct(adSummary.cvr)}</small></div>` +
      `<div class="metric-card"><span>花费 USD</span><strong>$${kpiMoney(adSummary.spend)}</strong><small>广告报表汇总</small></div>` +
      `<div class="metric-card"><span>销售额 USD</span><strong>$${kpiMoney(adSummary.sales)}</strong><small>客单价 ${adSummary.aov == null ? "-" : `$${kpiMoney(adSummary.aov)}`}</small></div>` +
      `<div class="metric-card"><span>整体 ACOS</span><strong>${kpiPct(adSummary.acos)}</strong><small>广告花费 / 广告销售额</small></div>` +
      `<div class="metric-card"><span>合计周搜索量</span><strong>${compact(weeklyTotal)}</strong><small>入表关键词覆盖 · 平均难度 ${avgDifficulty}</small></div>`;
    hero.after(metrics);

    const title = doc.createElement("div");
    title.className = "table-title";
    title.innerHTML = "<h2>关键词数据</h2><span>市场、竞对、自身、广告和打法合并扫表 · 前台版本 20260816-kpi-copy</span>";
    metrics.after(title);

    const money = (value) => {
      if (!value) return "-";
      return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    const pct = (value) => (value == null || !Number.isFinite(value)) ? "-" : `${value.toFixed(1)}%`;
    const htmlOf = (node) => node ? node.innerHTML : "";
    const decodeEntities = (value) => {
      const textarea = doc.createElement("textarea");
      textarea.innerHTML = String(value || "");
      return textarea.value;
    };
    const parseAd = (input) => {
      const datasetAd = input && input.dataset && input.dataset.ad ? input.dataset.ad : "";
      const attrAd = input && input.getAttribute ? input.getAttribute("data-ad") : "";
      const encodedAd = datasetAd || attrAd || "";
      if (encodedAd) {
        try {
          const ad = JSON.parse(decodeEntities(encodedAd));
          const clicks = numberFrom(ad.clicks);
          const impressions = numberFrom(ad.impressions);
          const spend = numberFrom(ad.spend);
          const orders = numberFrom(ad.orders);
          const sales = numberFrom(ad.sales);
          const ctr = impressions ? clicks / impressions * 100 : null;
          const cpc = clicks ? spend / clicks : null;
          const cvr = clicks ? orders / clicks * 100 : null;
          const acos = sales ? spend / sales * 100 : (ad.acos != null ? Number(ad.acos) * (Number(ad.acos) <= 1 ? 100 : 1) : null);
          return { hasData: true, impressions, clicks, spend, orders, sales, ctr, cpc, cvr, acos, targets: Array.isArray(ad.targets) ? ad.targets : [] };
        } catch (_) {}
      }
      const raw = typeof input === "string" ? input : text(input);
      if (!raw || /无投放/.test(raw)) return { hasData: false };
      const parts = raw.split("/").map((part) => part.trim());
      const clicks = numberFrom(parts[0]);
      const spend = numberFrom(parts[1]);
      const orders = numberFrom(parts[2]);
      const acos = numberFrom(parts[3]);
      const cpc = clicks ? spend / clicks : null;
      const cvr = clicks ? orders / clicks * 100 : null;
      const sales = acos ? spend / (acos / 100) : null;
      return { hasData: true, clicks, spend, orders, acos, cpc, cvr, sales, targets: [] };
    };
    const parseBid = (raw) => {
      const clean = String(raw || "").replace(/\s+/g, " ");
      const recommend = clean.match(/建议\s*(\$?[0-9.]+)/);
      const range = clean.replace(/，?\s*建议\s*\$?[0-9.]+/, "").trim();
      return {
        main: recommend ? (recommend[1].startsWith("$") ? recommend[1] : `$${recommend[1]}`) : clean || "-",
        range: recommend ? range : ""
      };
    };
    const difficultyMeta = (value) => {
      if (value >= 85) return { label: "高", className: "high" };
      if (value >= 60) return { label: "中", className: "mid" };
      return { label: "低", className: "low" };
    };
    const seasonMeta = (points) => {
      const values = points.map((item) => Number(item.value || 0)).filter((n) => n > 0);
      if (values.length < 2) return { label: "暂无趋势", sub: "ABA 12月不足" };
      const first = values[0];
      const last = values[values.length - 1];
      const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
      const range = Math.max(...values) - Math.min(...values);
      const change = first ? (last - first) / first : 0;
      if (change > 0.15) return { label: "旺季抬升", sub: "按 ABA 12月趋势判断" };
      if (change < -0.15) return { label: "淡季回落", sub: "按 ABA 12月趋势判断" };
      if (avg && range / avg > 0.35) return { label: "季节波动明显", sub: "按 ABA 12月趋势判断" };
      return { label: "需求相对平稳", sub: "按 ABA 12月趋势判断" };
    };
    const marketConversionMeta = (sourceCell) => {
      if (sourceCell && sourceCell.dataset && sourceCell.dataset.marketConversion) {
        try {
          const data = JSON.parse(sourceCell.dataset.marketConversion);
          const rate = Number(data.clickConversionRate);
          if (Number.isFinite(rate)) return { label: `市场CVR ${pct(rate <= 1 ? rate * 100 : rate)}`, sub: "西柚关键词市场数据" };
        } catch (_) {}
      }
      return { label: "待接入", sub: "需要西柚市场转化字段" };
    };
    const keywordTags = (keyword, category, weekly, difficulty, ad) => {
      const categoryItem = categoryMap[category] || categoryMap.missing;
      const tags = [{ label: categoryItem.label, className: categoryItem.className }];
      if (weekly >= 100000) tags.push("高搜索");
      else if (weekly >= 30000) tags.push("中高搜索");
      else tags.push("长尾池");
      if (difficulty >= 85) tags.push("竞争强");
      if (ad.orders > 0) tags.push("已出单");
      return tags.slice(0, 4).map((tag) => {
        if (typeof tag === "string") return `<span class="keyword-chip">${escapeHtml(tag)}</span>`;
        return `<span class="keyword-chip ${tag.className}">${escapeHtml(tag.label)}</span>`;
      }).join("");
    };
    const metric = (main, sub = "") => (
      `<div class="ad-metric" style="display:grid;gap:4px;align-content:start;min-height:40px">` +
      `<strong style="display:block!important;font-size:16px!important;line-height:1.15!important;font-weight:800!important;color:#172033!important;white-space:nowrap">${escapeHtml(main)}</strong>` +
      (sub ? `<span style="display:block!important;color:#667085!important;font-size:12px!important;line-height:1.2!important;white-space:nowrap">${escapeHtml(sub)}</span>` : "") +
      `</div>`
    );
    const adTargetsHtml = (ad, fallback = "") => {
      const targets = ad && Array.isArray(ad.targets) ? ad.targets : [];
      if (!targets.length && fallback) return fallback;
      if (!targets.length) return '<span class="subtext">未记录</span>';
      const items = targets.map((item, index) => (
        `<div class="ad-target-item${index >= 3 ? " is-extra" : ""}"><strong>${escapeHtml(item.target || "未记录")}</strong><span>${escapeHtml(item.adType || "未记录")}</span></div>`
      )).join("");
      const moreCount = targets.length - 3;
      const toggle = moreCount > 0 ? `<button type="button" class="ad-target-toggle" data-ad-target-toggle data-more-count="${moreCount}" aria-expanded="false">+${moreCount} 个投放对象</button>` : "";
      return `<div class="ad-target-list" data-ad-target-list>${items}${toggle}</div>`;
    };

    const actionPanel = doc.createElement("section");
    actionPanel.className = "action-panel";
    actionPanel.innerHTML = `
      <div class="action-row" data-filter-row>
        <span class="action-title">筛选</span>
        <button class="filter-button is-active" type="button" data-filter="all">全部 ${counts.all}</button>
        ${Object.entries(categoryMap).map(([key, item]) => `<button class="filter-button ${item.className}" type="button" data-filter="${key}"><span class="dot"></span>${item.label} ${counts[key]}</button>`).join("")}
      </div>
      <div class="rule-note">
        <div><strong>利润放大</strong>：有订单，ACOS ≤ 25%，CVR ≥ 15%，且点击量足够，优先加预算、加精准词。</div>
        <div><strong>守住放大</strong>：有订单且 ACOS ≤ 30%，表现健康，优先防守核心位置并放大。</div>
        <div><strong>守住不加价</strong>：ACOS ≤ 30%，自然位靠前，且 CPC 已接近建议竞价上限，稳预算不盲目提价。</div>
        <div><strong>谨慎加码</strong>：有订单但 30% &lt; ACOS ≤ 45%，或多投放对象内耗，逐步加预算并整理投放对象。</div>
        <div><strong>降价复查</strong>：CTR &lt; 0.3%、ACOS &gt; 45%、CVR &lt; 5%，或趋势回落仍在花费，先降 CPC、查图、Listing 和价格。</div>
        <div><strong>暂停止损</strong>：点击 ≥ 20 且 0 单，或花费 ≥ $50 仍 0 单，优先暂停或否定。</div>
        <div><strong>长尾测试</strong>：暂无投放记录，搜索量可用且难度不高，低价 Exact/Phrase 小预算验证。</div>
        <div><strong>暂不硬碰</strong>：周搜索量高且难度 ≥ 85，先观望或拆长尾，避免硬冲头部词。</div>
        <div><strong>季节布局</strong>：ABA 12个月趋势抬升，且竞争或广告表现可接受，提前补词或加预算。</div>
        <div><strong>数据缺失</strong>：西柚或广告报表关键字段缺失，不做强判断，先补数再判断。</div>
      </div>
    `;
    title.after(actionPanel);

    const thead = table.querySelector("thead");
    if (thead) {
      const h = (label, tip) => `<span class="th-label">${escapeHtml(label)}<span class="th-help" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">?</span></span>`;
      thead.innerHTML =
        `<tr class="group-row">` +
        `<th rowspan="2">${h("关键词 / 标签", "关键词来自西柚按目标 ASIN 反查出的相关词；标签由前台根据打法建议、搜索量、难度和广告表现补充，用于运营扫表。")}</th>` +
        `<th rowspan="2">${h("ASIN总流量", "来自西柚 ASIN 反查关键词结果，表示该关键词给目标 ASIN 带来的流量估算；不是市场总搜索量，也不是广告展示。")}</th>` +
        `<th class="group-market" colspan="5">${h("市场", "来自西柚关键词信息、ABA 趋势和市场转化字段，用来判断搜索热度、竞争强度、竞价和季节性。")}</th>` +
        `<th class="group-competition" colspan="1">${h("竞对", "来自西柚关键词下 ASIN 分析，展示该词点击前三 ASIN、主图和流量/自然位数据；“领跑”表示在点击前三里排除目标 ASIN 后，流量最高的竞对。")}</th>` +
        `<th class="group-self" colspan="1">${h("自身", "来自西柚关键词下目标 ASIN 与最强竞对的自然搜索位置对比，用来判断自己是否已经有自然位优势。")}</th>` +
        `<th class="group-ad" colspan="7">${h("广告报表数据", "来自你上传的广告搜索词报表，主关键词按真实搜索词聚合；投放词列展示触发该搜索词的投放对象和广告类型，其余列按搜索词汇总展示、点击、订单、花费和销售额，并重算 CTR、CVR、CPC、ACOS。")}</th>` +
        `<th rowspan="2">${h("打法建议", "优先按已确认的本地规则生成：利润放大、守住放大、守住不加价、谨慎加码、降价复查、暂停止损、长尾测试、暂不硬碰、季节布局或数据缺失；豆包可作为后续增强，但接口欠费或失败时不会直接展示报错。")}</th>` +
        `</tr>` +
        `<tr>` +
        `<th>${h("搜索量 + ABA 12月", "最新周搜索量来自西柚 ABA 周搜索量；柱状图为近 52 周聚合成近 12 个月趋势，点击可看周日期区间、搜索量和 ABA 排名。")}</th>` +
        `<th>${h("难度", "来自西柚关键词投放难度，数值越高代表竞争越强；当前前台按低/中/高给颜色提示，难度 ≥ 85 视为竞争强。")}</th>` +
        `<th>${h("建议竞价", "来自西柚关键词建议竞价，主数字为建议 CPC，下面显示建议区间，用于判断出价起点。")}</th>` +
        `<th>${h("市场转化相关", "来自西柚关键词市场转化字段，优先展示市场点击转化率等大盘转化信息；不是你的广告报表 CVR。")}</th>` +
        `<th>${h("季节性标注", "根据近 12 个月 ABA 趋势自动判断抬升、回落、平稳或波动，帮助识别淡旺季。")}</th>` +
        `<th>${h("点击前三ASIN", "来自西柚关键词 ASIN 分析，展示该词点击前三的 ASIN、主图、ASIN总流量和自然位。“领跑”是本工具标记的最强竞对：在点击前三中排除目标 ASIN 后，按西柚返回流量最高的非自己 ASIN 选出，用于判断谁在这个词下最值得对标。")}</th>` +
        `<th>${h("自己 vs 最强竞对自然位", "目标 ASIN 与最强竞对在该关键词自然搜索结果中的位置对比；按西柚返回的原始页码/位置展示，例如 P1·1 vs P1·4，显示“无”代表没有拿到自然位。")}</th>` +
        `<th>${h("投放词/广告类型", "来自上传广告报表的投放列、广告活动、广告组和匹配类型。黑体为触发该搜索词的投放词/投放对象；下一行小字为广告类型，例如 SP-Manual、SP-Auto、SB-视频。一个搜索词命中多个投放对象时同格分条展示。")}</th>` +
        `<th>${h("展示", "来自上传广告报表的展示量，按搜索词汇总；表示广告被展示的次数。")}</th>` +
        `<th>${h("点击/CTR", "点击来自广告报表点击量；CTR=点击/展示，显示在底下小字，用来判断广告吸引点击能力。")}</th>` +
        `<th>${h("CPC", "由广告报表重算：CPC=花费/点击；用于判断当前点击成本是否偏高。")}</th>` +
        `<th>${h("订单/CVR", "订单来自广告报表 7 天总订单；CVR=订单/点击，显示在底下小字，用来判断广告转化效率。")}</th>` +
        `<th>${h("花费", "来自广告报表花费汇总，按搜索词聚合。")}</th>` +
        `<th>${h("销售额/ACOS", "销售额来自广告报表 7 天总销售额；ACOS=花费/销售额，显示在底下小字，是打法标签的重要判断依据。")}</th>` +
        `</tr>`;
    }
    const oldColgroup = table.querySelector("colgroup");
    if (oldColgroup) oldColgroup.remove();
    const colgroup = doc.createElement("colgroup");
    [190, 130, 240, 110, 130, 150, 155, 270, 95, 170, 105, 125, 110, 125, 120, 155, 320].forEach((width) => {
      const col = doc.createElement("col");
      col.style.width = `${width}px`;
      col.dataset.defaultWidth = String(width);
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    if (thead) {
      const sortableColumns = new Set([1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15]);
      const firstRowSpans = thead.querySelectorAll("tr:first-child th[rowspan]");
      if (firstRowSpans[0]) firstRowSpans[0].dataset.colIndex = "0";
      if (firstRowSpans[1]) firstRowSpans[1].dataset.colIndex = "1";
      if (firstRowSpans[2]) firstRowSpans[2].dataset.colIndex = "16";
      thead.querySelectorAll("tr:last-child th").forEach((th, index) => {
        th.dataset.colIndex = String(index + 2);
      });
      thead.querySelectorAll("th[data-col-index]").forEach((th) => {
        const index = Number(th.dataset.colIndex);
        if (sortableColumns.has(index)) {
          th.dataset.sortable = "number";
          th.insertAdjacentHTML("beforeend", '<button type="button" class="sort-button" data-sort-button title="点击按本列数值排序，默认从大到小" aria-label="按本列数值排序"><span class="sort-up"></span><span class="sort-down"></span></button>');
        }
        th.insertAdjacentHTML("beforeend", '<span class="resize-handle" title="拖动调整列宽，双击恢复默认宽度" aria-hidden="true"></span>');
      });
    }

    rows.forEach((row) => {
      const original = Array.from(row.cells);
      const keyword = text(original[0]);
      const asinTraffic = text(original[1]);
      const weekly = numberFrom(text(original[2]));
      const trendParts = parseTrend(text(original[3]));
      const abaPoints = trendPoints(original[3], trendParts);
      const monthlyPoints = monthlyTrendPoints(original[3], abaPoints);
      const difficulty = numberFrom(text(original[4]));
      const diff = difficultyMeta(difficulty);
      const bid = parseBid(text(original[5]));
      const selfRank = text(original[6]) || "-";
      const competitorHtml = htmlOf(original[7]) || "-";
      const hasTargetColumn = original.length >= 11;
      const targetHtml = hasTargetColumn ? htmlOf(original[8]) : "";
      const ad = parseAd(hasTargetColumn ? original[9] : original[8]);
      const adviceHtml = row._localAdvice ? localAdviceHtml(row._localAdvice) : htmlOf(hasTargetColumn ? original[10] : original[9]);
      const category = row.dataset.category || classifyRow(row);
      const season = seasonMeta(monthlyPoints.length ? monthlyPoints : abaPoints);
      const conversion = marketConversionMeta(original[2]);
      const trendWrap = doc.createElement("div");
      if (monthlyPoints.length > 1) trendWrap.appendChild(trendBars(monthlyPoints, keyword, abaPoints));
      else if (abaPoints.length > 1) trendWrap.appendChild(trendBars(abaPoints, keyword, abaPoints));
      else trendWrap.textContent = "-";
      const trendHtml = trendWrap.innerHTML || trendWrap.textContent;
      const keywordHtml = `<span class="keyword-name">${escapeHtml(keyword)}</span><span class="keyword-tags">${keywordTags(keyword, category, weekly, difficulty, ad)}</span>`;
      const searchHtml = `<div class="market-cell"><span class="market-main">${compact(weekly)}</span>${trendHtml}</div>`;
      const difficultyHtml = `<span class="difficulty-pill ${diff.className}">${difficulty || "-"} · ${diff.label}</span>`;
      const bidHtml = `<span class="bid-main">${escapeHtml(bid.main)}</span><span class="bid-range">${escapeHtml(bid.range || "无区间")}</span>`;
      const conversionHtml = `<span class="conversion-chip pending">${conversion.label}</span><span class="subtext">${escapeHtml(conversion.sub)}</span>`;
      const seasonHtml = `<span class="season-chip">${season.label}</span><span class="subtext">${escapeHtml(season.sub)}</span>`;
      const adClickHtml = metric(ad.hasData ? compact(ad.clicks) : "-", `CTR ${ad.hasData ? pct(ad.ctr) : "-"}`);
      const adOrderHtml = metric(ad.hasData ? compact(ad.orders) : "-", `CVR ${ad.hasData ? pct(ad.cvr) : "-"}`);
      const adSalesHtml = metric(ad.hasData && Number.isFinite(ad.sales) && ad.sales > 0 ? money(ad.sales) : "-", `ACOS ${ad.hasData ? pct(ad.acos) : "-"}`);
      row.innerHTML =
        `<td>${keywordHtml}</td>` +
        `<td><span class="market-main">${escapeHtml(asinTraffic || "-")}</span></td>` +
        `<td>${searchHtml}</td>` +
        `<td>${difficultyHtml}</td>` +
        `<td>${bidHtml}</td>` +
        `<td>${conversionHtml}</td>` +
        `<td>${seasonHtml}</td>` +
        `<td>${competitorHtml}</td>` +
        `<td>${escapeHtml(selfRank)}</td>` +
        `<td>${adTargetsHtml(ad, targetHtml)}</td>` +
        `<td>${metric(ad.hasData && Number.isFinite(ad.impressions) && ad.impressions > 0 ? compact(ad.impressions) : "-")}</td>` +
        `<td>${adClickHtml}</td>` +
        `<td>${metric(ad.hasData && Number.isFinite(ad.cpc) && ad.cpc > 0 ? money(ad.cpc) : "-")}</td>` +
        `<td>${adOrderHtml}</td>` +
        `<td>${metric(ad.hasData && Number.isFinite(ad.spend) ? money(ad.spend) : "-")}</td>` +
        `<td>${adSalesHtml}</td>` +
        `<td>${adviceHtml}</td>`;
      const tag = row.cells[16] && row.cells[16].querySelector(".tag");
      const categoryItem = categoryMap[category] || categoryMap.missing;
      if (tag) tag.classList.add(categoryItem.className);
    });

    const enhanceOrganicModule = () => {
      const organicModule = doc.querySelector('[data-report-module="02"]');
      const organicTable = organicModule && organicModule.querySelector(".organic-table");
      if (!organicModule || !organicTable) return;
      if (organicTable.classList.contains("organic-rich-table")) return;

      const summary = organicModule.querySelector(".module-summary");
      if (summary) summary.classList.add("organic-summary");

      const existingTitle = organicModule.querySelector(".organic-title");
      if (!existingTitle) {
        const title = doc.createElement("div");
        title.className = "table-title organic-title";
        title.innerHTML = '<h2>自然位标杆</h2><span>复用本任务留底数据 · 不新调西柚</span>';
        if (summary) summary.before(title);
        else organicModule.insertBefore(title, organicModule.firstChild);
      }

      if (!organicModule.querySelector(".organic-rule-note")) {
        const rule = doc.createElement("section");
        rule.className = "rule-note organic-rule-note";
        rule.innerHTML = `
          <div><strong>我的自然位</strong>：取目标 ASIN 在 ranks 里自然位 or 的最小 totalRank，未上榜显示 --。</div>
          <div><strong>我的广告位</strong>：取目标 ASIN 在 sp/sb/sbv 广告位里的最小 totalRank，未上榜显示 --。</div>
          <div><strong>标杆 ASIN</strong>：只从已抓取的点击前三竞对里挑自然位最靠前的非自己 ASIN，不另查全货架。</div>
          <div><strong>差距</strong>：我的自然位减标杆自然位，正数代表落后位数；未上榜不参与差距，排序放最后。</div>
        `;
        const tableWrap = organicTable.closest(".table-wrap") || organicTable;
        tableWrap.before(rule);
      }

      const organicHead = organicTable.querySelector("thead");
      const oh = (label, tip) => `<span class="th-label">${escapeHtml(label)}<span class="th-help" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">?</span></span>`;
      if (organicHead) {
        organicHead.innerHTML =
          `<tr class="group-row">` +
          `<th rowspan="2">${oh("关键词", "关键词与 01 总表一致，来自本任务已留底的西柚关键词数据。")}</th>` +
          `<th class="group-self" colspan="2">${oh("自身", "目标 ASIN 在该关键词下的自然位和广告位；未上榜统一显示 --。")}</th>` +
          `<th class="group-competition" colspan="2">${oh("自然位标杆", "仅从已抓取点击前三竞对中选择自然位最靠前的非自己 ASIN，用作可追赶参照。")}</th>` +
          `<th rowspan="2">${oh("差距", "差距=我的自然位-标杆自然位；正数代表落后，越小越接近标杆。")}</th>` +
          `</tr>` +
          `<tr>` +
          `<th>${oh("我的自然位", "目标 ASIN ranks 里 or 的最小 totalRank，按页码/位置换算为总位次参与排序。")}</th>` +
          `<th>${oh("我的广告位", "目标 ASIN ranks 里 sp/sb/sbv 的最小 totalRank，按页码/位置换算为总位次参与排序。")}</th>` +
          `<th>${oh("标杆 ASIN", "标杆主图 URL 来自留底数据，只引用 URL，不下载图片。")}</th>` +
          `<th>${oh("标杆自然位", "标杆 ASIN 在该关键词自然位里的最小 totalRank。")}</th>` +
          `</tr>`;
      }

      const oldColgroup = organicTable.querySelector("colgroup");
      if (oldColgroup) oldColgroup.remove();
      const colgroup = doc.createElement("colgroup");
      [220, 150, 150, 310, 150, 150].forEach((width) => {
        const col = doc.createElement("col");
        col.style.width = `${width}px`;
        col.dataset.defaultWidth = String(width);
        colgroup.appendChild(col);
      });
      organicTable.insertBefore(colgroup, organicTable.firstChild);

      if (organicHead) {
        const sortableColumns = new Set([1, 2, 4, 5]);
        const firstRowSpans = organicHead.querySelectorAll("tr:first-child th[rowspan]");
        if (firstRowSpans[0]) firstRowSpans[0].dataset.colIndex = "0";
        if (firstRowSpans[1]) firstRowSpans[1].dataset.colIndex = "5";
        organicHead.querySelectorAll("tr:last-child th").forEach((th, index) => {
          th.dataset.colIndex = String(index + 1);
        });
        organicHead.querySelectorAll("th[data-col-index]").forEach((th) => {
          const index = Number(th.dataset.colIndex);
          if (sortableColumns.has(index)) {
            th.dataset.sortable = "number";
            th.insertAdjacentHTML("beforeend", '<button type="button" class="sort-button" data-sort-button title="点击按本列数值排序，默认从小到大/从大到小切换" aria-label="按本列数值排序"><span class="sort-up"></span><span class="sort-down"></span></button>');
          }
          th.insertAdjacentHTML("beforeend", '<span class="resize-handle" title="拖动调整列宽，双击恢复默认宽度" aria-hidden="true"></span>');
        });
      }

      const rankHtml = (value, sub) => {
        const clean = escapeHtml(value || "--");
        if (!value || value === "--") return '<span class="distance-empty">--</span>';
        return `<span class="rank-cell"><strong class="rank-main">${clean}</strong><span class="rank-sub">${escapeHtml(sub)}</span></span>`;
      };
      organicTable.querySelectorAll("tbody tr").forEach((row) => {
        const cells = Array.from(row.cells);
        if (cells.length < 6 || row.dataset.organicEnhanced === "true") return;
        const ownOrganic = text(cells[1]);
        const ownAd = text(cells[2]);
        const benchmarkRank = text(cells[4]);
        row.innerHTML =
          `<td class="keyword">${escapeHtml(text(cells[0]))}</td>` +
          `<td>${rankHtml(ownOrganic, "自然位")}</td>` +
          `<td>${rankHtml(ownAd, "广告位")}</td>` +
          `<td>${htmlOf(cells[3]) || '<span class="distance-empty">--</span>'}</td>` +
          `<td>${rankHtml(benchmarkRank, "标杆自然位")}</td>` +
          `<td>${htmlOf(cells[5]) || '<span class="distance-empty">--</span>'}</td>`;
        row.dataset.organicEnhanced = "true";
      });
    };
    enhanceOrganicModule();

    doc.querySelectorAll(".asin").forEach((node) => {
      let img = node.querySelector("img");
      const asin = (text(node).match(/B0[A-Z0-9]{8}/) || [])[0];
      const label = asin ? asin.slice(0, 4) : (text(node).slice(0, 4) || "ASIN");
      const fallback = () => {
        const span = doc.createElement("span");
        span.className = "image-fallback";
        span.textContent = label;
        if (img && img.parentNode) img.replaceWith(span);
        else node.insertBefore(span, node.firstChild);
      };
      if (!img || !img.getAttribute("src")) {
        if (asin) {
          img = doc.createElement("img");
          img.src = `https://m.media-amazon.com/images/P/${asin}.01._AC_US40_.jpg`;
          node.insertBefore(img, node.firstChild);
        } else {
          fallback();
          return;
        }
      }
      if (img.getAttribute("src").startsWith("http://")) {
        img.setAttribute("src", img.getAttribute("src").replace(/^http:\/\//, "https://"));
      }
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("loading", "lazy");
      img.setAttribute("onerror", "this.replaceWith(Object.assign(document.createElement('span'), { className: 'image-fallback', textContent: this.parentNode.textContent.trim().slice(0,4) || 'ASIN' }))");
    });

    const abaModal = doc.createElement("div");
    abaModal.className = "aba-modal-backdrop";
    abaModal.innerHTML = `
      <div class="aba-modal" role="dialog" aria-modal="true" aria-labelledby="aba-modal-title">
        <div class="aba-modal-head">
          <h3 id="aba-modal-title">ABA趋势明细</h3>
          <button type="button" class="aba-modal-close" aria-label="关闭">×</button>
        </div>
        <div class="aba-modal-body">
          <p class="aba-modal-keyword"></p>
          <table class="aba-detail-table">
            <thead><tr><th>时间段</th><th>ABA搜索量</th><th>ABA排名</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;
    doc.body.appendChild(abaModal);

    const filterScript = doc.createElement("script");
    filterScript.textContent = `
      function sortNumberFromCell(cell) {
        if (!cell) return null;
        var text = (cell.textContent || '').replace(/,/g, '').replace(/\\$/g, '');
        if (/--/.test(text) || /未上榜/.test(text)) return null;
        var rankMatch = text.match(/P\\s*(\\d+)\\s*[·.\\-]\\s*(\\d+)/i);
        if (rankMatch) {
          var page = Number(rankMatch[1]);
          var position = Number(rankMatch[2]);
          var rankValue = (page - 1) * 48 + position;
          return Number.isFinite(rankValue) ? rankValue : null;
        }
        var match = text.match(/-?\\d+(?:\\.\\d+)?/);
        if (!match) return null;
        var value = Number(match[0]);
        return Number.isFinite(value) ? value : null;
      }
      function sortTableByColumn(th, direction) {
        var index = Number(th.getAttribute('data-col-index'));
        var table = th.closest('table');
        var tbody = table && table.querySelector('tbody');
        if (!tbody || !Number.isFinite(index)) return;
        var rows = Array.from(tbody.querySelectorAll('tr')).map(function (row, order) {
          return { row: row, order: order, value: sortNumberFromCell(row.cells[index]) };
        });
        rows.sort(function (a, b) {
          var aHas = a.value !== null;
          var bHas = b.value !== null;
          if (!aHas && !bHas) return a.order - b.order;
          if (!aHas) return 1;
          if (!bHas) return -1;
          if (a.value === b.value) return a.order - b.order;
          return direction === 'asc' ? a.value - b.value : b.value - a.value;
        });
        rows.forEach(function (item) { tbody.appendChild(item.row); });
      }
      function openAbaModal(trigger) {
        var modal = document.querySelector('.aba-modal-backdrop');
        if (!modal) return;
        var keyword = trigger.getAttribute('data-keyword') || '';
        var raw = trigger.getAttribute('data-aba-detail') || '[]';
        var rows = [];
        try { rows = JSON.parse(raw); } catch (_) { rows = []; }
        modal.querySelector('.aba-modal-keyword').textContent = keyword;
        modal.querySelector('tbody').innerHTML = rows.map(function (item) {
          var period = item.from && item.to ? item.from + ' 至 ' + item.to : (item.month || '日期缺失');
          var value = Number(item.value || 0).toLocaleString('en-US');
          var rank = item.rank == null ? '-' : Number(item.rank).toLocaleString('en-US');
          return '<tr><td>' + period + '</td><td>' + value + '</td><td>' + rank + '</td></tr>';
        }).join('');
        modal.classList.add('is-open');
      }
      function closeAbaModal() {
        var modal = document.querySelector('.aba-modal-backdrop');
        if (modal) modal.classList.remove('is-open');
      }
      document.addEventListener('click', function (event) {
        var sortButton = event.target.closest && event.target.closest('[data-sort-button]');
        if (sortButton) {
          event.preventDefault();
          event.stopPropagation();
          var th = sortButton.closest('th[data-col-index]');
          if (!th) return;
          var nextDirection = sortButton.classList.contains('is-desc') ? 'asc' : 'desc';
          var table = th.closest('table');
          (table ? table.querySelectorAll('[data-sort-button]') : document.querySelectorAll('[data-sort-button]')).forEach(function (button) {
            button.classList.remove('is-asc', 'is-desc');
            button.setAttribute('aria-sort', 'none');
          });
          sortButton.classList.add(nextDirection === 'asc' ? 'is-asc' : 'is-desc');
          sortButton.setAttribute('aria-sort', nextDirection === 'asc' ? 'ascending' : 'descending');
          sortTableByColumn(th, nextDirection);
          return;
        }
        var adTargetToggle = event.target.closest && event.target.closest('[data-ad-target-toggle]');
        if (adTargetToggle) {
          var list = adTargetToggle.closest('[data-ad-target-list]');
          if (!list) return;
          var expanded = list.classList.toggle('is-expanded');
          adTargetToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          var count = adTargetToggle.getAttribute('data-more-count') || '0';
          adTargetToggle.textContent = expanded ? '收起投放对象' : '+' + count + ' 个投放对象';
          return;
        }
        var trend = event.target.closest && event.target.closest('.trend-bars[data-aba-detail]');
        if (trend) {
          openAbaModal(trend);
          return;
        }
        if (event.target.closest && event.target.closest('.aba-modal-close')) closeAbaModal();
        if (event.target.classList && event.target.classList.contains('aba-modal-backdrop')) closeAbaModal();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeAbaModal();
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches && event.target.matches('.trend-bars[data-aba-detail]')) {
          event.preventDefault();
          openAbaModal(event.target);
        }
      });
      document.querySelectorAll('[data-filter]').forEach(function (button) {
        button.addEventListener('click', function () {
          var value = button.getAttribute('data-filter');
          document.querySelectorAll('[data-filter]').forEach(function (item) { item.classList.remove('is-active'); });
          button.classList.add('is-active');
          var masterTable = document.querySelector('[data-report-module="01"] table') || document.querySelector('table');
          if (!masterTable) return;
          masterTable.querySelectorAll('tbody tr').forEach(function (row) {
            row.classList.toggle('is-hidden', value !== 'all' && row.dataset.category !== value);
          });
        });
      });
      document.addEventListener('dblclick', function (event) {
        var handle = event.target.closest && event.target.closest('.resize-handle');
        if (!handle) return;
        var th = handle.parentElement;
        var index = Number(th.getAttribute('data-col-index'));
        var table = th.closest('table');
        var col = table && table.querySelectorAll('colgroup col')[index];
        if (col && col.dataset.defaultWidth) col.style.width = col.dataset.defaultWidth + 'px';
      });
      document.addEventListener('mousedown', function (event) {
        var handle = event.target.closest && event.target.closest('.resize-handle');
        if (handle) {
          event.preventDefault();
          var th = handle.parentElement;
          var index = Number(th.getAttribute('data-col-index'));
          var table = th.closest('table');
          var col = table && table.querySelectorAll('colgroup col')[index];
          if (!col) return;
          var startX = event.clientX;
          var startWidth = parseInt(col.style.width, 10) || th.offsetWidth;
          handle.classList.add('is-dragging');
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          function move(moveEvent) {
            var next = Math.max(72, startWidth + moveEvent.clientX - startX);
            col.style.width = next + 'px';
          }
          function up() {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle.classList.remove('is-dragging');
          }
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        }
      });
    `;
    doc.body.appendChild(filterScript);

    return doc.documentElement.outerHTML;
  }

  window.YiquApp = {
    initAuthPage,
    initToolPage,
    initReportPage
  };
})();
