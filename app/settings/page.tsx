import { AppFrame } from '@/components/navigation/AppFrame'
import { RecallBreakSetting } from '@/components/settings/RecallBreakSetting'
import { ThemeSetting } from '@/components/settings/ThemeSetting'
import { LearnerMemorySetting } from '@/components/settings/LearnerMemorySetting'

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
        </div>
        <p className="section-label">Learning</p>
        <div className="settings-list">
          <RecallBreakSetting />
          <LearnerMemorySetting />
        </div>
        <p className="section-label">Product</p>
        <div className="settings-list">
          <div className="settings-row">
            <span>
              <strong>AI provider</strong>
              <small>Mock provider active</small>
            </span>
            <button className="button-subtle" type="button">Configure</button>
          </div>
          <div className="settings-row">
            <span>
              <strong>Evidence language</strong>
              <small>Use demonstrated-evidence wording</small>
            </span>
            <button className="button-subtle" type="button">Review</button>
          </div>
          <div className="settings-row">
            <span>
              <strong>Exports</strong>
              <small>Topic notes, branch notes, and quiz history</small>
            </span>
            <button className="button-subtle" type="button">Open</button>
          </div>
        </div>
      </main>
    </AppFrame>
  )
}
