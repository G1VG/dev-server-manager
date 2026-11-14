# Dev Server Manager — Ubuntu Linux Setup & Deployment Guide


## 1. Prerequisites

- **Operating System:** Ubuntu 22.04 LTS or Ubuntu 24.04 LTS (x86_64 or aarch64).
- **Access Privileges:** Sudo / root shell access via SSH.
- **Storage for LVM:** A dedicated unpartitioned secondary block device (e.g., `/dev/sdb`, minimum 5 GB) **or** a 3 GB loopback virtual disk image file (`/var/lib/devserver/disk.img`).
- **Network & Ports:**
  - `22/tcp` (SSH): Remote shell access, developer Git clone over SSH, and secure port forwarding.
  - `5000/tcp` (Web Dashboard): Bound to `127.0.0.1:5000` (accessed via SSH port forwarding `ssh -L 5000:localhost:5000` or an authenticated reverse proxy).

---

## 2. Setup Phases

### Phase 1: System Update and Base Packages
*Updates apt repositories and installs the complete developer toolchain, storage utilities, and runtime dependencies used across the project.*

```bash
# Update package indices and apply pending distribution upgrades
sudo apt-get update && sudo apt-get upgrade -y

# Install dev toolchain, system management utilities, LVM, and Python 3
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git build-essential python3 python3-pip python3-venv \
  nodejs npm default-jdk vim curl rsync lvm2 cron dos2unix
```

---

### Phase 2: Users, Directories, Storage (LVM), and Repositories
*Creates the developer security group, provisions all 40 developer accounts from `users.txt` with initial forced password expiry, configures LVM storage partitions with online expansion margins, and initializes shared Git repositories with setgid permissions.*

```bash
# Set up project destination directory and copy workspace files
sudo mkdir -p /opt/dev-server-manager
sudo cp -r . /opt/dev-server-manager/
cd /opt/dev-server-manager

# Convert DOS line endings to UNIX format and grant execute rights
sudo dos2unix admin_panel.sh config.sh scripts/*.sh
sudo chmod +x admin_panel.sh scripts/*.sh

# Create developers group
sudo groupadd developers

# Provision 40 developer accounts from users.txt (enforcing password reset on first login)
while IFS=, read -r username fullname; do
  username=$(echo "$username" | tr -d '\r')
  fullname=$(echo "$fullname" | tr -d '\r')
  [[ -z "$username" || "$username" =~ ^# ]] && continue
  if ! id "$username" &>/dev/null; then
    sudo useradd -m -s /bin/bash -c "${fullname:-$username}" -G developers "$username"
    echo "$username:<DEFAULT_PASSWORD>" | sudo chpasswd
    sudo chage -d 0 "$username"
  fi
done < users.txt

# Create base mount and logging directories
sudo mkdir -p /srv/repos /srv/backups /var/log/devserver /var/lib/devserver

# Prevent Git dubious ownership warnings across shared developer directories
sudo git config --system --add safe.directory '*'

# --------------------------------------------------------------------------
# Storage Management (LVM): Choose EITHER Option A (Physical Disk) OR Option B (Virtual Disk)
# --------------------------------------------------------------------------

# OPTION A: If using a real dedicated block device (e.g., /dev/sdb)
# sudo pvcreate -ff -y /dev/sdb
# sudo vgcreate vg_dev /dev/sdb

# OPTION B: If using a loopback virtual disk image file (safe for VMs/demo)
sudo truncate -s 3G /var/lib/devserver/disk.img
DEV_LOOP=$(sudo losetup -f --show /var/lib/devserver/disk.img)
sudo pvcreate -ff -y "$DEV_LOOP"
sudo vgcreate vg_dev "$DEV_LOOP"

# Create Logical Volumes: 50% for repos, 30% for backups (20% reserved for online growth)
sudo lvcreate -y -l 50%VG -n lv_repos vg_dev
sudo lvcreate -y -l 30%VG -n lv_backup vg_dev

# Format Logical Volumes with ext4 filesystem
sudo mkfs.ext4 -q /dev/vg_dev/lv_repos
sudo mkfs.ext4 -q /dev/vg_dev/lv_backup

# Mount logical volumes to their respective targets
sudo mount /dev/vg_dev/lv_repos /srv/repos
sudo mount /dev/vg_dev/lv_backup /srv/backups

# Set setgid mode (2775) on repos (ensures group inheritance) and 750 on backups
sudo chgrp developers /srv/repos
sudo chmod 2775 /srv/repos
sudo chmod 750 /srv/backups

# Persist mount points across system reboots in /etc/fstab
echo "/dev/mapper/vg_dev-lv_repos /srv/repos ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
echo "/dev/mapper/vg_dev-lv_backup /srv/backups ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab

# Initialize initial bare Git repository with group collaboration permissions
sudo git init --bare --shared=group /srv/repos/demo-project.git
sudo chgrp -R developers /srv/repos/demo-project.git
```

---

### Phase 3: Python Environment and Backend Dependencies
*Creates an isolated virtual environment and installs backend packages required by the administrative REST API.*

```bash
cd /opt/dev-server-manager/webapp

# Create isolated Python virtual environment
sudo python3 -m venv venv

# Upgrade pip and install Flask backend dependencies
sudo ./venv/bin/pip install --upgrade pip
sudo ./venv/bin/pip install -r requirements.txt
```

---

### Phase 4: Automation & Backend Systemd Service
*Deploys the cron automation schedule for monitoring, backups, and cleanup, and creates a systemd service unit to run the Web Dashboard backend with root execution privileges.*

#### File: `/etc/cron.d/devserver`
```ini
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/5 * * * * root /opt/dev-server-manager/scripts/monitor.sh   >/dev/null 2>&1
*/5 * * * * root /opt/dev-server-manager/scripts/auto_disk.sh >> /var/log/devserver/autodisk.log 2>&1
0 2 * * *   root /opt/dev-server-manager/scripts/backup.sh    >> /var/log/devserver/backup.log 2>&1
0 3 * * 0   root /opt/dev-server-manager/scripts/cleanup.sh   >> /var/log/devserver/cleanup.log 2>&1
```

#### File: `/etc/systemd/system/devserver-web.service`
```ini
[Unit]
Description=Dev Server Manager Web Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dev-server-manager/webapp
ExecStart=/opt/dev-server-manager/webapp/venv/bin/python3 /opt/dev-server-manager/webapp/app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
# Write cron jobs file with root-only edit permissions (including Auto Disk Management)
sudo tee /etc/cron.d/devserver > /dev/null << 'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/5 * * * * root /opt/dev-server-manager/scripts/monitor.sh   >/dev/null 2>&1
*/5 * * * * root /opt/dev-server-manager/scripts/auto_disk.sh >> /var/log/devserver/autodisk.log 2>&1
0 2 * * *   root /opt/dev-server-manager/scripts/backup.sh    >> /var/log/devserver/backup.log 2>&1
0 3 * * 0   root /opt/dev-server-manager/scripts/cleanup.sh   >> /var/log/devserver/cleanup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/devserver

# Write systemd service file for the web dashboard
sudo tee /etc/systemd/system/devserver-web.service > /dev/null << 'EOF'
[Unit]
Description=Dev Server Manager Web Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dev-server-manager/webapp
ExecStart=/opt/dev-server-manager/webapp/venv/bin/python3 /opt/dev-server-manager/webapp/app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
```

---

### Phase 5: Front-End Assets Verification
*The front-end consists of vanilla HTML5, CSS3, and JavaScript, loading external libraries (Chart.js and FontAwesome) via public CDNs. No Node.js build, bundler, or compile step is required. This phase verifies asset presence in the Flask static distribution path.*

```bash
# Confirm static assets are present in the webapp static folder
ls -la /opt/dev-server-manager/webapp/static/index.html \
       /opt/dev-server-manager/webapp/static/style.css \
       /opt/dev-server-manager/webapp/static/app.js
```

---

### Phase 6: Remote Access and Web Server Configuration
*The Flask backend strictly binds to `127.0.0.1:5000` to prevent unauthenticated network exposure. Access the dashboard securely using an SSH local port forward, or deploy an optional reverse proxy (e.g., Nginx).*

#### Access Option A: Direct Secure SSH Tunnel (Standard & Zero Extra Dependencies)
```bash
# Run this on your local laptop/workstation to map local port 5000 to the remote server
ssh -L 5000:127.0.0.1:5000 <SSH_USER>@<SERVER_IP>

# Access the dashboard in your local browser at:
# http://127.0.0.1:5000
```

#### Access Option B: Nginx Reverse Proxy with Basic Authentication (Optional)
```bash
# Install nginx and apache2-utils for basic auth
sudo apt-get install -y nginx apache2-utils

# Create htpasswd credentials file for administrator access
sudo htpasswd -cb /etc/nginx/.htpasswd admin <ADMIN_PASSWORD>

# Deploy Nginx reverse proxy site configuration
sudo tee /etc/nginx/sites-available/devserver > /dev/null << 'EOF'
server {
    listen 80;
    server_name <SERVER_IP> <YOUR_DOMAIN>;

    location / {
        auth_basic "Dev Server Administration Console";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

# Enable site configuration and verify syntax
sudo ln -sf /etc/nginx/sites-available/devserver /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

#### Access Option C: Nginx High-Availability Load Balancer with Multi-Worker Cluster
```bash
# Start 3-node background application cluster (ports 5001, 5002, 5003)
sudo /opt/dev-server-manager/scripts/load_balancer.sh --start-cluster

# Test dynamic traffic distribution across nodes
sudo /opt/dev-server-manager/scripts/load_balancer.sh --test-traffic
```

---

### Phase 7: Firewall and Security Basics
*Enforces least-privilege host network security using UFW, restricting external access to SSH and reverse proxy ports.*

```bash
# Set default firewall policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH and Git over SSH
sudo ufw allow 22/tcp comment 'SSH and Git access'

# If Option B or C (Nginx Reverse Proxy / Load Balancer) was deployed, allow HTTP
# sudo ufw allow 80/tcp comment 'HTTP reverse proxy'
# sudo ufw allow 8080/tcp comment 'Nginx load balancer gateway'

# Enable firewall rules
sudo ufw --force enable
sudo ufw status verbose
```

---

### Phase 8: Service Initialization and Enablement
*Loads the new systemd unit, enables background daemons, and brings all services to an active operational state.*

```bash
# Reload systemd daemon to pick up the new unit file
sudo systemctl daemon-reload

# Enable and start the cron scheduler and web dashboard service
sudo systemctl enable --now cron
sudo systemctl enable --now devserver-web

# Verify active status
sudo systemctl is-active cron devserver-web
```

---

### Phase 9: Verification
*Runs non-destructive test scripts and checks system metrics, endpoints, and storage topology to confirm the deployment succeeded.*

```bash
# 1. Execute live API endpoint verification suite (read-only tests)
sudo /opt/dev-server-manager/webapp/venv/bin/python3 /opt/dev-server-manager/webapp/check_live_endpoints.py

# 2. Test local HTTP response from the Flask service
curl -sI http://127.0.0.1:5000/ | head -n 5

# 3. Test the server monitoring telemetry dashboard
sudo /opt/dev-server-manager/scripts/monitor.sh --dashboard

# 4. Trigger an immediate backup and verify archive integrity
sudo /opt/dev-server-manager/scripts/backup.sh

# 5. Run a cleanup dry-run to verify path filters without deleting files
sudo /opt/dev-server-manager/scripts/cleanup.sh --dry-run

# 6. Verify Auto Disk Management policies and LVM headroom
sudo /opt/dev-server-manager/scripts/auto_disk.sh --status

# 7. Verify LVM configuration and filesystem mount points
sudo pvs && sudo vgs vg_dev && sudo lvs vg_dev
df -h /srv/repos /srv/backups

# 8. Verify all 40 developers are registered in the developers group
getent group developers | cut -d: -f4 | tr ',' '\n' | wc -l
```

---

### Phase 10: Docker Dynamic Memory & LVM Integration (Evaluator Advanced Module)
*Implements containerized developer environments with cgroups v2 dynamic memory allocation and direct host LVM volume bindings.*

```bash
# 1. Start developer sandbox container with soft reservation (256MB) and hard limit (512MB)
#    Directly maps host LVM ext4 partition /srv/repos -> /workspace/repos
sudo /opt/dev-server-manager/scripts/docker_manager.sh --start-sandbox

# 2. Dynamically expand container memory LIVE to 1024MB without restarting container
sudo /opt/dev-server-manager/scripts/docker_manager.sh --scale-mem 1024

# 3. View live container resource stats & LVM bind mounts
sudo /opt/dev-server-manager/scripts/docker_manager.sh --status

# 4. Or launch the full containerized high-availability stack via Docker Compose:
# sudo docker compose up -d
```

---

## 3. Useful Maintenance Commands

```bash
# 1. Inspect live logs of the Web Dashboard service
sudo journalctl -u devserver-web -f -n 50

# 2. Inspect administrative audit trail log
sudo tail -f /var/log/devserver/activity.log

# 3. View real-time resource alerts and metrics
sudo tail -n 25 /var/log/devserver/monitor.log

# 4. Restart the Web Dashboard service after configuration changes
sudo systemctl restart devserver-web

# 5. Expand the shared repository logical volume online with zero downtime
sudo lvextend -r -L +500M /dev/vg_dev/lv_repos

# 6. Launch the interactive administrative Bash menu
sudo /opt/dev-server-manager/admin_panel.sh

# 7. Check installed cron jobs and scheduler status
cat /etc/cron.d/devserver && sudo systemctl status cron --no-pager
```

---

## 4. Troubleshooting

### 1. Script fails with `bad interpreter: /bin/bash^M`
- **Cause:** Files were saved or edited with Windows CRLF line endings.
- **Diagnostic / Fix Command:**
  ```bash
  file /opt/dev-server-manager/admin_panel.sh
  sudo dos2unix /opt/dev-server-manager/*.sh /opt/dev-server-manager/scripts/*.sh /opt/dev-server-manager/config.sh
  ```

### 2. Web Dashboard returns `Connection Refused` on port 5000
- **Cause:** `devserver-web` service is inactive or crashed during startup.
- **Diagnostic / Fix Command:**
  ```bash
  sudo systemctl status devserver-web --no-pager
  sudo journalctl -u devserver-web -n 30 --no-pager
  ```

### 3. LVM Volume Group `vg_dev` missing or inactive after reboot (Loopback mode)
- **Cause:** Virtual loop device was not re-attached to `/var/lib/devserver/disk.img` after reboot.
- **Diagnostic / Fix Command:**
  ```bash
  sudo vgs vg_dev || (sudo losetup -f /var/lib/devserver/disk.img && sudo vgchange -ay vg_dev && sudo mount -a)
  ```

### 4. Git operations fail with `fatal: detected dubious ownership in repository`
- **Cause:** Developer user accounts do not own the repository root directory due to shared group permissions.
- **Diagnostic / Fix Command:**
  ```bash
  sudo git config --system --get-all safe.directory
  # Ensure wildcard safe directory is present in system config:
  sudo git config --system --add safe.directory '*'
  ```

### 5. API returns `HTTP 403 Forbidden` when attempting account management
- **Cause:** Target user has UID < 1000. The backend explicitly protects system accounts from lock, unlock, or deletion.
- **Diagnostic / Fix Command:**
  ```bash
  # Check account UID (only UIDs >= 1000 can be managed)
  id -u <username>
  ```

