# Kiosk setup: a screen that boots straight into a rotating dashboard

This guide turns a mini-PC, Intel NUC, Mac mini, Linux box or Chromebox behind a TV into a dashboard screen that:

- powers on, logs in and opens Chrome full-screen with no keyboard or mouse,
- rotates your dashboards with [Tab Rotator](../extensions/tab-rotator),
- recovers by itself from crashes, power cuts, Chrome updates and network drops,
- never shows a sleep screen, screensaver, "Restore pages?" bubble or update prompt.

Budget about 30 minutes for the first screen. After that, copy the same scripts and policies to every other screen.

**Contents:** [1. Before you start](#1-before-you-start) · [2. Chrome flags](#2-chrome-flags) · [3. Windows](#3-windows) · [4. macOS](#4-macos) · [5. Linux](#5-linux-ubuntu--debian-with-gnome) · [6. ChromeOS](#6-chromeos--chromebox) · [7. Chrome policies](#7-chrome-policies-all-platforms) · [8. Updates without prompts](#8-chrome-updates-without-prompts) · [9. The TV itself](#9-the-tv-itself) · [10. Checklist](#10-final-checklist)

---

## 1. Before you start

1. **Create a dedicated local user account** (e.g. `kiosk`) with no admin rights. Everything below runs as that user.
2. **Use a dedicated Chrome profile directory** (`--user-data-dir`, below), so the screen's Chrome never mixes with anyone's personal browsing and can be wiped and rebuilt.
3. **Set up Tab Rotator before going full-screen.** Launch Chrome once *without* `--kiosk`, install Tab Rotator, and in its settings:
   - set the **screen name** (e.g. `Lobby-1`),
   - turn on **Start rotating when the browser starts**,
   - add your playlist, or point it at your [fleet config file](remote-config.md),
   - sign in to each dashboard once, so its session cookie is saved in this profile.

   In kiosk mode the toolbar is hidden. To reach settings later, press Ctrl+L (⌘L on Mac) and open `chrome-extension://<tab-rotator-id>/options/options.html`, or manage the screen remotely with fleet config.

## 2. Chrome flags

Every platform below launches Chrome with these flags:

| Flag | Why |
|---|---|
| `--kiosk` | Full-screen with no tabs, address bar or exit button. (Alt+F4 / ⌘Q still quits; the scripts below relaunch it.) |
| `--user-data-dir=<dir>` | The dedicated profile from step 1. |
| `--no-first-run` | Skips the welcome screens. |
| `--noerrdialogs` | Suppresses error dialogs. |
| `--hide-crash-restore-bubble` | Hides "Restore pages?" after a crash. Not every Chrome version honours it, so the scripts also mark the last exit as clean (below). |
| `--disable-features=Translate` | No "Translate this page?" bar on foreign-language dashboards. |

**Why the scripts edit `Preferences`:** Chrome shows "Restore pages?" whenever it thinks the last session crashed, which a power cut always looks like. Before each launch, the scripts set `exit_type` to `Normal` in the profile's `Default/Preferences` file. That's the reliable fix.

---

## 3. Windows

### Automatic login

Use Microsoft's **[Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)**: run it as an administrator, enter the `kiosk` account's password, and click Enable. It stores the password encrypted, unlike the old registry method. On Windows 11, first turn off *Settings → Accounts → Sign-in options → "For improved security, only allow Windows Hello sign-in"*, or autologon is ignored.

### Launch script with automatic restart

Save as `C:\Kiosk\start-dashboard.ps1`:

```powershell
# Don't name these $profile or $args: both are built-in PowerShell variables.
$chrome     = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileDir = "C:\Kiosk\chrome-profile"
$prefs      = Join-Path $profileDir "Default\Preferences"
$chromeArgs = @("--kiosk", "--user-data-dir=$profileDir", "--no-first-run", "--noerrdialogs",
                "--hide-crash-restore-bubble", "--disable-features=Translate")

while ($true) {
    # Make the last exit look clean so Chrome doesn't offer to "Restore pages?".
    if (Test-Path $prefs) {
        (Get-Content $prefs -Raw) -replace '"exit_type":\s*"[^"]*"', '"exit_type":"Normal"' |
            Set-Content $prefs -NoNewline
    }
    Start-Process -FilePath $chrome -ArgumentList $chromeArgs -Wait
    Start-Sleep -Seconds 5   # Chrome quit or crashed: start it again.
}
```

Run it at logon with Task Scheduler. In an admin PowerShell:

```powershell
$action    = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Kiosk\start-dashboard.ps1"
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User "kiosk"
$principal = New-ScheduledTaskPrincipal -UserId "kiosk" -LogonType Interactive   # run on the kiosk user's desktop
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Dashboard" -Action $action -Trigger $trigger -Principal $principal -Settings $settings
```

`-ExecutionTimeLimit 0` stops Windows killing the task after its default 3-day limit.

### No sleep, no screensaver, no surprise restarts

```powershell
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f   # run as the kiosk user
```

- **Windows Update:** set *Active hours* to cover display hours, or schedule restarts for the night (Settings → Windows Update → Advanced options). After a reboot, autologon and the scheduled task bring the screen straight back.
- **Notifications:** turn on *Do not disturb* (Settings → System → Notifications).
- **Power cuts:** in the BIOS/UEFI, set *After power failure* (sometimes "AC recovery") to **Power On**, so the PC starts again by itself.

### Policies

See [section 7](#7-chrome-policies-all-platforms). On Windows, policies go in the registry under `HKLM\SOFTWARE\Policies\Google\Chrome`, or in Group Policy / Intune if the machine is managed.

---

## 4. macOS

### Automatic login

*System Settings → Users & Groups → Automatically log in as → kiosk.* This option is unavailable while FileVault is on; decide whether the screen's Mac needs disk encryption (it holds dashboard session cookies).

### Launch script with automatic restart

Save as `/Users/kiosk/Kiosk/start-dashboard.sh` and `chmod +x` it:

```sh
#!/bin/sh
PROFILE="$HOME/Kiosk/chrome-profile"
PREFS="$PROFILE/Default/Preferences"
# Make the last exit look clean so Chrome doesn't offer to "Restore pages?".
[ -f "$PREFS" ] && sed -i '' 's/"exit_type":[[:space:]]*"[^"]*"/"exit_type":"Normal"/' "$PREFS"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --kiosk --user-data-dir="$PROFILE" --no-first-run --noerrdialogs \
  --hide-crash-restore-bubble --disable-features=Translate
```

Run it with a LaunchAgent, which relaunches Chrome whenever it exits. That's more reliable than a login item. Save as `~/Library/LaunchAgents/com.example.dashboard.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.dashboard</string>
  <key>ProgramArguments</key><array><string>/Users/kiosk/Kiosk/start-dashboard.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
```

Load it with `launchctl load ~/Library/LaunchAgents/com.example.dashboard.plist` (it also loads by itself at every login).

### No sleep, no screensaver

```sh
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
sudo pmset -a autorestart 1                          # power back on after a power cut
defaults -currentHost write com.apple.screensaver idleTime 0
```

Also turn on *Do Not Disturb* permanently (Control Centre → Focus), and turn off automatic macOS updates that restart the machine, or schedule them for the night.

### Policies

See [section 7](#7-chrome-policies-all-platforms). On macOS, Chrome policies are delivered as a **configuration profile** through your MDM, or installed by hand from a `.mobileconfig` file. Google publishes a template; the [example below](#macos-configuration-profile) is a minimal one.

---

## 5. Linux (Ubuntu / Debian with GNOME)

### Automatic login

In `/etc/gdm3/custom.conf`, under `[daemon]`:

```ini
AutomaticLoginEnable=true
AutomaticLogin=kiosk
```

### Launch with systemd (automatic restart)

Save as `/home/kiosk/.config/systemd/user/dashboard.service`:

```ini
[Unit]
Description=Dashboard (Chrome kiosk)
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Environment=PROFILE=%h/kiosk/chrome-profile
# Make the last exit look clean so Chrome doesn't offer to "Restore pages?".
ExecStartPre=-/bin/sh -c 'sed -i "s/\"exit_type\":[[:space:]]*\"[^\"]*\"/\"exit_type\":\"Normal\"/" "$PROFILE/Default/Preferences"'
ExecStart=/usr/bin/google-chrome --kiosk --user-data-dir=${PROFILE} --no-first-run --noerrdialogs --hide-crash-restore-bubble --disable-features=Translate
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now dashboard.service
```

(For Chromium, use `/usr/bin/chromium` and the `/etc/chromium/policies/managed/` directory below.)

### No sleep, no screensaver

As the kiosk user:

```sh
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
gsettings set org.gnome.desktop.notifications show-banners false
```

As root, so nothing can suspend the machine:

```sh
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### Policies

See [section 7](#7-chrome-policies-all-platforms). On Linux, save the JSON as `/etc/opt/chrome/policies/managed/kiosk.json` (Chromium: `/etc/chromium/policies/managed/kiosk.json`), then check `chrome://policy`.

---

## 6. ChromeOS / Chromebox

ChromeOS devices are managed from the Google Admin console, and full kiosk mode needs a Chrome Enterprise or *Kiosk & Signage* upgrade licence for each device.

- **Recommended:** a **Managed Guest Session** that auto-launches, with Tab Rotator force-installed through *Apps & extensions → Managed guest sessions*. Set its screen name and config URL on the device once, or deliver everything through fleet config. Apply the policies in section 7 in the Admin console, under the same names.
- **Single-app kiosk mode** is built around one app or URL, and its extension support differs between licence types and ChromeOS versions. Check Google's current kiosk documentation for your licence before choosing it.
- Power: *Devices → Chrome → Settings → Power and shutdown*. Set *idle action* to "Do nothing" and turn off screen dimming.

---

## 7. Chrome policies (all platforms)

These settings stop pop-ups and background behaviour that break unattended screens. Replace `<tab-rotator-id>` with Tab Rotator's ID from its Chrome Web Store URL, and list your dashboards' hosts under `TabDiscardingExceptions`.

```json
{
  "ExtensionInstallForcelist": ["<tab-rotator-id>;https://clients2.google.com/service/update2/crx"],
  "RestoreOnStartup": 5,
  "HighEfficiencyModeEnabled": false,
  "TabDiscardingExceptions": ["grafana.example.com", "app.datadoghq.com", "*.atlassian.net"],
  "DefaultNotificationsSetting": 2,
  "TranslateEnabled": false,
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "PromotionsEnabled": false,
  "DefaultBrowserSettingEnabled": false,
  "MetricsReportingEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "BackgroundModeEnabled": false
}
```

| Policy | Effect on a dashboard screen |
|---|---|
| `ExtensionInstallForcelist` | Installs Tab Rotator automatically and keeps it updated; nobody can remove it. |
| `RestoreOnStartup: 5` | Starts with a fresh New Tab page; Tab Rotator then opens its playlist. (Use `1`, "restore last session", if you rotate the window's own tabs instead of a playlist.) |
| `HighEfficiencyModeEnabled: false` | Turns off Memory Saver, which otherwise unloads background dashboards. Tab Rotator copes with that, but each one then shows a spinner when it's its turn. |
| `TabDiscardingExceptions` | Belt and braces: these hosts are never unloaded, even under memory pressure. |
| `DefaultNotificationsSetting: 2` | Sites can't show notification pop-ups over the dashboard. |
| `TranslateEnabled`, `PasswordManagerEnabled`, `Autofill…`, `PromotionsEnabled`, `DefaultBrowserSettingEnabled` | No translate bar, "save password?", autofill or "make Chrome your default" bubbles. |
| `BrowserSignin: 0`, `SyncDisabled` | No Google account in the kiosk profile, and nothing synced between screens. (Signing in to dashboards themselves is unaffected.) |
| `MetricsReportingEnabled: false` | No usage statistics sent to Google. |
| `BackgroundModeEnabled: false` | Chrome fully quits when its window closes, so the launch script can restart it cleanly. |

**Optional lockdown** (add once the screen works; remove it temporarily when you need to service the screen):

```json
{
  "DeveloperToolsAvailability": 2,
  "URLBlocklist": ["chrome://extensions", "chrome://settings", "chrome://flags"]
}
```

Tab Rotator Pro's [settings lock](../extensions/tab-rotator) adds a PIN on its own settings and start/stop.

### macOS configuration profile

A minimal `.mobileconfig` carrying the policies above. Each policy goes inside the inner `dict` in plist form; two are shown. Double-click it to install (*System Settings → Privacy & Security → Profiles*), or push it through your MDM.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>com.example.kiosk.chrome</string>
  <key>PayloadUUID</key><string>6F1C1B2A-0000-4000-8000-000000000001</string>
  <key>PayloadDisplayName</key><string>Dashboard kiosk: Chrome policies</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.google.Chrome</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>com.example.kiosk.chrome.policies</string>
      <key>PayloadUUID</key><string>6F1C1B2A-0000-4000-8000-000000000002</string>
      <key>RestoreOnStartup</key><integer>5</integer>
      <key>HighEfficiencyModeEnabled</key><false/>
      <!-- …the other policies from the JSON above, in the same plist form… -->
    </dict>
  </array>
</dict>
</plist>
```

---

## 8. Chrome updates without prompts

Leave the `RelaunchNotification` policy **unset**. Chrome then only marks a pending update with a small badge in its menu, which a kiosk never shows. (Setting it to "Required" makes Chrome display a recurring warning on screen before it forces a restart, which is the opposite of what you want on a TV.)

Instead, **restart Chrome every night**, outside display hours. A clean quit applies any pending update, clears memory that long-running dashboards leak, and the launch script restarts Chrome straight away. Tab Rotator's auto-start picks rotation back up.

- **Windows:** `schtasks /create /tn "Dashboard nightly restart" /sc daily /st 03:00 /ru kiosk /it /tr "taskkill /im chrome.exe"`. `/it` runs it on the logged-in kiosk desktop; without `/f`, Chrome is asked to close and exits cleanly.
- **macOS:** a second LaunchAgent with `StartCalendarInterval` → `Hour` 3, running `osascript -e 'quit app "Google Chrome"'`.
- **Linux:** two small user units in `~/.config/systemd/user/`, then `systemctl --user enable --now dashboard-restart.timer`:

  ```ini
  # dashboard-restart.service
  [Service]
  Type=oneshot
  ExecStart=/usr/bin/systemctl --user restart dashboard.service

  # dashboard-restart.timer
  [Timer]
  OnCalendar=*-*-* 03:00
  Persistent=true

  [Install]
  WantedBy=timers.target
  ```

---

## 9. The TV itself

- **Turn off the TV's eco / auto power-off.** Many TVs switch off after a few hours "without remote control input", even with a live signal. Look for *Eco*, *Auto power off* or *No signal power off* in the TV's settings.
- **Set the input to wake on signal** (often *HDMI-CEC*, *Anynet+*, *Bravia Sync* or *SimpLink*), so the screen comes back with the PC after a power cut.
- **Fix overscan:** set *Picture size → Just scan / Screen fit / 1:1*, or the edges of your dashboards will be cut off.
- **Burn-in:** OLED panels showing static dashboards for months can burn in. Rotation helps; Tab Rotator Pro's [display hours](../extensions/tab-rotator) show a black screen overnight.

## 10. Final checklist

- [ ] Pull the power plug, wait 10 seconds, plug it back in. The screen comes back to a rotating dashboard with **no keyboard or mouse**.
- [ ] Press Alt+F4 / ⌘Q. Chrome comes back within about 10 seconds.
- [ ] Unplug the network for 10 minutes. Tab Rotator logs load errors and recovers when the network returns (Settings → Health log).
- [ ] Leave it overnight. Next morning it has had its 03:00 restart, there are no prompts or bubbles on screen, and it's still rotating.
- [ ] Optional: configure Tab Rotator alerts, so the screen tells *you* when something breaks.
