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
        .metric-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
        .metric-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; padding: 13px 16px; box-shadow: 0 6px 18px rgba(15, 23, 42, .04); }
        .metric-card span { display: block; color: #667085; font-size: 12px; margin-bottom: 6px; }
        .metric-card strong { display: block; color: #0f172a; font-size: 22px; line-height: 1.1; }
        .table-title { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 10px; }
        .table-title h2 { margin: 0; font-size: 18px; }
        .table-title span { color: #667085; font-size: 12px; }
        .table-wrap { border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, .06); }
        table { min-width: 1740px !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 0 !important; }
        th, td { font-size: 12px !important; padding: 11px 10px !important; border-bottom: 1px solid #dfe6ee !important; }
        th { color: #17324d !important; background: #eef4fb !important; }
        tbody tr:nth-child(even) td { background: #fbfdff; }
        tbody tr:hover td { background: #f6fbff; }
        th:nth-child(1), td:nth-child(1) { width: 180px; position: sticky; left: 0; z-index: 2; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
        thead th:nth-child(1) { z-index: 4; background: #e9f0f8 !important; }
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

          var adRows = rows.filter(function (row) { return text(row.cells[8]).indexOf("无投放") === -1; });
          var weeklyTotal = rows.reduce(function (sum, row) { return sum + numberFrom(text(row.cells[2])); }, 0);
          var avgDifficulty = rows.length ? Math.round(rows.reduce(function (sum, row) { return sum + numberFrom(text(row.cells[4])); }, 0) / rows.length) : 0;
          var avgAcos = adRows.length ? adRows.reduce(function (sum, row) {
            var match = text(row.cells[8]).match(/([0-9.]+)%\\s*$/);
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
            '<div class="metric-card"><span>合计周搜索量</span><strong>' + compact(weeklyTotal) + '</strong></div>' +
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
              '<th>ASIN总流量</th><th>周搜索量</th><th>ABA 13周</th><th>难度</th><th>建议竞价</th>' +
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
    const table = doc.querySelector("table");
    const main = doc.querySelector("main") || doc.body;
    const oldHeader = doc.querySelector("header");
    const rows = Array.from(doc.querySelectorAll("tbody tr"));

    const style = doc.createElement("style");
    style.textContent = `
      body { margin: 0; background: #f3f6fa !important; color: #172033 !important; font-family: Arial, "Microsoft YaHei", sans-serif; }
      body > header { display: none !important; }
      main { max-width: 1680px; margin: 0 auto; padding: 22px 24px 36px !important; }
      .report-hero { margin-bottom: 14px; padding: 22px 24px; border-radius: 8px; color: #fff; background: linear-gradient(120deg, #123a70, #2468d8); }
      .report-hero h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
      .report-hero p { margin: 0; color: rgba(255,255,255,.82); font-size: 13px; }
      .metric-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
      .metric-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; padding: 13px 16px; box-shadow: 0 6px 18px rgba(15, 23, 42, .04); }
      .metric-card span { display: block; color: #667085; font-size: 12px; margin-bottom: 6px; }
      .metric-card strong { display: block; color: #0f172a; font-size: 22px; line-height: 1.1; }
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
      .cat-guard { color: #1677ff; background: #edf5ff; }
      .cat-scale { color: #12a150; background: #ebf8f0; }
      .cat-review { color: #d99000; background: #fff7e5; }
      .cat-stop { color: #dc2626; background: #fff1f1; }
      .cat-tail { color: #7a4cc2; background: #f4f0ff; }
      .cat-avoid { color: #667085; background: #f1f3f6; }
      .cat-missing { color: #475467; background: #eef2f6; }
      .rule-note { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 6px 16px; color: #667085; font-size: 13px; line-height: 1.6; padding: 12px 14px; background: #fff; border: 1px solid #d9e1ea; border-radius: 8px; }
      .rule-note div { min-width: 0; }
      tr.is-hidden { display: none; }
      .table-wrap { border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, .06); }
      table { min-width: 2520px !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 0 !important; }
      th, td { position: relative; font-size: 12px !important; padding: 11px 10px !important; border-bottom: 1px solid #dfe6ee !important; vertical-align: top; }
      th { color: #17324d !important; background: #eef4fb !important; }
      th[data-col-index] { user-select: none; }
      th .resize-handle { position: absolute; top: 0; right: 0; width: 10px; height: 100%; cursor: col-resize; z-index: 8; }
      th .resize-handle::after { content: ""; position: absolute; top: 9px; bottom: 9px; right: 3px; width: 2px; border-radius: 2px; background: rgba(47, 111, 206, .28); }
      th .resize-handle:hover::after, th .resize-handle.is-dragging::after { right: 2px; width: 4px; background: #2f6fce; }
      tbody tr:nth-child(even) td { background: #fbfdff; }
      tbody tr:hover td { background: #f6fbff; }
      th:nth-child(1), td:nth-child(1) { width: 180px; position: sticky; left: 0; z-index: 2; background: #fff; box-shadow: 6px 0 14px rgba(15, 23, 42, .05); }
      thead th:nth-child(1) { z-index: 4; background: #e9f0f8 !important; }
      td:nth-child(6), td:nth-child(7), td:nth-child(15) { line-height: 1.45; }
      .group-row th { text-align: center !important; font-weight: 700; border-bottom: 1px solid #cad6e3 !important; }
      .group-market { background: #eaf7f2 !important; color: #006b55 !important; }
      .group-competition { background: #fff4e5 !important; color: #9a5a00 !important; }
      .group-self { background: #eef4ff !important; color: #2452b8 !important; }
      .group-ad { background: #f4f0ff !important; color: #6941c6 !important; }
      .market-cell { display: grid; gap: 5px; }
      .market-main { font-weight: 800; font-size: 15px; color: #172033; }
      .market-sub, .subtext { color: #667085; font-size: 11px; line-height: 1.35; }
      .trend-bars { display: flex; align-items: flex-end; gap: 2px; width: 160px; height: 42px; margin-top: 5px; }
      .trend-bar { flex: 1 1 0; min-width: 3px; border-radius: 2px 2px 0 0; background: #39a892; }
      .trend-meta { color: #667085; font-size: 10px; line-height: 1.25; margin-top: 3px; }
      .keyword-name { display: block; font-weight: 800; margin-bottom: 8px; }
      .keyword-tags { display: flex; flex-wrap: wrap; gap: 5px; }
      .keyword-chip, .season-chip, .conversion-chip, .difficulty-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
      .keyword-chip { background: #eef5ff; color: #175cd3; }
      .keyword-chip.cat-guard { color: #1677ff; background: #edf5ff; }
      .keyword-chip.cat-scale { color: #12a150; background: #ebf8f0; }
      .keyword-chip.cat-review { color: #d99000; background: #fff7e5; }
      .keyword-chip.cat-stop { color: #dc2626; background: #fff1f1; }
      .keyword-chip.cat-tail { color: #7a4cc2; background: #f4f0ff; }
      .keyword-chip.cat-avoid { color: #667085; background: #f1f3f6; }
      .keyword-chip.cat-missing { color: #475467; background: #eef2f6; }
      .conversion-chip { background: #eaf7f1; color: #0f8f61; }
      .conversion-chip.pending { background: #eef2f6; color: #475467; }
      .season-chip { background: #fff7e5; color: #a15c00; }
      .difficulty-pill.low { background: #eaf7f1; color: #0f8f61; }
      .difficulty-pill.mid { background: #fff7e5; color: #a15c00; }
      .difficulty-pill.high { background: #fff1f1; color: #dc2626; }
      .bid-main { display: block; font-size: 15px; font-weight: 800; color: #172033; margin-bottom: 4px; }
      .bid-range { display: block; color: #667085; font-size: 11px; }
      .ad-main { display: block; font-size: 15px; font-weight: 800; color: #172033; }
      .ad-sub { display: block; color: #667085; font-size: 11px; margin-top: 3px; }
      .ad-empty { color: #98a2b3; font-weight: 700; }
      .asin { display: grid !important; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: center; margin-bottom: 7px !important; line-height: 1.25; }
      .asin img, .image-fallback { width: 30px; height: 30px; object-fit: cover; background: #eef1f5; border: 1px solid #dde3ea; border-radius: 5px; }
      .image-fallback { display: inline-flex; align-items: center; justify-content: center; color: #667085; font-size: 10px; font-weight: 700; }
      .tag { border-radius: 999px !important; padding: 3px 8px !important; }
      .tag.cat-guard { color: #1677ff !important; background: #edf5ff !important; }
      .tag.cat-scale { color: #12a150 !important; background: #ebf8f0 !important; }
      .tag.cat-review { color: #d99000 !important; background: #fff7e5 !important; }
      .tag.cat-stop { color: #dc2626 !important; background: #fff1f1 !important; }
      .tag.cat-tail { color: #7a4cc2 !important; background: #f4f0ff !important; }
      .tag.cat-avoid { color: #667085 !important; background: #f1f3f6 !important; }
      .tag.cat-missing { color: #475467 !important; background: #eef2f6 !important; }
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
    const trendBars = (parts) => {
      const values = parts.map(trendValue).filter((n) => n > 0);
      if (values.length < 2) return doc.createTextNode(parts.join(" -> "));
      const max = Math.max(...values);
      const wrap = doc.createElement("div");
      wrap.innerHTML = `<div class="trend-bars" role="img" aria-label="ABA 13周趋势">${values.map((value) => {
        const height = Math.max(6, Math.round((value / (max || 1)) * 38));
        return `<span class="trend-bar" style="height:${height}px"></span>`;
      }).join("")}</div><div class="trend-meta">${escapeHtml(parts[0])} -> ${escapeHtml(parts[parts.length - 1])}</div>`;
      return wrap;
    };

    const oldTitle = oldHeader ? text(oldHeader.querySelector("h1")) : "关键词作战总表";
    const oldMeta = oldHeader ? text(oldHeader.querySelector(".meta")) : "";
    const adRows = rows.filter((row) => text(row.cells[8]).indexOf("无投放") === -1);
    const weeklyTotal = rows.reduce((sum, row) => sum + numberFrom(text(row.cells[2])), 0);
    const avgDifficulty = rows.length ? Math.round(rows.reduce((sum, row) => sum + numberFrom(text(row.cells[4])), 0) / rows.length) : 0;
      const avgAcos = adRows.length ? adRows.reduce((sum, row) => {
        const match = text(row.cells[8]).match(/([0-9.]+)%\s*$/);
        return sum + (match ? Number(match[1]) : 0);
      }, 0) / adRows.length : 0;

    const categoryMap = {
      guard: { label: "守住放大", className: "cat-guard" },
      scale: { label: "谨慎加码", className: "cat-scale" },
      review: { label: "降价复查", className: "cat-review" },
      stop: { label: "暂停止损", className: "cat-stop" },
      tail: { label: "长尾测试", className: "cat-tail" },
      avoid: { label: "暂不硬碰", className: "cat-avoid" },
      missing: { label: "数据缺失", className: "cat-missing" },
    };
    const classifyRow = (row) => {
      const advice = text(row.cells[9]);
      if (/数据缺失/.test(advice)) return "missing";
      if (/暂停|止损|否定/.test(advice)) return "stop";
      if (/降价|复查|Listing|查图/.test(advice)) return "review";
      if (/长尾|测试/.test(advice)) return "tail";
      if (/不硬碰|硬碰/.test(advice)) return "avoid";
      if (/谨慎|加码/.test(advice)) return "scale";
      if (/守住|放大|防守/.test(advice)) return "guard";
      return "missing";
    };
    const counts = { all: rows.length, guard: 0, scale: 0, review: 0, stop: 0, tail: 0, avoid: 0, missing: 0 };
    rows.forEach((row) => {
      const category = classifyRow(row);
      row.dataset.category = category;
      counts[category] += 1;
      const tag = row.cells[9] && row.cells[9].querySelector(".tag");
      if (tag) tag.classList.add(categoryMap[category].className);
    });

    const hero = doc.createElement("section");
    hero.className = "report-hero";
    hero.innerHTML = `<h1>${escapeHtml(oldTitle)}</h1><p>${escapeHtml(oldMeta)}</p>`;
    main.insertBefore(hero, main.firstChild);

    const metrics = doc.createElement("section");
    metrics.className = "metric-grid";
    metrics.innerHTML =
      `<div class="metric-card"><span>报告关键词</span><strong>${rows.length}</strong></div>` +
      `<div class="metric-card"><span>合计周搜索量</span><strong>${compact(weeklyTotal)}</strong></div>` +
      `<div class="metric-card"><span>有广告数据</span><strong>${adRows.length}</strong></div>` +
      `<div class="metric-card"><span>平均难度</span><strong>${avgDifficulty}</strong></div>` +
      `<div class="metric-card"><span>广告平均 ACOS</span><strong>${avgAcos ? `${avgAcos.toFixed(1)}%` : "-"}</strong></div>`;
    hero.after(metrics);

    const title = doc.createElement("div");
    title.className = "table-title";
    title.innerHTML = "<h2>关键词数据</h2><span>市场、竞对、自身、广告和打法合并扫表</span>";
    metrics.after(title);

    const money = (value) => {
      if (!value) return "-";
      return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    const pct = (value) => (value == null || !Number.isFinite(value)) ? "-" : `${value.toFixed(1)}%`;
    const htmlOf = (node) => node ? node.innerHTML : "";
    const parseAd = (input) => {
      if (input && input.dataset && input.dataset.ad) {
        try {
          const ad = JSON.parse(input.dataset.ad);
          const clicks = numberFrom(ad.clicks);
          const impressions = numberFrom(ad.impressions);
          const spend = numberFrom(ad.spend);
          const orders = numberFrom(ad.orders);
          const sales = numberFrom(ad.sales);
          const ctr = impressions ? clicks / impressions * 100 : null;
          const cpc = clicks ? spend / clicks : null;
          const cvr = clicks ? orders / clicks * 100 : null;
          const acos = sales ? spend / sales * 100 : (ad.acos != null ? Number(ad.acos) * (Number(ad.acos) <= 1 ? 100 : 1) : null);
          return { hasData: true, impressions, clicks, spend, orders, sales, ctr, cpc, cvr, acos };
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
      return { hasData: true, clicks, spend, orders, acos, cpc, cvr, sales };
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
    const seasonMeta = (parts) => {
      const values = parts.map(trendValue).filter((n) => n > 0);
      if (values.length < 2) return { label: "暂无趋势", sub: "ABA 13周不足" };
      const first = values[0];
      const last = values[values.length - 1];
      const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
      const range = Math.max(...values) - Math.min(...values);
      const change = first ? (last - first) / first : 0;
      if (change > 0.15) return { label: "近期旺季抬升", sub: "按 ABA 13周趋势判断" };
      if (change < -0.15) return { label: "近期淡季回落", sub: "按 ABA 13周趋势判断" };
      if (avg && range / avg > 0.35) return { label: "季节波动明显", sub: "按 ABA 13周趋势判断" };
      return { label: "需求相对平稳", sub: "按 ABA 13周趋势判断" };
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
      const tags = [{ label: categoryMap[category].label, className: categoryMap[category].className }];
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

    const actionPanel = doc.createElement("section");
    actionPanel.className = "action-panel";
    actionPanel.innerHTML = `
      <div class="action-row" data-filter-row>
        <span class="action-title">筛选</span>
        <button class="filter-button is-active" type="button" data-filter="all">全部 ${counts.all}</button>
        ${Object.entries(categoryMap).map(([key, item]) => `<button class="filter-button ${item.className}" type="button" data-filter="${key}"><span class="dot"></span>${item.label} ${counts[key]}</button>`).join("")}
      </div>
      <div class="rule-note">
        <div><strong>守住放大</strong>：有订单且 ACOS 可接受，优先防守并放大。</div>
        <div><strong>谨慎加码</strong>：有机会但竞争或成本偏硬，逐步加预算。</div>
        <div><strong>降价复查</strong>：花费或点击偏高，先查图、Listing 和 CPC。</div>
        <div><strong>暂停止损</strong>：低相关或高花费无单，优先暂停/否定。</div>
        <div><strong>长尾测试</strong>：大词硬、长尾有机会，低价小预算试。</div>
        <div><strong>暂不硬碰</strong>：头部垄断或自身位置弱，先观望。</div>
        <div><strong>数据缺失</strong>：接口或报表证据不足，先补数再判断。</div>
      </div>
    `;
    title.after(actionPanel);

    const thead = table.querySelector("thead");
    if (thead) {
      thead.innerHTML =
        `<tr class="group-row"><th rowspan="2">关键词 / 标签</th><th rowspan="2">ASIN总流量</th><th class="group-market" colspan="5">市场</th><th class="group-competition" colspan="1">竞对</th><th class="group-self" colspan="1">自身</th><th class="group-ad" colspan="6">广告报表数据</th><th rowspan="2">打法建议</th></tr>` +
        `<tr><th>搜索量 + ABA趋势</th><th>难度</th><th>建议竞价</th><th>市场转化相关</th><th>季节性标注</th><th>点击前三ASIN</th><th>自然位</th><th>展示</th><th>点击/CTR</th><th>CPC</th><th>订单/CVR</th><th>花费</th><th>销售额/ACOS</th></tr>`;
    }
    const oldColgroup = table.querySelector("colgroup");
    if (oldColgroup) oldColgroup.remove();
    const colgroup = doc.createElement("colgroup");
    [190, 130, 240, 110, 130, 150, 155, 270, 95, 105, 125, 110, 125, 120, 155, 320].forEach((width) => {
      const col = doc.createElement("col");
      col.style.width = `${width}px`;
      col.dataset.defaultWidth = String(width);
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    if (thead) {
      const firstRowSpans = thead.querySelectorAll("tr:first-child th[rowspan]");
      if (firstRowSpans[0]) firstRowSpans[0].dataset.colIndex = "0";
      if (firstRowSpans[1]) firstRowSpans[1].dataset.colIndex = "1";
      if (firstRowSpans[2]) firstRowSpans[2].dataset.colIndex = "15";
      thead.querySelectorAll("tr:last-child th").forEach((th, index) => {
        th.dataset.colIndex = String(index + 2);
      });
      thead.querySelectorAll("th[data-col-index]").forEach((th) => {
        th.insertAdjacentHTML("beforeend", '<span class="resize-handle" title="拖动调整列宽，双击恢复默认宽度" aria-hidden="true"></span>');
      });
    }

    rows.forEach((row) => {
      const original = Array.from(row.cells);
      const keyword = text(original[0]);
      const asinTraffic = text(original[1]);
      const weekly = numberFrom(text(original[2]));
      const trendParts = parseTrend(text(original[3]));
      const difficulty = numberFrom(text(original[4]));
      const diff = difficultyMeta(difficulty);
      const bid = parseBid(text(original[5]));
      const selfRank = text(original[6]) || "-";
      const competitorHtml = htmlOf(original[7]) || "-";
      const ad = parseAd(original[8]);
      const adviceHtml = htmlOf(original[9]);
      const category = row.dataset.category || classifyRow(row);
      const season = seasonMeta(trendParts);
      const conversion = marketConversionMeta(original[2]);
      const trendWrap = doc.createElement("div");
      if (trendParts.length > 1) trendWrap.appendChild(trendBars(trendParts));
      else trendWrap.textContent = "-";
      const trendHtml = trendWrap.innerHTML || trendWrap.textContent;
      const keywordHtml = `<span class="keyword-name">${escapeHtml(keyword)}</span><span class="keyword-tags">${keywordTags(keyword, category, weekly, difficulty, ad)}</span>`;
      const searchHtml = `<div class="market-cell"><span class="market-main">${compact(weekly)}</span>${trendHtml}</div>`;
      const difficultyHtml = `<span class="difficulty-pill ${diff.className}">${difficulty || "-"} · ${diff.label}</span>`;
      const bidHtml = `<span class="bid-main">${escapeHtml(bid.main)}</span><span class="bid-range">${escapeHtml(bid.range || "无区间")}</span>`;
      const conversionHtml = `<span class="conversion-chip pending">${conversion.label}</span><span class="subtext">${escapeHtml(conversion.sub)}</span>`;
      const seasonHtml = `<span class="season-chip">${season.label}</span><span class="subtext">${escapeHtml(season.sub)}</span>`;
      const adClickHtml = `<span class="ad-main">${ad.hasData ? compact(ad.clicks) : "-"}</span><span class="ad-sub">CTR ${ad.hasData ? pct(ad.ctr) : "-"}</span>`;
      const adOrderHtml = `<span class="ad-main">${ad.hasData ? compact(ad.orders) : "-"}</span><span class="ad-sub">CVR ${ad.hasData ? pct(ad.cvr) : "-"}</span>`;
      const adSalesHtml = `<span class="ad-main">${ad.hasData && ad.sales ? money(ad.sales) : "-"}</span><span class="ad-sub">ACOS ${ad.hasData ? pct(ad.acos) : "-"}</span>`;
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
        `<td><span class="${ad.hasData && ad.impressions ? "ad-main" : "ad-empty"}">${ad.hasData && ad.impressions ? compact(ad.impressions) : "-"}</span></td>` +
        `<td>${adClickHtml}</td>` +
        `<td><span class="ad-main">${ad.hasData && ad.cpc ? money(ad.cpc) : "-"}</span></td>` +
        `<td>${adOrderHtml}</td>` +
        `<td><span class="ad-main">${ad.hasData ? money(ad.spend) : "-"}</span></td>` +
        `<td>${adSalesHtml}</td>` +
        `<td>${adviceHtml}</td>`;
      const tag = row.cells[14] && row.cells[14].querySelector(".tag");
      if (tag) tag.classList.add(categoryMap[category].className);
    });

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

    const filterScript = doc.createElement("script");
    filterScript.textContent = `
      document.querySelectorAll('[data-filter]').forEach(function (button) {
        button.addEventListener('click', function () {
          var value = button.getAttribute('data-filter');
          document.querySelectorAll('[data-filter]').forEach(function (item) { item.classList.remove('is-active'); });
          button.classList.add('is-active');
          document.querySelectorAll('tbody tr').forEach(function (row) {
            row.classList.toggle('is-hidden', value !== 'all' && row.dataset.category !== value);
          });
        });
      });
      document.addEventListener('dblclick', function (event) {
        var handle = event.target.closest && event.target.closest('.resize-handle');
        if (!handle) return;
        var th = handle.parentElement;
        var index = Number(th.getAttribute('data-col-index'));
        var col = document.querySelectorAll('colgroup col')[index];
        if (col && col.dataset.defaultWidth) col.style.width = col.dataset.defaultWidth + 'px';
      });
      document.addEventListener('mousedown', function (event) {
        var handle = event.target.closest && event.target.closest('.resize-handle');
        if (handle) {
          event.preventDefault();
          var th = handle.parentElement;
          var index = Number(th.getAttribute('data-col-index'));
          var col = document.querySelectorAll('colgroup col')[index];
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
