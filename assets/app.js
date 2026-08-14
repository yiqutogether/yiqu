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
      .table-wrap { border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, .06); }
      table { min-width: 1740px !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 0 !important; }
      th, td { font-size: 12px !important; padding: 11px 10px !important; border-bottom: 1px solid #dfe6ee !important; vertical-align: top; }
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
      .sparkline polyline { fill: none; stroke: #2f6fce; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
      .sparkline text { fill: #667085; font-size: 10px; }
      .asin { display: grid !important; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: center; margin-bottom: 7px !important; line-height: 1.25; }
      .asin img, .image-fallback { width: 30px; height: 30px; object-fit: cover; background: #eef1f5; border: 1px solid #dde3ea; border-radius: 5px; }
      .image-fallback { display: inline-flex; align-items: center; justify-content: center; color: #667085; font-size: 10px; font-weight: 700; }
      .tag { border-radius: 999px !important; padding: 3px 8px !important; background: #e7f0ff !important; color: #175cd3 !important; }
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
    const sparkline = (parts) => {
      const values = parts.map(trendValue).filter((n) => n > 0);
      if (values.length < 2) return doc.createTextNode(parts.join(" -> "));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = max - min || 1;
      const points = values.map((value, index) => {
        const x = 4 + index * (132 / Math.max(1, values.length - 1));
        const y = 32 - ((value - min) / spread) * 24;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      const wrap = doc.createElement("div");
      wrap.innerHTML = `<svg class="sparkline" viewBox="0 0 144 44" role="img" aria-label="ABA trend"><polyline points="${points}"></polyline><text x="4" y="42">${escapeHtml(parts[0])}</text><text x="104" y="42">${escapeHtml(parts[parts.length - 1])}</text></svg>`;
      return wrap.firstElementChild;
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

    const thead = table.querySelector("thead");
    if (thead) {
      thead.innerHTML =
        `<tr class="group-row"><th rowspan="2">关键词</th><th class="group-market" colspan="5">市场</th><th class="group-self" colspan="1">自身</th><th class="group-competition" colspan="1">竞对</th><th class="group-ad" colspan="1">广告</th><th rowspan="2">打法建议</th></tr>` +
        `<tr><th>ASIN总流量</th><th>周搜索量</th><th>ABA 13周</th><th>难度</th><th>建议竞价</th><th>自然位</th><th>点击前三/竞品</th><th>点击/花费/订单/ACOS</th></tr>`;
    }

    rows.forEach((row) => {
      const trendCell = row.cells && row.cells[3];
      if (trendCell) {
        const parts = parseTrend(trendCell.textContent);
        if (parts.length > 1) {
          trendCell.textContent = "";
          trendCell.appendChild(sparkline(parts));
        }
      }
    });

    doc.querySelectorAll(".asin").forEach((node) => {
      const img = node.querySelector("img");
      const label = text(node).slice(0, 4) || "ASIN";
      const fallback = () => {
        const span = doc.createElement("span");
        span.className = "image-fallback";
        span.textContent = label;
        if (img && img.parentNode) img.replaceWith(span);
        else node.insertBefore(span, node.firstChild);
      };
      if (!img || !img.getAttribute("src")) {
        fallback();
        return;
      }
      if (img.getAttribute("src").startsWith("http://")) {
        img.setAttribute("src", img.getAttribute("src").replace(/^http:\/\//, "https://"));
      }
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("loading", "lazy");
      img.setAttribute("onerror", "this.replaceWith(Object.assign(document.createElement('span'), { className: 'image-fallback', textContent: this.parentNode.textContent.trim().slice(0,4) || 'ASIN' }))");
    });

    return doc.documentElement.outerHTML;
  }

  window.YiquApp = {
    initAuthPage,
    initToolPage,
    initReportPage
  };
})();
