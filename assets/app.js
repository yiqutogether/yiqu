(function () {
  const config = {
    supabaseUrl: "https://pltebbyumdjojipudwny.supabase.co",
    publishableKey: "sb_publishable_3Db-M-ZwCi5aeaMF0-BBhg_oAoxpLBK",
    inboxBucket: "keyword-tool-inbox",
    maxUploadBytes: 20 * 1024 * 1024
  };

  const storageKey = "yiqu_session";
  const taskStatusClass = {
    "待处理": "status-pending",
    "进行中": "status-running",
    "已完成": "status-done",
    "失败": "status-failed"
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

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const asin = $("#asin").value.trim().toUpperCase();
      const file = $("#report-file").files[0];
      if (!/^B0[A-Z0-9]{8}$/.test(asin)) {
        setMessage(message, "ASIN需要是10位，并且以B0开头。", "error");
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
            upload_path: uploadPath
          })
        }, true);

        form.reset();
        $("#site").value = "US";
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
          "/rest/v1/keyword_tasks?select=id,asin,status,failure_reason,report_url,created_at,completed_at&order=created_at.desc&limit=100",
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
        const report = row.status === "已完成" && row.report_url
          ? `<a class="ghost-button" href="../report/?task=${encodeURIComponent(row.id)}">查看报告</a>`
          : "";
        return `
          <article class="task-card">
            <div><strong>${escapeHtml(row.asin)}</strong><span class="task-meta">${createdAt}</span></div>
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
      const response = await fetch(reportUrl);
      if (!response.ok) throw new Error("报告文件读取失败。");
      const html = await response.text();
      frame.srcdoc = html;
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

  window.YiquApp = {
    initAuthPage,
    initToolPage,
    initReportPage
  };
})();
