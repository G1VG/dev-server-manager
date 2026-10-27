/**
 * DEV SERVER MANAGER — FRONTEND APPLICATION
 * Vanilla JS, no build step, no npm.
 * DevOps console styling, Chart.js rolling telemetry, live Linux command terminal drawer.
 */

// Global Application State
const state = {
  activeTab: 'overview',
  isPolling: true,
  pollIntervalMs: 5000,
  pollTimer: null,
  isRefreshing: false,
  systemMode: 'connecting',
  status: null,
  users: [],
  repos: [],
  lvm: null,
  cron: [],
  backups: [],
  logs: {
    activeFile: 'activity',
    lines: 50,
    entries: []
  },
  rollingData: {
    labels: Array(60).fill(''),
    cpu: Array(60).fill(0),
    mem: Array(60).fill(0)
  },
  chart: null,
  pendingDeleteUser: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initChart();
  initModals();
  initTerminalDrawer();
  initLvmControls();
  initLogsViewer();
  initForms();
  initActionButtons();

  // Initial Data Load
  loadAllData().then(() => {
    startAutoRefresh();
  });
});

// ============================================================================
// NAVIGATION & TABS
// ============================================================================
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  const subtitles = {
    overview: 'Real-time telemetry, LVM storage topology & 40 developer accounts',
    developers: 'Manage developer accounts in group "developers" with password policies',
    repositories: 'Shared Git repositories in /srv/repos with setgid (2775) permissions',
    storage: 'LVM Volume Group (vg_dev) online volume expansion without downtime',
    automation: 'Crontab schedules in /etc/cron.d/devserver and automated disk cleanup',
    backups: 'Compressed archives in /srv/backups with verification and 7-day retention',
    logs: 'Live system logs with threshold alert highlighting from /var/log/devserver/'
  };

  const titles = {
    overview: 'System Overview',
    developers: 'Developer Accounts',
    repositories: 'Shared Repositories',
    storage: 'Storage Management (LVM)',
    automation: 'System Automation & Cleanup',
    backups: 'Backup & Disaster Recovery',
    logs: 'System Logs'
  };

  function switchTab(tabId) {
    if (!tabId || !titles[tabId]) tabId = 'overview';
    state.activeTab = tabId;

    navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tabId);
    });

    panes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${tabId}`);
    });

    pageTitle.textContent = titles[tabId];
    pageSubtitle.textContent = subtitles[tabId];
    window.location.hash = tabId;

    // Trigger tab-specific refresh if needed
    if (tabId === 'logs') loadLogs();
    if (tabId === 'developers') loadDevelopers();
    if (tabId === 'repositories') renderRepositoriesGrid();
    if (tabId === 'storage') renderLvmView();

    // Close mobile sidebar if open
    document.getElementById('sidebar')?.classList.remove('mobile-open');
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  // KPI card quick jump to developers tab
  document.getElementById('kpiDevsCard')?.addEventListener('click', () => {
    switchTab('developers');
  });

  // Overview quick-link jump buttons
  document.querySelectorAll('.nav-link-jump').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(btn.dataset.tab);
    });
  });

  // Mobile drawer toggle
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('mobile-open');
  });

  // Handle direct hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash && titles[hash]) {
    switchTab(hash);
  }
}

// ============================================================================
// API CLIENT WRAPPER WITH TERMINAL STREAMING & ERROR HANDLING
// ============================================================================
async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(endpoint, options);
    let json;
    try {
      json = await res.json();
    } catch (parseErr) {
      json = { ok: false, error: `Invalid response format from server (${res.status})` };
    }

    // Always log command output to Terminal Drawer
    if (json.command || json.output) {
      appendTerminalEntry(json.command, json.output, json.ok);
    }

    if (!res.ok || json.ok === false) {
      const errMsg = json.error || `HTTP error ${res.status}`;
      return { ok: false, error: errMsg, json };
    }

    return { ok: true, data: json.data, raw: json };
  } catch (netErr) {
    appendTerminalEntry(`connect ${endpoint}`, `Network failure: ${netErr.message}`, false);
    showToast('error', 'Connection Error', 'Backend server unreachable at 127.0.0.1:5000');
    return { ok: false, error: netErr.message };
  }
}

// ============================================================================
// AUTO REFRESH & LIVE POLLING
// ============================================================================
function startAutoRefresh() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.isPolling && !state.isRefreshing) {
      pollTelemetry();
    }
  }, state.pollIntervalMs);
}

async function pollTelemetry() {
  state.isRefreshing = true;
  try {
    const res = await apiRequest('/api/status');
    if (res.ok) {
      updateOverviewView(res.data);
      updateRollingChart(res.data.load, res.data.cores, res.data.mem_pct);

      // Keep developer roster synced if count changes or list is empty
      const devKpiCount = res.data.kpis?.developers ?? 0;
      if (state.users.length === 0 || (devKpiCount > 0 && state.users.length !== devKpiCount)) {
        await loadDevelopers();
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  } finally {
    state.isRefreshing = false;
  }
}

async function loadDevelopers() {
  try {
    const usersRes = await apiRequest('/api/users');
    if (usersRes.ok && Array.isArray(usersRes.data)) {
      state.users = usersRes.data;
      renderDevelopersTable();
      renderOverviewDevsRoster();
      const count = state.users.length;
      const navCount = document.getElementById('navDevCount');
      const kpiDev = document.getElementById('kpiDevs');
      const badge = document.getElementById('overviewDevCountBadge');
      if (navCount) navCount.textContent = count;
      if (kpiDev) kpiDev.textContent = count;
      if (badge) badge.textContent = `${count} Total`;
    }
  } catch (err) {
    console.error('Failed to load developers:', err);
  }
}

async function loadAllData() {
  const spinner = document.getElementById('refreshSpinner');
  if (spinner) spinner.classList.add('fa-spin');

  try {
    const [statusRes, usersRes, reposRes, lvmRes, cronRes, backupsRes] = await Promise.all([
      apiRequest('/api/status'),
      apiRequest('/api/users'),
      apiRequest('/api/repos'),
      apiRequest('/api/lvm'),
      apiRequest('/api/cron'),
      apiRequest('/api/backups')
    ]);

    if (statusRes.ok) {
      state.status = statusRes.data;
      updateOverviewView(statusRes.data);
      updateRollingChart(statusRes.data.load, statusRes.data.cores, statusRes.data.mem_pct);
      updateModeBadge(statusRes.data.mode);
    }

    if (usersRes.ok && Array.isArray(usersRes.data)) {
      state.users = usersRes.data;
      renderDevelopersTable();
      renderOverviewDevsRoster();
      const count = state.users.length;
      const navCount = document.getElementById('navDevCount');
      const kpiDev = document.getElementById('kpiDevs');
      const badge = document.getElementById('overviewDevCountBadge');
      if (navCount) navCount.textContent = count;
      if (kpiDev) kpiDev.textContent = count;
      if (badge) badge.textContent = `${count} Total`;
    }

    if (reposRes.ok) {
      state.repos = reposRes.data;
      renderRepositoriesGrid();
      document.getElementById('navRepoCount').textContent = state.repos.length;
      document.getElementById('kpiRepos').textContent = state.repos.length;
    }

    if (lvmRes.ok) {
      state.lvm = lvmRes.data;
      renderLvmView();
    }

    if (cronRes.ok) {
      state.cron = cronRes.data;
      renderCronTimeline();
    }

    if (backupsRes.ok) {
      state.backups = backupsRes.data;
      renderBackupsTable();
    }
  } catch (err) {
    console.error('Error during initial data fetch:', err);
  } finally {
    if (spinner) spinner.classList.remove('fa-spin');
  }
}

function updateModeBadge(mode) {
  const badge = document.getElementById('modeBadge');
  const text = document.getElementById('modeText');
  if (!badge || !text) return;

  if (mode === 'demo') {
    badge.className = 'mode-badge demo';
    text.textContent = 'DEMO MODE (MOCK DATA)';
  } else {
    badge.className = 'mode-badge prod';
    text.textContent = 'PRODUCTION (LINUX)';
  }
}

// ============================================================================
// OVERVIEW TAB: GAUGES, KPIS, ALERTS, MOUNTS
// ============================================================================
function updateOverviewView(data) {
  if (!data) return;

  // 1. Alert Banner
  const alertBanner = document.getElementById('overviewAlertBanner');
  const alertIcon = document.getElementById('alertBannerIcon');
  const alertTitle = document.getElementById('alertBannerTitle');
  const alertDesc = document.getElementById('alertBannerDesc');

  if (data.alerts && data.alerts.length > 0) {
    alertBanner.className = 'alert-banner danger';
    alertIcon.className = 'fa-solid fa-triangle-exclamation';
    alertTitle.textContent = `${data.alerts.length} System Threshold Alert(s) Detected`;
    alertDesc.textContent = data.alerts.join(' • ');
  } else {
    alertBanner.className = 'alert-banner healthy';
    alertIcon.className = 'fa-solid fa-circle-check';
    alertTitle.textContent = 'All Systems Healthy';
    alertDesc.textContent = 'CPU load, memory allocation, and disk partitions are all within nominal operational limits.';
  }

  // 2. Sidebar Uptime
  const sidebarUptime = document.getElementById('sidebarUptime');
  if (sidebarUptime) sidebarUptime.textContent = `Uptime: ${data.uptime}`;

  // 3. CPU Gauge
  const cpuLoadVal = document.getElementById('cpuLoadVal');
  const cpuCoresLabel = document.getElementById('cpuCoresLabel');
  const cpuGauge = document.getElementById('cpuGaugeProgress');
  const cpuBadge = document.getElementById('cpuBadge');
  const cpuStatusText = document.getElementById('cpuStatusText');

  const loadNum = Number(data.load) || 0;
  const coresNum = Number(data.cores) || 1;
  const cpuPct = Math.min(100, Math.round((loadNum / coresNum) * 100));

  cpuLoadVal.textContent = loadNum.toFixed(2);
  cpuCoresLabel.textContent = `/ ${coresNum} Cores (${cpuPct}%)`;

  // SVG Gauge calculation: 2 * PI * r = 2 * 3.14159 * 50 = 314.159
  const circumference = 314.16;
  const cpuOffset = circumference - (cpuPct / 100) * circumference;
  cpuGauge.style.strokeDashoffset = cpuOffset;

  if (loadNum > coresNum) {
    cpuGauge.className = 'gauge-progress rose';
    cpuBadge.className = 'badge badge-rose';
    cpuBadge.textContent = 'High Load';
    cpuStatusText.textContent = 'OVERLOAD';
    cpuStatusText.className = 'text-rose font-mono';
  } else {
    cpuGauge.className = 'gauge-progress';
    cpuBadge.className = 'badge badge-teal';
    cpuBadge.textContent = 'Nominal';
    cpuStatusText.textContent = 'Healthy';
    cpuStatusText.className = 'text-teal';
  }

  // 4. Memory Gauge
  const memVal = document.getElementById('memVal');
  const memGauge = document.getElementById('memGaugeProgress');
  const memBadge = document.getElementById('memBadge');
  const memPct = Number(data.mem_pct) || 0;

  memVal.textContent = `${memPct}%`;
  const memOffset = circumference - (memPct / 100) * circumference;
  memGauge.style.strokeDashoffset = memOffset;

  if (memPct >= 85) {
    memGauge.className = 'gauge-progress rose';
    memBadge.className = 'badge badge-rose';
    memBadge.textContent = `${memPct}% ALERT`;
  } else {
    memGauge.className = 'gauge-progress purple';
    memBadge.className = 'badge badge-purple';
    memBadge.textContent = `${memPct}% Allocated`;
  }

  // 5. Root Disk Gauge
  const rootDisk = data.disks?.find(d => d.mount === '/') || { use_pct: 42, size: '50 GB', used: '21 GB' };
  const diskVal = document.getElementById('diskVal');
  const diskGauge = document.getElementById('diskGaugeProgress');
  const diskBadge = document.getElementById('diskBadge');

  const diskPct = rootDisk.use_pct || 0;
  diskVal.textContent = `${diskPct}%`;
  const diskOffset = circumference - (diskPct / 100) * circumference;
  diskGauge.style.strokeDashoffset = diskOffset;

  if (diskPct >= 80) {
    diskGauge.className = 'gauge-progress rose';
    diskBadge.className = 'badge badge-rose';
    diskBadge.textContent = `${diskPct}% ALERT`;
  } else {
    diskGauge.className = 'gauge-progress blue';
    diskBadge.className = 'badge badge-blue';
    diskBadge.textContent = `${diskPct}% Used`;
  }

  // 6. Mount Points List
  const mountsList = document.getElementById('mountsList');
  if (mountsList && data.disks) {
    mountsList.innerHTML = data.disks.map(d => {
      const isAlert = d.use_pct >= 80;
      let fillClass = '';
      if (d.mount === '/srv/repos') fillClass = 'teal';
      else if (d.mount === '/srv/backups') fillClass = 'purple';
      else fillClass = isAlert ? 'rose' : (d.use_pct >= 70 ? 'amber' : '');

      return `
        <div class="mount-item">
          <div class="mount-header">
            <span class="mount-path"><i class="fa-solid fa-folder text-muted"></i> ${d.mount}</span>
            <span class="mount-stats">${d.used} / ${d.size} (${d.use_pct}%)</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill ${fillClass}" style="width: ${d.use_pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 7. KPIs
  if (data.kpis) {
    document.getElementById('kpiDevs').textContent = data.kpis.developers;
    document.getElementById('kpiRepos').textContent = data.kpis.repositories;
    document.getElementById('kpiCron').textContent = `${data.kpis.cron_jobs} Active`;
  }
}

// ============================================================================
// CHART.JS: 60-POINT ROLLING LINE CHART
// ============================================================================
function initChart() {
  const canvas = document.getElementById('rollingChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Gradient Fills
  const gradientTeal = ctx.createLinearGradient(0, 0, 0, 260);
  gradientTeal.addColorStop(0, 'rgba(0, 242, 254, 0.28)');
  gradientTeal.addColorStop(1, 'rgba(0, 242, 254, 0.00)');

  const gradientPurple = ctx.createLinearGradient(0, 0, 0, 260);
  gradientPurple.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
  gradientPurple.addColorStop(1, 'rgba(168, 85, 247, 0.00)');

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.rollingData.labels,
      datasets: [
        {
          label: 'CPU Load (%)',
          data: state.rollingData.cpu,
          borderColor: '#00F2FE',
          backgroundColor: gradientTeal,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true
        },
        {
          label: 'Memory (%)',
          data: state.rollingData.mem,
          borderColor: '#a855f7',
          backgroundColor: gradientPurple,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 15, 25, 0.95)',
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: true
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { display: false }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748B',
            font: { family: 'JetBrains Mono', size: 10 },
            stepSize: 25,
            callback: v => `${v}%`
          }
        }
      }
    }
  });
}

function updateRollingChart(load, cores, memPct) {
  if (!state.chart) return;

  const coresNum = Number(cores) || 1;
  const loadNum = Number(load) || 0;
  const cpuPct = Math.min(100, Math.round((loadNum / coresNum) * 100));
  const mem = Math.min(100, Math.round(Number(memPct) || 0));

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  state.rollingData.labels.shift();
  state.rollingData.labels.push(timeStr);

  state.rollingData.cpu.shift();
  state.rollingData.cpu.push(cpuPct);

  state.rollingData.mem.shift();
  state.rollingData.mem.push(mem);

  state.chart.update('none'); // Update without full redraw animation for smoothness
}

// ============================================================================
// DEVELOPERS TAB & OVERVIEW ROSTER
// ============================================================================
function renderOverviewDevsRoster() {
  const container = document.getElementById('overviewDevsRoster');
  if (!container) return;

  const users = state.users || [];
  if (users.length === 0) {
    container.innerHTML = `
      <div class="text-muted p-3 text-center" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-users fa-2x mb-2 text-teal"></i>
        <div>No developer accounts loaded yet.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = users.map(u => {
    const uname = u.username || 'unknown';
    const fname = u.fullname || uname;
    const initials = getInitials(fname);
    const isLocked = u.status === 'locked';
    const statusClass = isLocked ? 'locked' : 'active';
    const statusTitle = isLocked ? 'Locked Account' : 'Active Account';

    return `
      <div class="dev-roster-card" title="${escapeHtml(fname)} (@${escapeHtml(uname)}) — ${statusTitle}">
        <div class="dev-roster-avatar">${initials}</div>
        <div class="dev-roster-info">
          <span class="dev-roster-name">${escapeHtml(fname)}</span>
          <span class="dev-roster-username">@${escapeHtml(uname)}</span>
        </div>
        <div class="dev-roster-status">
          <span class="status-dot ${statusClass}" title="${statusTitle}"></span>
        </div>
      </div>
    `;
  }).join('');
}

function renderDevelopersTable() {
  const tbody = document.getElementById('devsTableBody');
  const countEl = document.getElementById('devTableCount');
  if (!tbody) return;

  const search = document.getElementById('devSearchInput')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('devStatusFilter')?.value || 'all';

  const users = state.users || [];
  const filtered = users.filter(u => {
    const uname = (u.username || '').toLowerCase();
    const fname = (u.fullname || '').toLowerCase();
    const matchSearch = uname.includes(search) || fname.includes(search);
    const matchFilter = (filter === 'all') || (u.status === filter);
    return matchSearch && matchFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          <i class="fa-solid fa-user-slash fa-2x mb-2"></i>
          <div>No developer accounts matching criteria.</div>
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 developers';
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const uname = u.username || 'unknown';
    const fname = u.fullname || uname;
    const initials = getInitials(fname);
    const isLocked = u.status === 'locked';
    const statusBadge = isLocked
      ? `<span class="badge badge-amber"><i class="fa-solid fa-lock"></i> Locked</span>`
      : `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> Active</span>`;

    const toggleActionBtn = isLocked
      ? `<button class="btn btn-secondary btn-sm" onclick="handleToggleLock('${uname}', false)" title="Unlock Account">
           <i class="fa-solid fa-lock-open text-teal"></i> Unlock
         </button>`
      : `<button class="btn btn-secondary btn-sm" onclick="handleToggleLock('${uname}', true)" title="Lock Account">
           <i class="fa-solid fa-lock text-amber"></i> Lock
         </button>`;

    return `
      <tr>
        <td>
          <div class="dev-avatar-group">
            <div class="avatar-circle">${initials}</div>
            <div class="avatar-info">
              <span class="avatar-username">${escapeHtml(uname)}</span>
              <span class="avatar-email">${escapeHtml(uname)}@devserver.internal</span>
            </div>
          </div>
        </td>
        <td><strong>${escapeHtml(fname)}</strong></td>
        <td><span class="badge badge-teal">developers</span></td>
        <td>${statusBadge}</td>
        <td><span class="font-mono text-xs">${escapeHtml(u.last_login || 'Never')}</span></td>
        <td class="text-right">
          <div class="table-actions">
            ${toggleActionBtn}
            <button class="btn btn-danger btn-sm" onclick="openDeleteUserModal('${uname}')" title="Delete Developer Account">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${users.length} developers`;
  }
}

function getInitials(name) {
  if (!name || typeof name !== 'string') return 'DV';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
  if (!name) return 'DV';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function handleToggleLock(username, lock) {
  const action = lock ? 'lock' : 'unlock';
  const res = await apiRequest(`/api/users/${username}/${action}`, 'POST');

  if (res.ok) {
    showToast('success', 'User Status Updated', `Account '${username}' has been ${action}ed.`);
    const u = state.users.find(x => x.username === username);
    if (u) u.status = lock ? 'locked' : 'active';
    renderDevelopersTable();
  } else {
    showToast('error', 'Action Failed', res.error || `Failed to ${action} user`);
  }
}

function openDeleteUserModal(username) {
  state.pendingDeleteUser = username;
  document.getElementById('deleteTargetUsername').textContent = username;
  openModal('deleteDevModal');
}

// ============================================================================
// REPOSITORIES TAB: CARDS, CLONE COPY, CREATE
// ============================================================================
function renderRepositoriesGrid() {
  const grid = document.getElementById('reposGrid');
  if (!grid) return;

  const search = document.getElementById('repoSearchInput')?.value.trim().toLowerCase() || '';
  const filtered = state.repos.filter(r => r.name.toLowerCase().includes(search));

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
        <i class="fa-brands fa-git-alt fa-3x mb-2 text-teal"></i>
        <h3>No Repositories Found</h3>
        <p class="text-sm">Click "Create Repository" above to initialize a new bare Git repository.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(r => {
    const cloneCmd = r.clone_cmd || `git clone ssh://<user>@devserver/srv/repos/${r.name}`;
    return `
      <div class="repo-card">
        <div class="repo-card-header">
          <div class="repo-icon-name">
            <i class="fa-brands fa-git-alt"></i>
            <span class="repo-name">${escapeHtml(r.name)}</span>
          </div>
          <span class="badge badge-teal">Bare Repo</span>
        </div>

        <div class="repo-stats-list">
          <div class="repo-stat-row">
            <span>Disk Size:</span>
            <span>${r.size || '48 KB'}</span>
          </div>
          <div class="repo-stat-row">
            <span>Group Ownership:</span>
            <span>${r.group || 'developers'}</span>
          </div>
          <div class="repo-stat-row">
            <span>Permissions (setgid):</span>
            <span>${r.mode || '2775'}</span>
          </div>
        </div>

        <div class="clone-box">
          <span class="clone-command-text" title="${cloneCmd}">${cloneCmd}</span>
          <button class="copy-btn" onclick="copyToClipboard('${cloneCmd}')" title="Copy Clone Command">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('info', 'Copied to Clipboard', text);
  }).catch(() => {
    showToast('error', 'Clipboard Error', 'Could not copy to clipboard.');
  });
}

// ============================================================================
// STORAGE (LVM) TAB: DIAGRAM & GROW VOLUME
// ============================================================================
function renderLvmView() {
  if (!state.lvm) return;
  const lvm = state.lvm;

  // VG stats
  const vgSize = lvm.vg?.size_mb || lvm.vg_size_mb || 3072;
  const vgFree = lvm.vg_free_mb !== undefined ? lvm.vg_free_mb : 614;
  const vgUsed = vgSize - vgFree;
  const usedPct = Math.round((vgUsed / vgSize) * 100);
  const freePct = 100 - usedPct;

  document.getElementById('lvmVgSize').textContent = `${vgSize} MB`;
  document.getElementById('lvmVgUsedMb').textContent = `${vgUsed} MB`;
  document.getElementById('lvmVgFreeMb').textContent = `${vgFree} MB`;
  document.getElementById('lvmVgBarUsed').style.width = `${usedPct}%`;
  document.getElementById('lvmVgBarFree').style.width = `${freePct}%`;

  // LVs stats
  const lvRepos = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_repos') : lvm.lvs?.lv_repos;
  const lvBackup = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_backup') : lvm.lvs?.lv_backup;

  if (lvRepos) {
    const rSize = lvRepos.size_mb || 1536;
    const rUsed = lvRepos.used_mb || 420;
    const rPct = Math.round((rUsed / rSize) * 100);
    document.getElementById('lvReposSize').textContent = `${rSize} MB`;
    document.getElementById('lvReposProgress').style.width = `${rPct}%`;
    document.getElementById('lvReposUsedText').textContent = `Used: ${rUsed} MB (${rPct}%)`;
  }

  if (lvBackup) {
    const bSize = lvBackup.size_mb || 922;
    const bUsed = lvBackup.used_mb || 315;
    const bPct = Math.round((bUsed / bSize) * 100);
    document.getElementById('lvBackupSize').textContent = `${bSize} MB`;
    document.getElementById('lvBackupProgress').style.width = `${bPct}%`;
    document.getElementById('lvBackupUsedText').textContent = `Used: ${bUsed} MB (${bPct}%)`;
  }

  // Update slider bounds & max label
  const slider = document.getElementById('extendMbSlider');
  const input = document.getElementById('extendMbInput');
  const maxLabel = document.getElementById('sliderMaxLabel');

  if (slider && input && maxLabel) {
    slider.max = Math.max(16, vgFree);
    input.max = Math.max(16, vgFree);
    maxLabel.textContent = `Max available: ${vgFree} MB`;
    updateLvmPreview();
  }
}

function initLvmControls() {
  const slider = document.getElementById('extendMbSlider');
  const input = document.getElementById('extendMbInput');
  const targetLv = document.getElementById('extendTargetLv');

  if (!slider || !input || !targetLv) return;

  slider.addEventListener('input', () => {
    input.value = slider.value;
    updateLvmPreview();
  });

  input.addEventListener('input', () => {
    slider.value = input.value;
    updateLvmPreview();
  });

  targetLv.addEventListener('change', () => {
    updateLvmPreview();
  });

  // Form submit
  document.getElementById('lvmExtendForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('extendSubmitBtn');
    const lv = targetLv.value;
    const mb = parseInt(input.value, 10);

    if (isNaN(mb) || mb <= 0) {
      showToast('error', 'Invalid Input', 'Please enter a positive whole number for MB.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Resizing Volume Online...`;

    const res = await apiRequest('/api/lvm/extend', 'POST', { lv, mb });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-arrows-maximize"></i> <span>Grow Volume Online Now</span>`;

    if (res.ok) {
      showToast('success', 'Volume Extended', `Successfully expanded ${lv} by ${mb} MB online.`);
      // Refresh LVM data
      const lvmRes = await apiRequest('/api/lvm');
      if (lvmRes.ok) {
        state.lvm = lvmRes.data;
        renderLvmView();
      }
    } else {
      showToast('error', 'Expansion Failed', res.error || 'Failed to extend volume');
    }
  });
}

function updateLvmPreview() {
  const lvSelect = document.getElementById('extendTargetLv');
  const input = document.getElementById('extendMbInput');
  const sliderDisplay = document.getElementById('sliderValueDisplay');
  const previewLvName = document.getElementById('previewLvName');
  const previewCurrentSize = document.getElementById('previewCurrentSize');
  const previewNewSize = document.getElementById('previewNewSize');
  const previewNewFree = document.getElementById('previewNewFree');

  if (!lvSelect || !input) return;

  const target = lvSelect.value;
  const extendMb = parseInt(input.value, 10) || 0;

  if (sliderDisplay) sliderDisplay.textContent = `+${extendMb} MB`;
  if (previewLvName) previewLvName.textContent = target;

  const lvm = state.lvm;
  if (!lvm) return;

  const vgFree = lvm.vg_free_mb !== undefined ? lvm.vg_free_mb : 614;
  let currentSize = 1536;

  if (target === 'lv_repos') {
    const lv = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_repos') : lvm.lvs?.lv_repos;
    if (lv) currentSize = lv.size_mb || 1536;
  } else {
    const lv = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_backup') : lvm.lvs?.lv_backup;
    if (lv) currentSize = lv.size_mb || 922;
  }

  const newSize = currentSize + extendMb;
  const newFree = Math.max(0, vgFree - extendMb);

  if (previewCurrentSize) previewCurrentSize.textContent = `${currentSize} MB`;
  if (previewNewSize) previewNewSize.textContent = `${newSize} MB`;
  if (previewNewFree) previewNewFree.textContent = `${newFree} MB`;
}

// ============================================================================
// AUTOMATION TAB: CRON TIMELINE & DISK CLEANUP
// ============================================================================
function renderCronTimeline() {
  const timeline = document.getElementById('cronTimeline');
  if (!timeline || !state.cron || state.cron.length === 0) return;

  timeline.innerHTML = state.cron.map(c => `
    <div class="cron-card">
      <div class="cron-time-badge">
        <i class="fa-solid fa-clock"></i>
        <span>${escapeHtml(c.schedule)}</span>
      </div>
      <div class="cron-info">
        <h4>${escapeHtml(c.human_readable || c.schedule)}</h4>
        <p class="cron-desc">${escapeHtml(c.purpose || 'Automated scheduled task')}</p>
        <code class="cron-command">${escapeHtml(c.command)}</code>
      </div>
      <div class="cron-meta">
        <span class="badge badge-teal">${c.status || 'Active'}</span>
        <span class="text-xs text-muted">User: ${c.user || 'root'}</span>
      </div>
    </div>
  `).join('');
}

// ============================================================================
// BACKUPS TAB: TABLE & IMMEDIATE BACKUP
// ============================================================================
function renderBackupsTable() {
  const tbody = document.getElementById('backupsTableBody');
  if (!tbody) return;

  if (state.backups.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-muted">No backup archives found in /srv/backups</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.backups.map(b => `
    <tr>
      <td>
        <span class="font-mono text-highlight"><i class="fa-solid fa-file-zipper text-teal mr-2"></i> ${escapeHtml(b.filename)}</span>
      </td>
      <td><span class="font-mono font-bold">${b.size}</span></td>
      <td><span class="font-mono text-xs">${b.created}</span></td>
      <td><span class="badge badge-green"><i class="fa-solid fa-check"></i> ${b.status || 'Verified tar.gz'}</span></td>
      <td><span class="text-xs text-muted">/srv/repos, /etc/passwd, /etc/group</span></td>
    </tr>
  `).join('');
}

// ============================================================================
// LOGS TAB: MONOSPACE TERMINAL, SEARCH, AUTO-SCROLL
// ============================================================================
function initLogsViewer() {
  const tabButtons = document.querySelectorAll('.log-tab-btn');
  const searchInput = document.getElementById('logFilterInput');
  const linesSelect = document.getElementById('logLinesSelect');
  const refreshBtn = document.getElementById('refreshLogsBtn');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.logs.activeFile = btn.dataset.logfile;
      loadLogs();
    });
  });

  searchInput?.addEventListener('input', renderLogEntries);
  linesSelect?.addEventListener('change', () => {
    state.logs.lines = parseInt(linesSelect.value, 10);
    loadLogs();
  });
  refreshBtn?.addEventListener('click', loadLogs);
}

async function loadLogs() {
  const file = state.logs.activeFile;
  const lines = state.logs.lines;
  const statsEl = document.getElementById('logStatsText');

  if (statsEl) statsEl.textContent = `Loading /var/log/devserver/${file}.log...`;

  const res = await apiRequest(`/api/logs?file=${file}&lines=${lines}`);
  if (res.ok && res.data) {
    state.logs.entries = res.data.entries || [];
    renderLogEntries();
    if (statsEl) {
      statsEl.textContent = `Showing ${res.data.lines_returned || 0} lines from /var/log/devserver/${file}.log`;
    }
  }
}

function renderLogEntries() {
  const container = document.getElementById('logOutput');
  const filter = document.getElementById('logFilterInput')?.value.trim().toLowerCase() || '';
  const autoScroll = document.getElementById('logAutoScroll')?.checked;

  if (!container) return;

  const filtered = state.logs.entries.filter(line => !filter || line.toLowerCase().includes(filter));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-muted p-3">No log entries matching filter criteria.</div>`;
    return;
  }

  container.innerHTML = filtered.map((line, idx) => {
    const isAlert = line.includes('ALERT') || line.includes('[ERROR]') || line.includes('error');
    const isInfo = line.includes('[INFO]') || line.includes('[OK]');
    let lineClass = 'log-line';
    if (isAlert) lineClass += ' alert-line';
    else if (isInfo) lineClass += ' info-line';

    return `
      <div class="${lineClass}">
        <span class="log-line-num">${idx + 1}</span>
        <span class="log-line-text">${escapeHtml(line)}</span>
      </div>
    `;
  }).join('');

  if (autoScroll) {
    const viewerBody = document.getElementById('logViewerBody');
    if (viewerBody) viewerBody.scrollTop = viewerBody.scrollHeight;
  }
}

// ============================================================================
// TERMINAL DRAWER: COLLAPSIBLE LINUX COMMAND INSPECTOR
// ============================================================================
function initTerminalDrawer() {
  const drawer = document.getElementById('terminalDrawer');
  const header = document.getElementById('terminalHeader');
  const toggleBtn = document.getElementById('terminalToggleBtn');
  const collapseBtn = document.getElementById('collapseTerminalBtn');
  const chevron = document.getElementById('terminalChevron');
  const clearBtn = document.getElementById('clearTerminalBtn');
  const copyBtn = document.getElementById('copyTerminalBtn');

  function toggleDrawer(forceExpand = null) {
    const isCollapsed = drawer.classList.contains('collapsed');
    const shouldExpand = (forceExpand !== null) ? forceExpand : isCollapsed;

    if (shouldExpand) {
      drawer.classList.remove('collapsed');
      drawer.classList.add('expanded');
      chevron.className = 'fa-solid fa-chevron-down';
    } else {
      drawer.classList.remove('expanded');
      drawer.classList.add('collapsed');
      chevron.className = 'fa-solid fa-chevron-up';
    }
  }

  header?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // ignore when clicking header buttons
    toggleDrawer();
  });

  toggleBtn?.addEventListener('click', () => toggleDrawer());
  collapseBtn?.addEventListener('click', () => toggleDrawer());

  clearBtn?.addEventListener('click', () => {
    const history = document.getElementById('terminalHistory');
    if (history) {
      history.innerHTML = `<div class="terminal-entry system-msg">[Console history cleared]</div>`;
    }
  });

  copyBtn?.addEventListener('click', () => {
    const history = document.getElementById('terminalHistory');
    if (history) {
      copyToClipboard(history.innerText);
    }
  });
}

function appendTerminalEntry(command, output, ok = true) {
  const history = document.getElementById('terminalHistory');
  const statusBadge = document.getElementById('terminalStatusBadge');
  const pulseDot = document.getElementById('commandPulseDot');

  if (!history) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  const entry = document.createElement('div');
  entry.className = 'terminal-entry';

  entry.innerHTML = `
    <div class="term-cmd-line">
      <span class="text-muted font-mono text-xs">[${timeStr}]</span>
      <span class="term-prompt">root@devserver:~#</span>
      <span class="term-cmd-text">${escapeHtml(command || 'ls')}</span>
    </div>
    ${output ? `<div class="term-raw-output ${ok ? '' : 'err'}">${escapeHtml(output)}</div>` : ''}
  `;

  history.appendChild(entry);

  // Status badge update
  if (statusBadge) {
    statusBadge.textContent = ok ? 'OK' : 'ERR';
    statusBadge.className = `terminal-status-badge ${ok ? '' : 'badge-rose'}`;
  }

  // Pulse animation on toggle button
  if (pulseDot) {
    pulseDot.style.animation = 'none';
    setTimeout(() => { pulseDot.style.animation = 'pulse-ring 1s'; }, 10);
  }

  // Auto-scroll terminal drawer
  const body = document.getElementById('terminalBody');
  if (body) body.scrollTop = body.scrollHeight;
}

// ============================================================================
// FORMS & MODALS INITIALIZATION
// ============================================================================
function initModals() {
  document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
    el.addEventListener('click', () => {
      const modalId = el.dataset.modal || el.closest('.modal-overlay')?.id;
      if (modalId) closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  document.getElementById('openAddDevModalBtn')?.addEventListener('click', () => {
    openModal('addDevModal');
    document.getElementById('devUsernameInput')?.focus();
  });

  document.getElementById('openAddRepoModalBtn')?.addEventListener('click', () => {
    openModal('addRepoModal');
    document.getElementById('repoNameInput')?.focus();
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function initForms() {
  // 1. Add Developer Form
  const addDevForm = document.getElementById('addDevForm');
  const usernameInput = document.getElementById('devUsernameInput');
  const feedback = document.getElementById('devUsernameFeedback');
  const usernameRegex = /^[a-z][a-z0-9_-]{1,31}$/;

  usernameInput?.addEventListener('input', () => {
    const val = usernameInput.value.trim();
    if (!val) {
      feedback.style.display = 'none';
    } else if (!usernameRegex.test(val)) {
      feedback.textContent = 'Must start with lowercase letter and contain only letters, numbers, _ or -';
      feedback.style.display = 'block';
    } else {
      feedback.style.display = 'none';
    }
  });

  addDevForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const fullname = document.getElementById('devFullnameInput').value.trim();
    const btn = document.getElementById('saveDevBtn');

    if (!usernameRegex.test(username)) {
      showToast('error', 'Validation Error', 'Invalid username format.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating...`;

    const res = await apiRequest('/api/users', 'POST', { username, fullname });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Create Developer</span>`;

    if (res.ok) {
      showToast('success', 'Developer Created', `Account '${username}' created with group developers.`);
      closeModal('addDevModal');
      addDevForm.reset();

      // Refresh users
      const uRes = await apiRequest('/api/users');
      if (uRes.ok) {
        state.users = uRes.data;
        renderDevelopersTable();
        document.getElementById('navDevCount').textContent = state.users.length;
        document.getElementById('kpiDevs').textContent = state.users.length;
      }
    } else {
      showToast('error', 'Creation Failed', res.error || 'Failed to create user');
    }
  });

  // 2. Add Repository Form
  const addRepoForm = document.getElementById('addRepoForm');
  const repoNameInput = document.getElementById('repoNameInput');
  const repoFeedback = document.getElementById('repoNameFeedback');
  const repoRegex = /^[A-Za-z0-9._-]+$/;

  addRepoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawName = repoNameInput.value.trim();
    const btn = document.getElementById('saveRepoBtn');

    if (!repoRegex.test(rawName)) {
      repoFeedback.textContent = 'Only letters, numbers, dots, dashes and underscores allowed.';
      repoFeedback.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Initializing...`;

    const res = await apiRequest('/api/repos', 'POST', { name: rawName });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-plus"></i> <span>Initialize Bare Repo</span>`;

    if (res.ok) {
      showToast('success', 'Repository Initialized', `Shared bare repo '${rawName}' created.`);
      closeModal('addRepoModal');
      addRepoForm.reset();

      const rRes = await apiRequest('/api/repos');
      if (rRes.ok) {
        state.repos = rRes.data;
        renderRepositoriesGrid();
        document.getElementById('navRepoCount').textContent = state.repos.length;
        document.getElementById('kpiRepos').textContent = state.repos.length;
      }
    } else {
      showToast('error', 'Creation Failed', res.error || 'Failed to create repository');
    }
  });

  // 3. Confirm Delete Developer
  document.getElementById('confirmDeleteDevBtn')?.addEventListener('click', async () => {
    const username = state.pendingDeleteUser;
    if (!username) return;

    const btn = document.getElementById('confirmDeleteDevBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Deleting...`;

    const res = await apiRequest(`/api/users/${username}`, 'DELETE');
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span>Delete Account</span>`;

    if (res.ok) {
      showToast('success', 'Account Deleted', `Developer '${username}' has been removed.`);
      closeModal('deleteDevModal');
      state.users = state.users.filter(u => u.username !== username);
      renderDevelopersTable();
      document.getElementById('navDevCount').textContent = state.users.length;
      document.getElementById('kpiDevs').textContent = state.users.length;
    } else {
      showToast('error', 'Delete Failed', res.error || 'Failed to delete user');
    }
  });

  // Search and Filter Listeners
  document.getElementById('devSearchInput')?.addEventListener('input', renderDevelopersTable);
  document.getElementById('devStatusFilter')?.addEventListener('change', renderDevelopersTable);
  document.getElementById('repoSearchInput')?.addEventListener('input', renderRepositoriesGrid);
}

// ============================================================================
// ACTION BUTTONS: CLEANUP, BACKUP, REFRESH CONTROLS
// ============================================================================
function initActionButtons() {
  // Pause / Resume Auto-refresh
  const pauseBtn = document.getElementById('pauseRefreshBtn');
  const pauseIcon = document.getElementById('pauseIcon');
  const livePill = document.getElementById('liveStatusPill');
  const liveText = document.getElementById('liveStatusText');

  pauseBtn?.addEventListener('click', () => {
    state.isPolling = !state.isPolling;
    if (state.isPolling) {
      pauseIcon.className = 'fa-solid fa-pause';
      livePill.className = 'live-status-pill';
      liveText.textContent = 'LIVE (5s)';
      showToast('info', 'Live Refresh Resumed', 'Polling telemetry every 5 seconds.');
    } else {
      pauseIcon.className = 'fa-solid fa-play';
      livePill.className = 'live-status-pill paused';
      liveText.textContent = 'PAUSED';
      showToast('info', 'Live Refresh Paused', 'Automatic polling paused.');
    }
  });

  // Manual Refresh Button
  document.getElementById('manualRefreshBtn')?.addEventListener('click', async () => {
    await loadAllData();
    showToast('info', 'Refreshed', 'System state synchronized from backend.');
  });

  // Preview Cleanup (Dry Run)
  document.getElementById('previewCleanupBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('previewCleanupBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Scanning Disk...`;

    const res = await apiRequest('/api/cleanup', 'POST', { dry_run: true });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-eye"></i> <span>Preview Cleanup (Dry Run)</span>`;

    if (res.ok) {
      document.getElementById('cleanupModalTitle').innerHTML = `<i class="fa-solid fa-eye text-teal"></i> Cleanup Preview Report (Dry Run)`;
      document.getElementById('cleanupRawOutput').textContent = res.data.summary || res.raw.output;
      openModal('cleanupResultModal');
    } else {
      showToast('error', 'Cleanup Error', res.error || 'Failed to execute cleanup dry-run');
    }
  });

  // Run Cleanup Now
  document.getElementById('runCleanupBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('runCleanupBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Running Cleanup...`;

    const res = await apiRequest('/api/cleanup', 'POST', { dry_run: false });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span>Run Cleanup Now</span>`;

    if (res.ok) {
      showToast('success', 'Cleanup Finished', 'Disk cleanup successfully executed.');
      document.getElementById('cleanupModalTitle').innerHTML = `<i class="fa-solid fa-broom text-teal"></i> Cleanup Execution Report`;
      document.getElementById('cleanupRawOutput').textContent = res.data.summary || res.raw.output;
      openModal('cleanupResultModal');
      // Refresh status telemetry
      pollTelemetry();
    } else {
      showToast('error', 'Cleanup Error', res.error || 'Failed to execute cleanup');
    }
  });

  // Backup Now
  document.getElementById('createBackupBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('createBackupBtn');
    const icon = document.getElementById('backupBtnIcon');
    const text = document.getElementById('backupBtnText');

    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin';
    text.textContent = 'Creating Backup...';

    const res = await apiRequest('/api/backup', 'POST');
    btn.disabled = false;
    icon.className = 'fa-solid fa-cloud-arrow-up';
    text.textContent = 'Backup Now';

    if (res.ok) {
      showToast('success', 'Backup Complete', 'New verified backup created and retention policy verified.');
      // Reload backups
      const bRes = await apiRequest('/api/backups');
      if (bRes.ok) {
        state.backups = bRes.data;
        renderBackupsTable();
        document.getElementById('kpiBackup').textContent = 'Just now';
      }
    } else {
      showToast('error', 'Backup Failed', res.error || 'Failed to create backup');
    }
  });
}

// ============================================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================================
function showToast(type = 'info', title = '', message = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconClass = type === 'success'
    ? 'fa-solid fa-circle-check'
    : (type === 'error' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info');

  toast.innerHTML = `
    <div class="toast-icon"><i class="${iconClass}"></i></div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  // Auto remove after 4.5 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 250);
  }, 4500);
}

// ============================================================================
// UTILITIES
// ============================================================================
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
