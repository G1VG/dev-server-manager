/**
 * DEV SERVER MANAGER — FRONTEND APPLICATION (v2.0)
 * Premium DevOps Console (Vercel / Linear / Grafana quality)
 * Vanilla JS, no build step, no npm.
 * Dependency-free: Chart.js & FontAwesome via CDN.
 */

// ============================================================================
// GLOBAL APPLICATION STATE
// ============================================================================
const state = {
  activeTab: 'overview',
  theme: 'dark',
  isPolling: true,
  pollIntervalMs: 5000,
  pollTimer: null,
  isRefreshing: false,
  systemMode: 'connecting',
  status: null,
  users: [],
  usersLoaded: false,
  usersError: '',
  usersRequestId: 0,
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
  initTheme();
  initNavigation();
  initChart();
  initModals();
  initTerminalDrawer();
  initLvmControls();
  initLogsViewer();
  initForms();
  initActionButtons();
  initKeyboardShortcuts();

  // Initial Data Load
  loadAllData().then(() => {
    startAutoRefresh();
  });
});

// ============================================================================
// THEME SYSTEM (LIGHT / DARK, KEPT IN APPLICATION MEMORY)
// ============================================================================
function initTheme() {
  applyTheme(state.theme);

  const toggleBtn = document.getElementById('themeToggleBtn');
  toggleBtn?.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);

  if (theme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
  }

  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  }
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    toggleBtn.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    toggleBtn.setAttribute('title', `Switch to ${nextTheme} theme`);
    toggleBtn.setAttribute('aria-pressed', String(theme === 'light'));
  }

  updateChartTheme(theme);
}

function updateChartTheme(theme) {
  if (!state.chart) return;
  const isLight = theme === 'light';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
  const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(11, 15, 25, 0.95)';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)';
  const tooltipTitle = isLight ? '#0F172A' : '#F1F5F9';
  const tooltipBody = isLight ? '#334155' : '#E2E8F0';

  if (state.chart.options?.scales?.y) {
    state.chart.options.scales.y.grid.color = gridColor;
  }
  if (state.chart.options?.plugins?.tooltip) {
    state.chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    state.chart.options.plugins.tooltip.borderColor = tooltipBorder;
    state.chart.options.plugins.tooltip.titleColor = tooltipTitle;
    state.chart.options.plugins.tooltip.bodyColor = tooltipBody;
  }
  state.chart.update('none');
}

// ============================================================================
// KEYBOARD SHORTCUTS & ACCESSIBILITY
// ============================================================================
function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // 1. ESC: Close open modals, or collapse terminal if open
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-overlay.open');
      if (openModal) {
        closeModal(openModal.id);
        e.preventDefault();
        return;
      }
      const drawer = document.getElementById('terminalDrawer');
      if (drawer && drawer.classList.contains('expanded')) {
        drawer.classList.remove('expanded');
        drawer.classList.add('collapsed');
        const chevron = document.getElementById('terminalChevron');
        if (chevron) chevron.className = 'fa-solid fa-chevron-up';
        e.preventDefault();
        return;
      }
    }

    // 2. Ctrl + ` (backtick) or Ctrl + J: Toggle terminal drawer
    if ((e.ctrlKey && e.key === '`') || (e.ctrlKey && e.key.toLowerCase() === 'j')) {
      e.preventDefault();
      document.getElementById('terminalToggleBtn')?.click();
      return;
    }

    // 3. Ctrl + K or '/' (when not typing in an input): focus search
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName))) {
      e.preventDefault();
      if (state.activeTab === 'developers') {
        document.getElementById('devSearchInput')?.focus();
      } else if (state.activeTab === 'repositories') {
        document.getElementById('repoSearchInput')?.focus();
      } else if (state.activeTab === 'logs') {
        document.getElementById('logFilterInput')?.focus();
      } else {
        // Switch to developers and focus search
        switchTab('developers');
        setTimeout(() => document.getElementById('devSearchInput')?.focus(), 80);
      }
    }
  });

  // KPI card keyboard activation (Enter / Space)
  const kpiDevCard = document.getElementById('kpiDevsCard');
  if (kpiDevCard) {
    kpiDevCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchTab('developers');
      }
    });
  }
}

// ============================================================================
// NAVIGATION & TABS
// ============================================================================
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  navLinks.forEach(link => {
    link.tabIndex = link.classList.contains('active') ? 0 : -1;
  });
  panes.forEach(pane => {
    const isActive = pane.classList.contains('active');
    pane.setAttribute('aria-hidden', String(!isActive));
    if (!isActive) pane.setAttribute('hidden', 'true');
  });

  const subtitles = {
    overview: 'Real-time telemetry, LVM storage topology & 40 developer accounts',
    developers: 'Manage developer accounts in group "developers" with password policies',
    repositories: 'Shared Git repositories in /srv/repos with setgid (2775) permissions',
    storage: 'LVM Volume Group (vg_dev) online volume expansion without downtime',
    automation: 'Crontab schedules in /etc/cron.d/devserver and automated disk cleanup',
    backups: 'Compressed archives in /srv/backups with verification and 7-day retention',
    logs: 'Live system logs with threshold alert highlighting from /var/log/devserver/',
    architecture: 'How the browser, Flask API, Bash scripts, and Linux host fit together'
  };

  const titles = {
    overview: 'System Overview',
    developers: 'Developer Accounts',
    repositories: 'Shared Repositories',
    storage: 'Storage Management (LVM)',
    automation: 'System Automation & Cleanup',
    backups: 'Backup & Disaster Recovery',
    logs: 'System Logs',
    architecture: 'About / Architecture'
  };

  window.switchTab = function(tabId) {
    if (!tabId || !titles[tabId]) tabId = 'overview';
    state.activeTab = tabId;

    navLinks.forEach(link => {
      const isActive = link.dataset.tab === tabId;
      link.classList.toggle('active', isActive);
      link.setAttribute('aria-selected', isActive ? 'true' : 'false');
      link.tabIndex = isActive ? 0 : -1;
    });

    panes.forEach(pane => {
      const isActive = pane.id === `pane-${tabId}`;
      pane.classList.toggle('active', isActive);
      pane.setAttribute('aria-hidden', String(!isActive));
      if (isActive) {
        pane.removeAttribute('hidden');
      } else {
        pane.setAttribute('hidden', 'true');
      }
    });

    if (pageTitle) pageTitle.textContent = titles[tabId];
    if (pageSubtitle) pageSubtitle.textContent = subtitles[tabId];
    window.location.hash = tabId;

    // Trigger tab-specific refresh if needed
    if (tabId === 'logs') loadLogs();
    if (tabId === 'developers') loadDevelopers();
    if (tabId === 'repositories') renderRepositoriesGrid();
    if (tabId === 'storage') renderLvmView();

    // Close mobile sidebar if open
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
  };

  document.getElementById('navMenu')?.addEventListener('keydown', (e) => {
    const currentIndex = Array.from(navLinks).findIndex(link => link === document.activeElement);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % navLinks.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + navLinks.length) % navLinks.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = navLinks.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextLink = navLinks[nextIndex];
    window.switchTab(nextLink.dataset.tab);
    nextLink.focus();
  });

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
    const sidebar = document.getElementById('sidebar');
    const isOpen = sidebar?.classList.toggle('mobile-open') || false;
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded', String(isOpen));
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

      // Refresh the open directory continuously; elsewhere, refresh when its count changes.
      const devKpiCount = res.data.kpis?.developers ?? 0;
      if (state.activeTab === 'developers' || !state.usersLoaded ||
          state.users.length !== devKpiCount) {
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
  const requestId = ++state.usersRequestId;
  const syncStatus = document.getElementById('developerSyncStatus');
  if (!state.usersLoaded && syncStatus) {
    syncStatus.classList.add('syncing');
    syncStatus.querySelector('span:last-child').textContent = 'Loading accounts…';
  }

  const usersRes = await apiRequest('/api/users');
  if (requestId !== state.usersRequestId) return;

  if (!usersRes.ok || !Array.isArray(usersRes.data)) {
    state.usersError = usersRes.error || 'The server returned an invalid developer list.';
    if (syncStatus) {
      syncStatus.classList.remove('syncing');
      syncStatus.classList.add('sync-error');
      const syncText = syncStatus.querySelector('span:last-child');
      if (syncText && syncText.textContent !== 'Sync failed · retrying') {
        syncText.textContent = 'Sync failed · retrying';
      }
    }
    if (!state.usersLoaded) renderDevelopersTable();
    return;
  }

  state.users = usersRes.data;
  state.usersLoaded = true;
  state.usersError = '';
  renderDevelopersTable();
  renderOverviewDevsRoster();
  updateDeveloperCounts();
  if (syncStatus) {
    syncStatus.classList.remove('syncing', 'sync-error');
    const syncMessage = `Live · updates every ${state.pollIntervalMs / 1000}s`;
    const syncText = syncStatus.querySelector('span:last-child');
    if (syncText && syncText.textContent !== syncMessage) syncText.textContent = syncMessage;
  }
}

function updateDeveloperCounts() {
  const count = state.users.length;
  const active = state.users.filter(user => user.status !== 'locked').length;
  const locked = count - active;
  const navCount = document.getElementById('navDevCount');
  const kpiDev = document.getElementById('kpiDevs');
  const badge = document.getElementById('overviewDevCountBadge');
  const totalCount = document.getElementById('developerTotalCount');
  const activeCount = document.getElementById('developerActiveCount');
  const lockedCount = document.getElementById('developerLockedCount');
  const statusFilter = document.getElementById('devStatusFilter');

  if (navCount) navCount.textContent = count;
  if (kpiDev) kpiDev.textContent = count;
  if (badge) badge.textContent = `${count} Total`;
  if (totalCount) totalCount.textContent = count;
  if (activeCount) activeCount.textContent = active;
  if (lockedCount) lockedCount.textContent = locked;
  if (statusFilter) {
    statusFilter.querySelector('option[value="all"]').textContent = `All accounts (${count})`;
    statusFilter.querySelector('option[value="active"]').textContent = `Active (${active})`;
    statusFilter.querySelector('option[value="locked"]').textContent = `Locked (${locked})`;
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
      state.usersLoaded = true;
      state.usersError = '';
      renderDevelopersTable();
      renderOverviewDevsRoster();
      updateDeveloperCounts();
    } else {
      state.usersError = usersRes.error || 'The server returned an invalid developer list.';
      const syncStatus = document.getElementById('developerSyncStatus');
      if (syncStatus) {
        syncStatus.classList.add('sync-error');
        const syncText = syncStatus.querySelector('span:last-child');
        if (syncText && syncText.textContent !== 'Sync failed · retrying') {
          syncText.textContent = 'Sync failed · retrying';
        }
      }
      renderDevelopersTable();
    }

    if (reposRes.ok) {
      state.repos = reposRes.data;
      renderRepositoriesGrid();
      const repoCount = state.repos.length;
      const navRepo = document.getElementById('navRepoCount');
      const kpiRepo = document.getElementById('kpiRepos');
      if (navRepo) navRepo.textContent = repoCount;
      if (kpiRepo) kpiRepo.textContent = repoCount;
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

  if (cpuLoadVal) cpuLoadVal.textContent = loadNum.toFixed(2);
  if (cpuCoresLabel) cpuCoresLabel.textContent = `/ ${coresNum} Cores (${cpuPct}%)`;

  // SVG Gauge calculation: 2 * PI * r = 2 * 3.14159 * 50 = 314.159
  const circumference = 314.16;
  const cpuOffset = circumference - (cpuPct / 100) * circumference;
  if (cpuGauge) cpuGauge.style.strokeDashoffset = cpuOffset;

  if (loadNum > coresNum) {
    if (cpuGauge) cpuGauge.className = 'gauge-progress rose';
    if (cpuBadge) {
      cpuBadge.className = 'badge badge-rose';
      cpuBadge.textContent = 'High Load';
    }
    if (cpuStatusText) {
      cpuStatusText.textContent = 'OVERLOAD';
      cpuStatusText.className = 'text-rose font-mono';
    }
  } else {
    if (cpuGauge) cpuGauge.className = 'gauge-progress';
    if (cpuBadge) {
      cpuBadge.className = 'badge badge-teal';
      cpuBadge.textContent = 'Nominal';
    }
    if (cpuStatusText) {
      cpuStatusText.textContent = 'Healthy';
      cpuStatusText.className = 'text-teal';
    }
  }

  // 4. Memory Gauge
  const memVal = document.getElementById('memVal');
  const memGauge = document.getElementById('memGaugeProgress');
  const memBadge = document.getElementById('memBadge');
  const memPct = Number(data.mem_pct) || 0;

  if (memVal) memVal.textContent = `${memPct}%`;
  const memOffset = circumference - (memPct / 100) * circumference;
  if (memGauge) memGauge.style.strokeDashoffset = memOffset;

  if (memPct >= 85) {
    if (memGauge) memGauge.className = 'gauge-progress rose';
    if (memBadge) {
      memBadge.className = 'badge badge-rose';
      memBadge.textContent = `${memPct}% ALERT`;
    }
  } else {
    if (memGauge) memGauge.className = 'gauge-progress purple';
    if (memBadge) {
      memBadge.className = 'badge badge-purple';
      memBadge.textContent = `${memPct}% Allocated`;
    }
  }

  // 5. Root Disk Gauge
  const rootDisk = data.disks?.find(d => d.mount === '/') || { use_pct: 42, size: '50 GB', used: '21 GB' };
  const diskVal = document.getElementById('diskVal');
  const diskGauge = document.getElementById('diskGaugeProgress');
  const diskBadge = document.getElementById('diskBadge');

  const diskPct = rootDisk.use_pct || 0;
  if (diskVal) diskVal.textContent = `${diskPct}%`;
  const diskOffset = circumference - (diskPct / 100) * circumference;
  if (diskGauge) diskGauge.style.strokeDashoffset = diskOffset;

  if (diskPct >= 80) {
    if (diskGauge) diskGauge.className = 'gauge-progress rose';
    if (diskBadge) {
      diskBadge.className = 'badge badge-rose';
      diskBadge.textContent = `${diskPct}% ALERT`;
    }
  } else {
    if (diskGauge) diskGauge.className = 'gauge-progress blue';
    if (diskBadge) {
      diskBadge.className = 'badge badge-blue';
      diskBadge.textContent = `${diskPct}% Used`;
    }
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
            <span class="mount-path"><i class="fa-solid fa-folder text-muted"></i> ${escapeHtml(d.mount)}</span>
            <span class="mount-stats">${escapeHtml(d.used)} / ${escapeHtml(d.size)} (${d.use_pct}%)</span>
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
    const kpiDevs = document.getElementById('kpiDevs');
    const kpiRepos = document.getElementById('kpiRepos');
    const kpiCron = document.getElementById('kpiCron');
    if (kpiDevs) kpiDevs.textContent = data.kpis.developers;
    if (kpiRepos) kpiRepos.textContent = data.kpis.repositories;
    if (kpiCron) kpiCron.textContent = `${data.kpis.cron_jobs} Active`;
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

  const isLight = (document.documentElement.getAttribute('data-theme') || 'dark') === 'light';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
  const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(11, 15, 25, 0.95)';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)';

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
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#00F2FE',
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
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#a855f7',
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
          backgroundColor: tooltipBg,
          titleFont: { family: 'JetBrains Mono', size: 11, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          cornerRadius: 8
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
          grid: { color: gridColor },
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

  state.chart.update('none'); // Update smoothly without full redraw flickers
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
      <div class="empty-state py-4" style="grid-column: 1 / -1;">
        <div class="empty-state-icon-ring">
          <i class="fa-solid fa-users empty-state-icon"></i>
        </div>
        <div class="empty-state-title">No developers loaded</div>
        <div class="empty-state-desc">Waiting for developer account synchronization from system group "developers".</div>
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

  updateDeveloperCounts();

  if (filtered.length === 0) {
    if (!state.usersLoaded && state.usersError) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon-ring"><i class="fa-solid fa-triangle-exclamation empty-state-icon"></i></div>
            <div class="empty-state-title">Could not load developer accounts</div>
            <div class="empty-state-desc">${escapeHtml(state.usersError)}</div>
            <div class="empty-state-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-retry-developers>
                <i class="fa-solid fa-arrows-rotate"></i> Retry
              </button>
            </div>
          </div>
        </td></tr>
      `;
      if (countEl) countEl.textContent = 'Developer account list unavailable';
      return;
    }

    if (!state.usersLoaded) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="developer-loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Loading developer accounts…</div></td></tr>';
      if (countEl) countEl.textContent = 'Loading developer accounts…';
      return;
    }

    const hasFilter = search !== '' || filter !== 'all';
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon-ring">
              <i class="fa-solid fa-user-slash empty-state-icon"></i>
            </div>
            <div class="empty-state-title">${hasFilter ? 'No matching developer accounts' : 'No developer accounts found'}</div>
            <div class="empty-state-desc">${hasFilter ? 'No accounts matched your search keyword or status filter. Try clearing filters or adding a new developer.' : 'The group "developers" currently has no active member accounts.'}</div>
            <div class="empty-state-actions">
              ${hasFilter ? `
                <button class="btn btn-secondary btn-sm" onclick="resetDevFilters()">
                  <i class="fa-solid fa-rotate-left"></i> Reset Filters
                </button>
              ` : ''}
              <button class="btn btn-primary btn-sm" onclick="openModal('addDevModal')">
                <i class="fa-solid fa-user-plus"></i> Add Developer
              </button>
            </div>
          </div>
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
      ? `<button class="btn btn-secondary btn-sm" type="button" data-user-action="unlock" data-username="${escapeHtml(uname)}" aria-label="Unlock ${escapeHtml(uname)}" title="Unlock account">
           <i class="fa-solid fa-lock-open text-teal"></i> Unlock
         </button>`
      : `<button class="btn btn-secondary btn-sm" type="button" data-user-action="lock" data-username="${escapeHtml(uname)}" aria-label="Lock ${escapeHtml(uname)}" title="Lock account">
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
            <button class="btn btn-danger btn-sm" type="button" data-user-action="delete" data-username="${escapeHtml(uname)}" aria-label="Delete ${escapeHtml(uname)}" title="Delete developer account">
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

window.resetDevFilters = function() {
  const s = document.getElementById('devSearchInput');
  const f = document.getElementById('devStatusFilter');
  if (s) s.value = '';
  if (f) f.value = 'all';
  renderDevelopersTable();
};

function getInitials(name) {
  if (!name || typeof name !== 'string') return 'DV';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function handleToggleLock(username, lock, button) {
  const action = lock ? 'lock' : 'unlock';
  if (button) button.disabled = true;
  const res = await apiRequest(`/api/users/${encodeURIComponent(username)}/${action}`, 'POST');

  if (res.ok) {
    showToast('success', 'User Status Updated', `Account '${username}' has been ${action}ed.`);
    const u = state.users.find(x => x.username === username);
    if (u) u.status = lock ? 'locked' : 'active';
    updateDeveloperCounts();
    renderDevelopersTable();
    renderOverviewDevsRoster();
    await loadDevelopers();
  } else {
    showToast('error', 'Action Failed', res.error || `Failed to ${action} user`);
    if (button) button.disabled = false;
  }
}

function openDeleteUserModal(username) {
  state.pendingDeleteUser = username;
  const targetLabel = document.getElementById('deleteTargetUsername');
  if (targetLabel) targetLabel.textContent = username;
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
    const hasSearch = search !== '';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon-ring">
          <i class="fa-brands fa-git-alt empty-state-icon"></i>
        </div>
        <div class="empty-state-title">${hasSearch ? 'No matching repositories' : 'No Repositories Found'}</div>
        <div class="empty-state-desc">${hasSearch ? `No repository matches "${escapeHtml(search)}". Try clearing your search.` : 'No shared bare Git repositories found in /srv/repos. Initialize a repository to start collaborating.'}</div>
        <div class="empty-state-actions">
          ${hasSearch ? `
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('repoSearchInput').value=''; renderRepositoriesGrid();">
              <i class="fa-solid fa-rotate-left"></i> Clear Search
            </button>
          ` : ''}
          <button class="btn btn-primary btn-sm" onclick="openModal('addRepoModal')">
            <i class="fa-solid fa-plus"></i> Create Repository
          </button>
        </div>
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
            <span>${escapeHtml(r.size || '48 KB')}</span>
          </div>
          <div class="repo-stat-row">
            <span>Group Ownership:</span>
            <span>${escapeHtml(r.group || 'developers')}</span>
          </div>
          <div class="repo-stat-row">
            <span>Permissions (setgid):</span>
            <span>${escapeHtml(r.mode || '2775')}</span>
          </div>
        </div>

        <div class="clone-box">
          <span class="clone-command-text" title="${cloneCmd}">${escapeHtml(cloneCmd)}</span>
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
  const emptyState = document.getElementById('lvmEmptyState');
  const architectureCard = document.getElementById('lvmArchitectureCard');
  const extendCard = document.getElementById('lvmExtendCard');

  if (lvm.configured === false) {
    if (emptyState) emptyState.hidden = false;
    const message = document.getElementById('lvmEmptyMessage');
    if (message) message.textContent = lvm.message || 'Configure the vg_dev volume group to view storage details.';
    if (architectureCard) architectureCard.hidden = true;
    if (extendCard) extendCard.hidden = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;
  if (architectureCard) architectureCard.hidden = false;
  if (extendCard) extendCard.hidden = false;

  // VG stats
  const vgSize = lvm.vg?.size_mb ?? lvm.vg_size_mb ?? 3072;
  const vgFree = lvm.vg_free_mb !== undefined ? lvm.vg_free_mb : 614;
  const vgUsed = Math.max(0, vgSize - vgFree);
  const usedPct = vgSize > 0 ? Math.min(100, Math.round((vgUsed / vgSize) * 100)) : 0;
  const freePct = 100 - usedPct;

  const pvName = document.getElementById('lvmPvName');
  const pvSize = document.getElementById('lvmPvSize');
  const vgName = document.getElementById('lvmVgName');
  const vgSizeEl = document.getElementById('lvmVgSize');
  const vgUsedEl = document.getElementById('lvmVgUsedMb');
  const vgFreeEl = document.getElementById('lvmVgFreeMb');
  const vgBarUsed = document.getElementById('lvmVgBarUsed');
  const vgBarFree = document.getElementById('lvmVgBarFree');

  if (pvName) pvName.textContent = lvm.pv?.name || 'No physical volume';
  if (pvSize) pvSize.textContent = lvm.pv?.size_mb ? `${lvm.pv.size_mb} MB` : '—';
  if (vgName) vgName.textContent = lvm.vg?.name || 'vg_dev';
  if (vgSizeEl) vgSizeEl.textContent = `${vgSize} MB`;
  if (vgUsedEl) vgUsedEl.textContent = `${vgUsed} MB`;
  if (vgFreeEl) vgFreeEl.textContent = `${vgFree} MB`;
  if (vgBarUsed) vgBarUsed.style.width = `${usedPct}%`;
  if (vgBarFree) vgBarFree.style.width = `${freePct}%`;

  // LVs stats
  const lvRepos = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_repos') : lvm.lvs?.lv_repos;
  const lvBackup = lvm.lvs?.find ? lvm.lvs.find(l => l.name === 'lv_backup') : lvm.lvs?.lv_backup;

  if (lvRepos) {
    const rSize = lvRepos.size_mb || 1536;
    const rUsed = lvRepos.used_mb || 420;
    const rPct = Math.round((rUsed / rSize) * 100);
    const reposSizeEl = document.getElementById('lvReposSize');
    const reposProgEl = document.getElementById('lvReposProgress');
    const reposUsedEl = document.getElementById('lvReposUsedText');
    if (reposSizeEl) reposSizeEl.textContent = `${rSize} MB`;
    if (reposProgEl) reposProgEl.style.width = `${rPct}%`;
    if (reposUsedEl) reposUsedEl.textContent = `Used: ${rUsed} MB (${rPct}%)`;
  }

  if (lvBackup) {
    const bSize = lvBackup.size_mb || 922;
    const bUsed = lvBackup.used_mb || 315;
    const bPct = Math.round((bUsed / bSize) * 100);
    const backupSizeEl = document.getElementById('lvBackupSize');
    const backupProgEl = document.getElementById('lvBackupProgress');
    const backupUsedEl = document.getElementById('lvBackupUsedText');
    if (backupSizeEl) backupSizeEl.textContent = `${bSize} MB`;
    if (backupProgEl) backupProgEl.style.width = `${bPct}%`;
    if (backupUsedEl) backupUsedEl.textContent = `Used: ${bUsed} MB (${bPct}%)`;
  }

  // Update slider bounds & max label
  const slider = document.getElementById('extendMbSlider');
  const input = document.getElementById('extendMbInput');
  const maxLabel = document.getElementById('sliderMaxLabel');
  const targetLv = document.getElementById('extendTargetLv');
  const extendButton = document.getElementById('extendSubmitBtn');
  const lvNames = new Set(Array.isArray(lvm.lvs) ? lvm.lvs.map(lv => lv.name) : []);
  const hasLvData = lvNames.size > 0;

  targetLv?.querySelectorAll('option').forEach(option => {
    option.disabled = hasLvData && !lvNames.has(option.value);
  });
  if (extendButton) {
    extendButton.disabled = vgFree <= 0 || !hasLvData;
    extendButton.title = vgFree <= 0
      ? 'No free space is available in vg_dev.'
      : (!hasLvData ? 'No logical volumes are available to extend.' : '');
  }

  if (slider && input && maxLabel) {
    const maxVal = Math.max(16, vgFree);
    slider.max = maxVal;
    input.max = maxVal;
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
    const availableVolumes = Array.isArray(state.lvm?.lvs) ? state.lvm.lvs.map(item => item.name) : [];

    if (state.lvm?.configured === false || !availableVolumes.includes(lv)) {
      showToast('error', 'Volume Unavailable', 'The selected logical volume is not configured on this system.');
      return;
    }

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
  if (!timeline) return;

  if (!state.cron || state.cron.length === 0) {
    timeline.innerHTML = `
      <div class="empty-state py-4" style="grid-column: 1 / -1;">
        <div class="empty-state-icon-ring">
          <i class="fa-solid fa-clock-rotate-left empty-state-icon"></i>
        </div>
        <div class="empty-state-title">No Crontab Schedules Found</div>
        <div class="empty-state-desc">No automated cron jobs detected in /etc/cron.d/devserver.</div>
      </div>
    `;
    return;
  }

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
        <span class="badge badge-teal">${escapeHtml(c.status || 'Active')}</span>
        <span class="text-xs text-muted">User: ${escapeHtml(c.user || 'root')}</span>
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

  if (!state.backups || state.backups.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state">
            <div class="empty-state-icon-ring">
              <i class="fa-solid fa-box-archive empty-state-icon"></i>
            </div>
            <div class="empty-state-title">No Backups Found</div>
            <div class="empty-state-desc">There are no archived backups in /srv/backups yet. Create your first automated archive now.</div>
            <div class="empty-state-actions">
              <button class="btn btn-primary btn-sm" onclick="document.getElementById('createBackupBtn').click()">
                <i class="fa-solid fa-cloud-arrow-up"></i> Backup Now
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.backups.map(b => `
    <tr>
      <td>
        <span class="font-mono text-highlight"><i class="fa-solid fa-file-zipper text-teal mr-2"></i> ${escapeHtml(b.filename)}</span>
      </td>
      <td><span class="font-mono font-bold">${escapeHtml(b.size)}</span></td>
      <td><span class="font-mono text-xs">${escapeHtml(b.created)}</span></td>
      <td><span class="badge badge-green"><i class="fa-solid fa-check"></i> ${escapeHtml(b.status || 'Verified tar.gz')}</span></td>
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
    container.innerHTML = `
      <div class="empty-state py-4 text-center">
        <div class="empty-state-icon-ring" style="width:40px;height:40px;font-size:16px;">
          <i class="fa-solid fa-filter empty-state-icon"></i>
        </div>
        <div class="empty-state-title" style="font-size:14px;">No log lines matched filter</div>
        <div class="empty-state-desc" style="font-size:12px;">Try adjusting your keyword filter or select a different log file above.</div>
      </div>
    `;
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
    if (!drawer) return;
    const isCollapsed = drawer.classList.contains('collapsed');
    const shouldExpand = (forceExpand !== null) ? forceExpand : isCollapsed;

    if (shouldExpand) {
      drawer.classList.remove('collapsed');
      drawer.classList.add('expanded');
      if (chevron) chevron.className = 'fa-solid fa-chevron-down';
    } else {
      drawer.classList.remove('expanded');
      drawer.classList.add('collapsed');
      if (chevron) chevron.className = 'fa-solid fa-chevron-up';
    }
  }

  header?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // ignore when clicking header buttons
    toggleDrawer();
  });

  toggleBtn?.addEventListener('click', () => toggleDrawer());
  collapseBtn?.addEventListener('click', () => toggleDrawer(false));

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
    setTimeout(() => document.getElementById('devUsernameInput')?.focus(), 80);
  });

  document.getElementById('openAddRepoModalBtn')?.addEventListener('click', () => {
    openModal('addRepoModal');
    setTimeout(() => document.getElementById('repoNameInput')?.focus(), 80);
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('open');
    // Accessibility: find first input and focus
    const firstInput = el.querySelector('input:not([disabled]), button:not([disabled])');
    if (firstInput) setTimeout(() => firstInput.focus(), 80);
  }
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
      if (feedback) feedback.style.display = 'none';
    } else if (!usernameRegex.test(val)) {
      if (feedback) {
        feedback.textContent = 'Must start with lowercase letter and contain only letters, numbers, _ or -';
        feedback.style.display = 'block';
      }
    } else {
      if (feedback) feedback.style.display = 'none';
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
      await loadDevelopers();
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
      if (repoFeedback) {
        repoFeedback.textContent = 'Only letters, numbers, dots, dashes and underscores allowed.';
        repoFeedback.style.display = 'block';
      }
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
        const rCount = state.repos.length;
        const navRepo = document.getElementById('navRepoCount');
        const kpiRepo = document.getElementById('kpiRepos');
        if (navRepo) navRepo.textContent = rCount;
        if (kpiRepo) kpiRepo.textContent = rCount;
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

    const res = await apiRequest(`/api/users/${encodeURIComponent(username)}`, 'DELETE');
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span>Delete Account</span>`;

    if (res.ok) {
      showToast('success', 'Account Deleted', `Developer '${username}' has been removed.`);
      closeModal('deleteDevModal');
      state.users = state.users.filter(u => u.username !== username);
      renderDevelopersTable();
      renderOverviewDevsRoster();
      const count = state.users.length;
      const navDevCount = document.getElementById('navDevCount');
      const kpiDev = document.getElementById('kpiDevs');
      if (navDevCount) navDevCount.textContent = count;
      if (kpiDev) kpiDev.textContent = count;
      updateDeveloperCounts();
    } else {
      showToast('error', 'Delete Failed', res.error || 'Failed to delete user');
    }
  });

  document.getElementById('devsTableBody')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-retry-developers]')) {
      loadDevelopers();
      return;
    }

    const actionButton = target.closest('[data-user-action]');
    if (!(actionButton instanceof HTMLButtonElement)) return;
    const { userAction, username } = actionButton.dataset;
    if (!username) return;
    if (userAction === 'lock') handleToggleLock(username, true, actionButton);
    if (userAction === 'unlock') handleToggleLock(username, false, actionButton);
    if (userAction === 'delete') openDeleteUserModal(username);
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
      if (pauseIcon) pauseIcon.className = 'fa-solid fa-pause';
      if (livePill) livePill.className = 'live-status-pill';
      if (liveText) liveText.textContent = 'LIVE (5s)';
      showToast('info', 'Live Refresh Resumed', 'Polling telemetry every 5 seconds.');
    } else {
      if (pauseIcon) pauseIcon.className = 'fa-solid fa-play';
      if (livePill) livePill.className = 'live-status-pill paused';
      if (liveText) liveText.textContent = 'PAUSED';
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
    if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
    if (text) text.textContent = 'Creating Backup...';

    const res = await apiRequest('/api/backup', 'POST');
    btn.disabled = false;
    if (icon) icon.className = 'fa-solid fa-cloud-arrow-up';
    if (text) text.textContent = 'Backup Now';

    if (res.ok) {
      showToast('success', 'Backup Complete', 'New verified backup created and retention policy verified.');
      // Reload backups
      const bRes = await apiRequest('/api/backups');
      if (bRes.ok) {
        state.backups = bRes.data;
        renderBackupsTable();
        const kpiBackup = document.getElementById('kpiBackup');
        if (kpiBackup) kpiBackup.textContent = 'Just now';
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
    <button class="toast-close" aria-label="Close notification">&times;</button>
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
