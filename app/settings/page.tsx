import { AppFrame } from '@/components/navigation/AppFrame'
import { RecallBreakSetting } from '@/components/settings/RecallBreakSetting'
import { ThemeSetting } from '@/components/settings/ThemeSetting'
import { AccentSetting } from '@/components/settings/AccentSetting'
import { LearnerMemorySetting } from '@/components/settings/LearnerMemorySetting'
import { UsageSetting } from '@/components/settings/UsageSetting'

export default function SettingsPage() {
  return (
    <AppFrame title="Settings">
      <main className="settings-page">
        <div className="page-header narrow">
          <p className="eyebrow">Settings</p>
          <h1 className="page-heading">Make TruLurn feel like yours.</h1>
          <p className="page-subtitle">
            Appearance preferences are stored on this device. Light mode remains the default.
          </p>
        </div>
        <p className="section-label compact">Appearance</p>
        <div className="settings-list">
          <ThemeSetting />
          <AccentSetting />
        </div>
        <p className="section-label">Learning</p>
        <div className="settings-list">
          <RecallBreakSetting />
          <LearnerMemorySetting />
        </div>
        <p className="section-label">Usage</p>
        <div className="settings-list">
          <UsageSetting />
        </div>
        <p className="section-label">Product</p>
        <div className="settings-list">
          <div className="settings-row">
            <span>
              <strong>Source-based curricula</strong>
              <small>Temporarily unavailable while document processing is hardened</small>
            </span>
            <span className="settings-status">Paused</span>
          </div>
          <div className="settings-row">
            <span>
              <strong>AI credentials</strong>
              <small>Managed securely on the server and never sent to the browser</small>
            </span>
            <span className="settings-status settings-status-ok">Protected</span>
          </div>
        </div>
      </main>
    </AppFrame>
  )
}
