import { AppFrame } from '@/components/navigation/AppFrame'

export default function SettingsPage() {
  return (
    <AppFrame title="Settings">
      <main className="settings-page">
        <div className="page-header narrow">
          <p className="eyebrow">Settings</p>
          <h1 className="page-heading">Product controls stay quiet and explicit.</h1>
          <p className="page-subtitle">
            These are placeholders for account, model provider, data export, and evidence-language preferences.
          </p>
        </div>
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
